import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { CHAT_WINDOW_NAME, createChatWindowManager } from "../electron/chatWindow.js";

const request = Object.freeze({ url: "about:blank", frameName: CHAT_WINDOW_NAME });
const docked = Object.freeze({ detached: false, ready: false });
const opening = Object.freeze({ detached: true, ready: false });
const ready = Object.freeze({ detached: true, ready: true });
const ownerEvents = ["did-create-window", "did-start-navigation", "render-process-gone"];
const stateMessage = (payload) => ({ channel: "chat-window:state", payload });

function cancelableEvent() {
  return {
    defaultPrevented: false,
    preventions: 0,
    preventDefault() { this.defaultPrevented = true; this.preventions += 1; }
  };
}

class FakeWebContents extends EventEmitter {
  constructor(backgroundThrottling = true) {
    super();
    this.destroyed = false;
    this.messages = [];
    this.throttlingChanges = [];
    this.throttling = backgroundThrottling;
    this.windowOpenHandler = null;
  }

  isDestroyed() { return this.destroyed; }
  get backgroundThrottling() { return this.throttling; }
  set backgroundThrottling(value) {
    assert.equal(this.destroyed, false, "cannot set throttling on destroyed web contents");
    this.throttlingChanges.push(value);
    this.throttling = value;
  }

  send(channel, payload) {
    assert.equal(this.destroyed, false, "cannot send to destroyed web contents");
    this.messages.push({ channel, payload });
  }

  setWindowOpenHandler(handler) { this.windowOpenHandler = handler; }
}

class FakeBrowserWindow extends EventEmitter {
  constructor({ minimized = false, deferredClosed = false, backgroundThrottling = true } = {}) {
    super();
    this.webContents = new FakeWebContents(backgroundThrottling);
    this.destroyed = false;
    this.minimized = minimized;
    this.deferredClosed = deferredClosed;
    this.closedPending = false;
    this.destroyCalls = 0;
    this.calls = [];
    this.menus = [];
  }

  isDestroyed() { return this.destroyed; }
  isMinimized() { return this.minimized; }
  setMenu(menu) { this.menus.push(menu); }
  restore() {
    assert.equal(this.destroyed, false);
    this.minimized = false;
    this.calls.push("restore");
  }

  show() { assert.equal(this.destroyed, false); this.calls.push("show"); }
  focus() { assert.equal(this.destroyed, false); this.calls.push("focus"); }

  close() {
    const event = cancelableEvent();
    this.emit("close", event);
    if (!event.defaultPrevented) this.destroy();
    return event;
  }

  destroy() {
    this.destroyCalls += 1;
    if (this.destroyed) return;
    this.destroyed = true;
    this.webContents.destroyed = true;
    this.closedPending = true;
    if (!this.deferredClosed) this.flushClosed();
  }

  flushClosed() {
    if (!this.closedPending) return;
    this.closedPending = false;
    this.emit("closed");
  }
}

function fakeClock({ numericHandles = false } = {}) {
  let now = 0;
  let sequence = 0;
  const pending = new Map();
  const jobs = [];
  const cancellations = [];
  const schedule = (callback, delay) => {
    const job = { callback, delay, due: now + delay, sequence: sequence++, unrefs: 0 };
    const handle = numericHandles ? job.sequence : { unref() { job.unrefs += 1; return this; } };
    job.handle = handle;
    pending.set(handle, job);
    jobs.push(job);
    return handle;
  };
  const cancel = (handle) => { cancellations.push(handle); pending.delete(handle); };
  const advance = (duration) => {
    assert.ok(Number.isFinite(duration) && duration >= 0);
    const until = now + duration;
    while (pending.size) {
      const next = [...pending.values()].sort((a, b) => a.due - b.due || a.sequence - b.sequence)[0];
      if (next.due > until) break;
      pending.delete(next.handle);
      now = next.due;
      next.callback();
    }
    now = until;
  };
  return { schedule, cancel, advance, pending, jobs, cancellations };
}

function fixture(t, options = {}) {
  const owner = options.owner ?? new FakeBrowserWindow(options);
  const clock = fakeClock(options);
  const flags = { allowed: options.allowed ?? true, quitting: options.quitting ?? false, authChecks: 0, shownMain: 0 };
  const icon = "test-icon";
  const manager = createChatWindowManager({
    owner, icon, schedule: clock.schedule, cancel: clock.cancel,
    canOpen: () => { flags.authChecks += 1; return flags.allowed; },
    isQuitting: () => flags.quitting,
    showMain: () => { flags.shownMain += 1; }
  });
  t.after(() => manager.dispose());
  const created = (window = new FakeBrowserWindow(), details = request) => {
    owner.webContents.emit("did-create-window", window, details);
    return window;
  };
  const open = (windowOptions = {}) => {
    assert.equal(manager.handleOpen(request).action, "allow");
    return created(new FakeBrowserWindow(windowOptions));
  };
  return { owner, clock, flags, icon, manager, created, open };
}

const unrelatedRequests = [
  {}, { url: "about:blank" }, { frameName: CHAT_WINDOW_NAME },
  { ...request, frameName: "" }, { ...request, frameName: "_blank" },
  { ...request, frameName: "Booth-manager-chat" }, { ...request, frameName: `${CHAT_WINDOW_NAME} ` },
  { ...request, url: "about:Blank" }, { ...request, url: " about:blank" },
  { ...request, url: "about:blank " }, { ...request, url: "about:blank#chat" },
  { ...request, url: "about:blank?chat" }, { ...request, url: "about:srcdoc" },
  { ...request, url: "https://example.test/chat" }, { ...request, url: "file:///chat.html" },
  { ...request, url: "data:text/html,chat" }, { ...request, url: "javascript:void(0)" },
  { ...request, url: "booth-local://chat" }
];

test("the manager exposes lifecycle methods and starts without a window or reservation", (t) => {
  const h = fixture(t);
  assert.equal(CHAT_WINDOW_NAME, "booth-manager-chat");
  assert.deepEqual(Object.keys(h.manager).sort(), [
    "abort", "dispose", "finishDock", "focus", "getState", "getWindow", "handleOpen", "markReady"
  ]);
  assert.ok(Object.values(h.manager).every((value) => typeof value === "function"));
  assert.equal(h.manager.getWindow(), null);
  assert.deepEqual(h.manager.getState(), docked);
  assert.deepEqual(h.manager.focus(), { ok: false });
  assert.equal(h.clock.pending.size, 0);
  assert.deepEqual(h.owner.webContents.messages, []);
  assert.deepEqual(h.owner.webContents.throttlingChanges, []);
  assert.equal(h.flags.shownMain, 0);
});

test("only the exact chat name and about:blank pair is handled", (t) => {
  const h = fixture(t, { allowed: false, quitting: true });
  for (const details of unrelatedRequests) {
    assert.equal(h.manager.handleOpen(Object.freeze(details)), null, JSON.stringify(details));
  }
  assert.equal(h.flags.authChecks, 0);
  assert.deepEqual(h.manager.getState(), docked);
  assert.equal(h.clock.jobs.length, 0);
  assert.deepEqual(h.owner.webContents.messages, []);
});

test("an allowed request reserves one hidden isolated window with an unreferenced expiry", (t) => {
  const h = fixture(t);
  assert.deepEqual(h.manager.handleOpen(request), {
    action: "allow", outlivesOpener: false,
    overrideBrowserWindowOptions: {
      title: "Team Chat | Booth Manager", width: 1280, height: 840, minWidth: 980, minHeight: 700,
      backgroundColor: "#100e15", autoHideMenuBar: true, show: false, icon: h.icon,
      webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
    }
  });
  assert.deepEqual(h.manager.getState(), opening);
  assert.equal(h.manager.getWindow(), null);
  assert.equal(h.clock.jobs.length, 1);
  assert.equal(h.clock.pending.size, 1);
  assert.equal(h.clock.jobs[0].delay, 10_000);
  assert.equal(h.clock.jobs[0].unrefs, 1);
  assert.deepEqual(h.owner.webContents.throttlingChanges, []);
});

test("duplicate reservations neither create another window nor extend the deadline", (t) => {
  const h = fixture(t);
  h.manager.handleOpen(request);
  h.clock.advance(5_000);
  for (let index = 0; index < 8; index += 1) {
    assert.deepEqual(h.manager.handleOpen(request), { action: "deny" });
  }
  assert.equal(h.clock.jobs.length, 1);
  assert.equal(h.clock.pending.size, 1);
  h.clock.advance(4_999);
  assert.deepEqual(h.manager.getState(), opening);
  assert.deepEqual(h.owner.webContents.messages, []);
  h.clock.advance(1);
  assert.deepEqual(h.manager.getState(), docked);
  assert.deepEqual(h.owner.webContents.messages, [stateMessage(docked)]);
  assert.equal(h.clock.pending.size, 0);
  assert.equal(h.flags.shownMain, 0);
  assert.equal(h.manager.handleOpen(request).action, "allow");
});

test("abort cancels a failed creation without letting the old deadline clear a retry", (t) => {
  const h = fixture(t);
  h.manager.handleOpen(request);
  const first = h.clock.jobs[0].handle;
  h.clock.advance(1_000);
  assert.deepEqual(h.manager.abort(), { ok: true });
  assert.deepEqual(h.clock.cancellations, [first]);
  assert.deepEqual(h.manager.getState(), docked);
  assert.deepEqual(h.owner.webContents.messages, [stateMessage(docked)]);
  assert.equal(h.clock.pending.size, 0);
  assert.equal(h.flags.shownMain, 0);
  assert.equal(h.manager.handleOpen(request).action, "allow");
  h.clock.advance(9_000);
  assert.deepEqual(h.manager.getState(), opening);
  assert.equal(h.clock.pending.size, 1);
  h.clock.advance(1_000);
  assert.deepEqual(h.manager.getState(), docked);
});

for (const failure of ["unrequested", "aborted", "expired"]) {
  test(`a ${failure} native creation is destroyed instead of being adopted`, (t) => {
    const h = fixture(t);
    if (failure !== "unrequested") h.manager.handleOpen(request);
    if (failure === "aborted") h.manager.abort();
    if (failure === "expired") h.clock.advance(10_000);
    h.owner.webContents.messages.length = 0;
    const child = h.created();
    assert.equal(child.destroyCalls, 1);
    assert.equal(h.manager.getWindow(), null);
    assert.deepEqual(h.manager.getState(), docked);
    assert.equal(h.clock.pending.size, 0);
    assert.deepEqual(h.owner.webContents.messages, []);
    assert.deepEqual(h.owner.webContents.throttlingChanges, []);
  });
}

test("markReady fails before creation even when the slot is reserved", (t) => {
  const h = fixture(t);
  const failure = { ok: false, error: "The chat window could not be opened." };
  assert.deepEqual(h.manager.markReady(), failure);
  h.manager.handleOpen(request);
  assert.deepEqual(h.manager.markReady(), failure);
  assert.deepEqual(h.manager.getState(), opening);
  assert.deepEqual(h.manager.focus(), { ok: false });
  assert.equal(h.clock.pending.size, 1);
  assert.deepEqual(h.owner.webContents.messages, []);
  assert.equal(h.flags.shownMain, 0);
});

test("matching creation consumes the reservation but stays hidden until readiness", (t) => {
  const h = fixture(t);
  h.manager.handleOpen(request);
  const child = h.created();
  assert.equal(h.manager.getWindow(), child);
  assert.deepEqual(h.manager.getState(), opening);
  assert.equal(h.clock.pending.size, 0);
  assert.deepEqual(h.clock.cancellations, [h.clock.jobs[0].handle]);
  assert.deepEqual(child.menus, [null]);
  assert.deepEqual(child.calls, []);
  assert.equal(h.owner.webContents.backgroundThrottling, false);
  assert.deepEqual(h.owner.webContents.messages, [stateMessage(opening)]);
  h.clock.advance(20_000);
  assert.equal(h.manager.getWindow(), child);
  assert.deepEqual(h.manager.getState(), opening);
  assert.deepEqual(h.owner.webContents.messages, [stateMessage(opening)]);
});

test("unrelated native windows cannot consume or alter the chat reservation", (t) => {
  const h = fixture(t);
  h.manager.handleOpen(request);
  for (const details of unrelatedRequests) {
    const other = h.created(new FakeBrowserWindow(), details);
    assert.equal(other.destroyCalls, 0, JSON.stringify(details));
    assert.deepEqual(other.menus, []);
    assert.equal(other.listenerCount("close"), 0);
    assert.equal(other.webContents.windowOpenHandler, null);
  }
  assert.equal(h.manager.getWindow(), null);
  assert.deepEqual(h.manager.getState(), opening);
  assert.equal(h.clock.pending.size, 1);
  assert.deepEqual(h.owner.webContents.throttlingChanges, []);
  assert.deepEqual(h.owner.webContents.messages, []);
  const child = h.created();
  assert.equal(h.manager.getWindow(), child);
});

test("a second matching native window is destroyed without replacing the singleton", (t) => {
  const h = fixture(t);
  const child = h.open();
  h.manager.markReady();
  h.owner.webContents.messages.length = 0;
  const duplicate = h.created();
  assert.equal(duplicate.destroyCalls, 1);
  assert.equal(child.destroyCalls, 0);
  assert.equal(h.manager.getWindow(), child);
  assert.deepEqual(h.manager.getState(), ready);
  assert.deepEqual(h.owner.webContents.messages, []);
  assert.deepEqual(h.owner.webContents.throttlingChanges, [false]);
});

test("duplicate requests do not reveal a child before it is ready", (t) => {
  const h = fixture(t);
  const child = h.open({ minimized: true });
  assert.deepEqual(h.manager.handleOpen(request), { action: "deny" });
  assert.deepEqual(child.calls, []);
  assert.deepEqual(h.manager.getState(), opening);
  assert.equal(h.clock.jobs.length, 1);
  assert.equal(h.clock.pending.size, 0);
});

test("readiness restores shows and focuses the created child and broadcasts ready state", (t) => {
  const h = fixture(t);
  const child = h.open({ minimized: true });
  h.owner.webContents.messages.length = 0;
  assert.deepEqual(h.manager.markReady(), { ok: true });
  assert.deepEqual(child.calls, ["restore", "show", "focus"]);
  assert.deepEqual(h.manager.getState(), ready);
  assert.deepEqual(h.owner.webContents.messages, [stateMessage(ready)]);
  assert.equal(h.flags.shownMain, 0);
});

test("a duplicate ready request focuses the existing child without allocating another slot", (t) => {
  const h = fixture(t);
  const child = h.open();
  h.manager.markReady();
  child.minimized = true;
  child.calls.length = 0;
  h.owner.webContents.messages.length = 0;
  assert.deepEqual(h.manager.handleOpen(request), { action: "deny" });
  assert.deepEqual(child.calls, ["restore", "show", "focus"]);
  assert.deepEqual(h.manager.focus(), { ok: true });
  assert.deepEqual(child.calls, ["restore", "show", "focus", "show", "focus"]);
  assert.equal(h.manager.getWindow(), child);
  assert.equal(h.clock.jobs.length, 1);
  assert.equal(h.clock.pending.size, 0);
  assert.deepEqual(h.owner.webContents.messages, []);
});

test("destroyed children cannot be focused or marked ready while closed is pending", (t) => {
  const h = fixture(t);
  const child = h.open({ deferredClosed: true });
  child.destroy();
  assert.deepEqual(h.manager.focus(), { ok: false });
  assert.equal(h.manager.markReady().ok, false);
  assert.deepEqual(child.calls, []);
  child.flushClosed();
  assert.equal(h.manager.getWindow(), null);
  assert.deepEqual(h.manager.getState(), docked);
});

test("state snapshots and sent payloads cannot mutate lifecycle authority", (t) => {
  const h = fixture(t);
  const idleSnapshot = h.manager.getState();
  h.manager.handleOpen(request);
  const reservedSnapshot = h.manager.getState();
  Reflect.set(reservedSnapshot, "detached", false);
  Reflect.set(reservedSnapshot, "ready", true);
  Reflect.set(reservedSnapshot, "child", new FakeBrowserWindow());
  assert.deepEqual(h.manager.getState(), opening);
  assert.equal(h.manager.getWindow(), null);
  assert.deepEqual(h.manager.handleOpen(request), { action: "deny" });
  const child = h.created();
  const openingSnapshot = h.manager.getState();
  h.manager.markReady();
  assert.deepEqual(idleSnapshot, docked);
  assert.deepEqual(openingSnapshot, opening);
  for (const message of h.owner.webContents.messages) {
    Reflect.set(message.payload, "detached", false);
    Reflect.set(message.payload, "ready", false);
  }
  const readySnapshot = h.manager.getState();
  Reflect.set(readySnapshot, "detached", false);
  Reflect.set(readySnapshot, "ready", false);
  assert.deepEqual(h.manager.getState(), ready);
  assert.equal(h.manager.getWindow(), child);
  assert.deepEqual(h.manager.abort(), { ok: false });
  h.manager.finishDock();
  assert.deepEqual(h.manager.getState(), docked);
});

for (const isReady of [false, true]) {
  test(`abort cannot dispose an existing child with readiness ${isReady}`, (t) => {
    const h = fixture(t);
    const child = h.open();
    if (isReady) h.manager.markReady();
    h.owner.webContents.messages.length = 0;
    assert.deepEqual(h.manager.abort(), { ok: false });
    assert.equal(h.manager.getWindow(), child);
    assert.deepEqual(h.manager.getState(), isReady ? ready : opening);
    assert.equal(child.destroyCalls, 0);
    assert.deepEqual(h.owner.webContents.messages, []);
    assert.equal(h.flags.shownMain, 0);
  });

  test(`native close requests docking without destroying a child with readiness ${isReady}`, (t) => {
    const h = fixture(t);
    const child = h.open();
    if (isReady) h.manager.markReady();
    h.owner.webContents.messages.length = 0;
    const event = child.close();
    assert.equal(event.defaultPrevented, true);
    assert.equal(event.preventions, 1);
    assert.equal(child.isDestroyed(), false);
    assert.equal(child.destroyCalls, 0);
    assert.equal(h.manager.getWindow(), child);
    assert.deepEqual(h.manager.getState(), isReady ? ready : opening);
    assert.deepEqual(h.owner.webContents.messages, [{ channel: "chat-window:dock-request", payload: undefined }]);
    assert.equal(h.owner.webContents.backgroundThrottling, false);
    assert.equal(h.flags.shownMain, 0);
    assert.equal(child.close().defaultPrevented, true);
    assert.equal(child.destroyCalls, 0);
  });
}

for (const deferredClosed of [false, true]) {
  test(`finishDock disposes once and broadcasts once with deferred closed ${deferredClosed}`, (t) => {
    const h = fixture(t);
    const child = h.open({ deferredClosed });
    h.manager.markReady();
    h.owner.webContents.messages.length = 0;
    assert.deepEqual(h.manager.finishDock(), { ok: true });
    child.flushClosed();
    assert.equal(child.destroyCalls, 1);
    assert.equal(h.manager.getWindow(), null);
    assert.deepEqual(h.manager.getState(), docked);
    assert.deepEqual(h.owner.webContents.messages, [stateMessage(docked)]);
    assert.deepEqual(h.owner.webContents.throttlingChanges, [false, true]);
    assert.equal(h.flags.shownMain, 1);
    assert.equal(h.clock.pending.size, 0);
  });
}

test("repeated dock completion has no duplicate disposal focus or state broadcast", (t) => {
  const h = fixture(t);
  const child = h.open({ deferredClosed: true });
  h.manager.finishDock();
  child.flushClosed();
  h.owner.webContents.messages.length = 0;
  assert.deepEqual(h.manager.finishDock(), { ok: true });
  assert.deepEqual(h.manager.finishDock(), { ok: true });
  assert.equal(child.destroyCalls, 1);
  assert.equal(h.flags.shownMain, 1);
  assert.deepEqual(h.owner.webContents.messages, []);
  assert.deepEqual(h.owner.webContents.throttlingChanges, [false, true]);
});

for (const quiet of [false, true]) {
  test(`docking a reservation cancels expiry and honors quiet ${quiet}`, (t) => {
    const h = fixture(t);
    h.manager.handleOpen(request);
    assert.deepEqual(h.manager.finishDock({ quiet }), { ok: true });
    assert.equal(h.clock.pending.size, 0);
    assert.deepEqual(h.clock.cancellations, [h.clock.jobs[0].handle]);
    assert.deepEqual(h.manager.getState(), docked);
    assert.deepEqual(h.owner.webContents.messages, [stateMessage(docked)]);
    assert.equal(h.flags.shownMain, quiet ? 0 : 1);
    h.clock.advance(20_000);
    assert.deepEqual(h.owner.webContents.messages, [stateMessage(docked)]);
  });
}

test("unexpected closed broadcasts once restores throttling and permits a new window", (t) => {
  const h = fixture(t);
  const child = h.open();
  h.manager.markReady();
  h.owner.webContents.messages.length = 0;
  child.destroy();
  child.emit("closed");
  assert.deepEqual(h.owner.webContents.messages, [stateMessage(docked)]);
  assert.deepEqual(h.manager.getState(), docked);
  assert.equal(h.manager.getWindow(), null);
  assert.deepEqual(h.owner.webContents.throttlingChanges, [false, true]);
  assert.equal(h.flags.shownMain, 0);
  const replacement = h.open();
  assert.equal(h.manager.getWindow(), replacement);
  assert.notEqual(replacement, child);
});

test("a late closed event cannot clear a replacement window or restore its throttling", (t) => {
  const h = fixture(t);
  const old = h.open({ deferredClosed: true });
  h.manager.finishDock();
  const replacement = h.open();
  h.manager.markReady();
  h.owner.webContents.messages.length = 0;
  const changes = [...h.owner.webContents.throttlingChanges];
  old.flushClosed();
  assert.equal(h.manager.getWindow(), replacement);
  assert.deepEqual(h.manager.getState(), ready);
  assert.equal(h.owner.webContents.backgroundThrottling, false);
  assert.deepEqual(h.owner.webContents.throttlingChanges, changes);
  assert.deepEqual(h.owner.webContents.messages, []);
});

const ownerCleanup = {
  navigation: (contents) => contents.emit("did-start-navigation", {}, "https://example.test/next", false, true),
  rendererLoss: (contents) => contents.emit("render-process-gone", {}, { reason: "crashed" })
};

for (const [cause, notify] of Object.entries(ownerCleanup)) {
  for (const phase of ["reserved", "created", "ready"]) {
    test(`owner ${cause} quietly clears a ${phase} chat lifecycle`, (t) => {
      const h = fixture(t);
      h.manager.handleOpen(request);
      const child = phase === "reserved" ? null : h.created();
      if (phase === "ready") h.manager.markReady();
      h.owner.webContents.messages.length = 0;
      notify(h.owner.webContents);
      assert.equal(h.manager.getWindow(), null);
      assert.deepEqual(h.manager.getState(), docked);
      assert.equal(h.clock.pending.size, 0);
      assert.equal(child?.destroyCalls ?? 0, phase === "reserved" ? 0 : 1);
      assert.equal(h.owner.webContents.backgroundThrottling, true);
      assert.equal(h.flags.shownMain, 0);
      assert.ok(h.owner.webContents.messages.length > 0);
      assert.ok(h.owner.webContents.messages.every((message) => message.channel === "chat-window:state"));
      assert.deepEqual(h.owner.webContents.messages.at(-1), stateMessage(docked));
      const messages = [...h.owner.webContents.messages];
      h.clock.advance(20_000);
      assert.deepEqual(h.owner.webContents.messages, messages);
      assert.equal(h.manager.handleOpen(request).action, "allow");
    });
  }
}

for (const phase of ["reserved", "ready"]) {
  test(`subframe and in place navigation leave a ${phase} chat untouched`, (t) => {
    const h = fixture(t);
    h.manager.handleOpen(request);
    const child = phase === "ready" ? h.created() : null;
    if (child) h.manager.markReady();
    h.owner.webContents.messages.length = 0;
    for (const [inPlace, mainFrame] of [[true, true], [false, false], [true, false]]) {
      h.owner.webContents.emit("did-start-navigation", {}, "https://example.test/#chat", inPlace, mainFrame);
      assert.equal(h.manager.getWindow(), child);
      assert.deepEqual(h.manager.getState(), child ? ready : opening);
      assert.equal(child?.destroyCalls ?? 0, 0);
      assert.equal(h.clock.pending.size, child ? 0 : 1);
    }
    assert.deepEqual(h.owner.webContents.messages, []);
    assert.equal(h.flags.shownMain, 0);
  });
}

for (const destroyedTarget of ["owner", "webContents"]) {
  test(`cleanup never sends IPC to destroyed ${destroyedTarget}`, (t) => {
    const h = fixture(t);
    const child = h.open();
    h.manager.markReady();
    h.owner.webContents.messages.length = 0;
    const changes = [...h.owner.webContents.throttlingChanges];
    if (destroyedTarget === "owner") h.owner.destroyed = true;
    else h.owner.webContents.destroyed = true;
    assert.doesNotThrow(() => ownerCleanup.rendererLoss(h.owner.webContents));
    assert.equal(child.destroyCalls, 1);
    assert.deepEqual(h.manager.getState(), docked);
    assert.deepEqual(h.owner.webContents.messages, []);
    assert.equal(h.flags.shownMain, 0);
    if (destroyedTarget === "webContents") assert.deepEqual(h.owner.webContents.throttlingChanges, changes);
  });
}

test("dispose cancels reservations and removes only its own owner listeners", (t) => {
  const owner = new FakeBrowserWindow();
  const observed = [];
  const listeners = new Map(ownerEvents.map((name) => [name, () => observed.push(name)]));
  for (const [name, listener] of listeners) owner.webContents.on(name, listener);
  const h = fixture(t, { owner });
  for (const name of ownerEvents) assert.equal(owner.webContents.listenerCount(name), 2);
  h.manager.handleOpen(request);
  h.manager.dispose();
  h.manager.dispose();
  assert.equal(h.clock.pending.size, 0);
  assert.deepEqual(h.clock.cancellations, [h.clock.jobs[0].handle]);
  for (const [name, listener] of listeners) assert.deepEqual(owner.webContents.listeners(name), [listener]);
  const late = h.created();
  ownerCleanup.navigation(owner.webContents);
  ownerCleanup.rendererLoss(owner.webContents);
  h.clock.advance(20_000);
  assert.deepEqual(observed, ownerEvents);
  assert.equal(late.destroyCalls, 0);
  assert.deepEqual(h.manager.getState(), docked);
  assert.deepEqual(owner.webContents.messages, []);
  assert.equal(h.flags.shownMain, 0);
});

for (const backgroundThrottling of [false, true]) {
  for (const deferredClosed of [false, true]) {
    test(`dispose restores throttling ${backgroundThrottling} with deferred closed ${deferredClosed}`, (t) => {
      const h = fixture(t, { backgroundThrottling });
      const child = h.open({ deferredClosed });
      h.manager.markReady();
      h.owner.webContents.messages.length = 0;
      h.manager.dispose();
      child.flushClosed();
      h.manager.dispose();
      h.clock.advance(20_000);
      assert.equal(child.destroyCalls, 1);
      assert.equal(h.manager.getWindow(), null);
      assert.deepEqual(h.manager.getState(), docked);
      assert.equal(h.owner.webContents.backgroundThrottling, backgroundThrottling);
      assert.deepEqual(h.owner.webContents.throttlingChanges, [false, backgroundThrottling]);
      assert.deepEqual(h.owner.webContents.messages, []);
      assert.equal(h.flags.shownMain, 0);
      assert.equal(h.clock.pending.size, 0);
      for (const name of ownerEvents) assert.equal(h.owner.webContents.listenerCount(name), 0);
    });
  }
}

test("each new child captures the current owner throttling rather than an old default", (t) => {
  const h = fixture(t);
  h.open();
  h.manager.finishDock();
  h.owner.webContents.backgroundThrottling = false;
  h.owner.webContents.throttlingChanges.length = 0;
  h.open();
  h.manager.finishDock();
  assert.equal(h.owner.webContents.backgroundThrottling, false);
  assert.deepEqual(h.owner.webContents.throttlingChanges, [false, false]);
});

test("disposed lifecycle methods cannot reserve focus resurrect or broadcast a window", (t) => {
  const h = fixture(t);
  h.manager.dispose();
  assert.deepEqual(h.manager.handleOpen(request), { action: "deny" });
  assert.deepEqual(h.manager.focus(), { ok: false });
  assert.equal(h.manager.markReady().ok, false);
  assert.deepEqual(h.manager.abort(), { ok: true });
  assert.deepEqual(h.manager.finishDock(), { ok: true });
  assert.equal(h.manager.getWindow(), null);
  assert.deepEqual(h.manager.getState(), docked);
  assert.equal(h.clock.jobs.length, 0);
  assert.deepEqual(h.owner.webContents.messages, []);
  assert.equal(h.flags.authChecks, 0);
  assert.equal(h.flags.shownMain, 0);
});

test("numeric timer handle zero is canceled without requiring unref", (t) => {
  const h = fixture(t, { numericHandles: true });
  assert.equal(h.manager.handleOpen(request).action, "allow");
  assert.equal(h.clock.jobs[0].handle, 0);
  assert.equal(h.clock.jobs[0].unrefs, 0);
  h.manager.abort();
  assert.deepEqual(h.clock.cancellations, [0]);
  assert.equal(h.clock.pending.size, 0);
  h.clock.advance(10_000);
  assert.deepEqual(h.owner.webContents.messages, [stateMessage(docked)]);
});

test("default optional callbacks work with only fake owner and scheduler dependencies", (t) => {
  const owner = new FakeBrowserWindow();
  const clock = fakeClock();
  const manager = createChatWindowManager({ owner, schedule: clock.schedule, cancel: clock.cancel });
  t.after(() => manager.dispose());
  assert.equal(manager.handleOpen(request).action, "allow");
  const child = new FakeBrowserWindow();
  owner.webContents.emit("did-create-window", child, request);
  assert.deepEqual(manager.markReady(), { ok: true });
  assert.deepEqual(manager.finishDock(), { ok: true });
  assert.equal(child.destroyCalls, 1);
  assert.equal(clock.pending.size, 0);
});

test("authorization denial creates no reservation and is reevaluated for each request", (t) => {
  const h = fixture(t, { allowed: false });
  assert.deepEqual(h.manager.handleOpen(request), { action: "deny" });
  assert.deepEqual(h.manager.getState(), docked);
  assert.equal(h.flags.authChecks, 1);
  assert.equal(h.clock.jobs.length, 0);
  const unsolicited = h.created();
  assert.equal(unsolicited.destroyCalls, 1);
  h.flags.allowed = true;
  const child = h.open();
  h.manager.markReady();
  child.calls.length = 0;
  h.owner.webContents.messages.length = 0;
  h.flags.allowed = false;
  assert.deepEqual(h.manager.handleOpen(request), { action: "deny" });
  assert.deepEqual(child.calls, []);
  assert.equal(h.manager.getWindow(), child);
  assert.deepEqual(h.manager.getState(), ready);
  assert.deepEqual(h.owner.webContents.messages, []);
  h.flags.allowed = true;
  assert.deepEqual(h.manager.handleOpen(request), { action: "deny" });
  assert.deepEqual(child.calls, ["show", "focus"]);
});

for (const gate of ["authorization", "quitting"]) {
  test(`native creation rejects a reservation when ${gate} changes before creation`, (t) => {
    const h = fixture(t);
    h.manager.handleOpen(request);
    if (gate === "authorization") h.flags.allowed = false;
    else h.flags.quitting = true;
    const child = h.created();
    assert.equal(child.destroyCalls, 1);
    assert.equal(h.manager.getWindow(), null);
    assert.deepEqual(h.manager.getState(), docked);
    assert.equal(h.manager.markReady().ok, false);
    assert.equal(h.clock.pending.size, 0);
    assert.deepEqual(h.owner.webContents.throttlingChanges, []);
    assert.deepEqual(child.calls, []);
    assert.equal(h.flags.shownMain, 0);
  });
}

test("quitting denies new windows before consulting authorization", (t) => {
  const h = fixture(t, { quitting: true });
  assert.deepEqual(h.manager.handleOpen(request), { action: "deny" });
  assert.equal(h.flags.authChecks, 0);
  assert.equal(h.clock.jobs.length, 0);
  assert.deepEqual(h.manager.getState(), docked);
  assert.deepEqual(h.owner.webContents.messages, []);
});

test("native close bypasses the docking handshake during quit", (t) => {
  const h = fixture(t);
  const child = h.open();
  h.manager.markReady();
  h.owner.webContents.messages.length = 0;
  h.flags.quitting = true;
  const event = child.close();
  assert.equal(event.defaultPrevented, false);
  assert.equal(event.preventions, 0);
  assert.equal(child.destroyCalls, 1);
  assert.deepEqual(h.manager.getState(), docked);
  assert.deepEqual(h.owner.webContents.messages, [stateMessage(docked)]);
  assert.equal(h.owner.webContents.backgroundThrottling, true);
  assert.equal(h.flags.shownMain, 0);
});

for (const hasChild of [false, true]) {
  test(`explicit dock completion during quit stays quiet with child ${hasChild}`, (t) => {
    const h = fixture(t);
    h.manager.handleOpen(request);
    const child = hasChild ? h.created() : null;
    h.flags.quitting = true;
    h.owner.webContents.messages.length = 0;
    assert.deepEqual(h.manager.finishDock(), { ok: true });
    assert.equal(child?.destroyCalls ?? 0, hasChild ? 1 : 0);
    assert.deepEqual(h.manager.getState(), docked);
    assert.equal(h.clock.pending.size, 0);
    assert.equal(h.flags.shownMain, 0);
    assert.ok(h.owner.webContents.messages.every((message) => message.channel === "chat-window:state"));
  });
}

test("the child denies nested windows and cancels all document and frame navigation", (t) => {
  const h = fixture(t);
  const child = h.open();
  assert.equal(typeof child.webContents.windowOpenHandler, "function");
  for (const details of [request, { url: "https://example.test/", frameName: "_blank" }]) {
    assert.deepEqual(child.webContents.windowOpenHandler(details), { action: "deny" });
  }
  for (const name of ["will-navigate", "will-frame-navigate"]) {
    const event = cancelableEvent();
    child.webContents.emit(name, event, "https://example.test/");
    assert.equal(event.defaultPrevented, true, name);
    assert.equal(event.preventions, 1, name);
  }
  assert.equal(h.manager.getWindow(), child);
  assert.deepEqual(h.manager.getState(), opening);
  assert.equal(child.destroyCalls, 0);
});

test("reload shortcuts are blocked without swallowing ordinary typing", (t) => {
  const h = fixture(t);
  const child = h.open();
  const cases = [
    [{ key: "F5" }, true], [{ key: "F5", shift: true }, true],
    [{ key: "r", control: true }, true], [{ key: "R", control: true, shift: true }, true],
    [{ key: "r", meta: true }, true], [{ key: "R", meta: true, shift: true }, true],
    [{ key: "r" }, false], [{ key: "R", shift: true }, false], [{ key: "r", alt: true }, false],
    [{ key: "c", control: true }, false], [{ key: "v", meta: true }, false],
    [{ key: "Enter" }, false], [{ key: "F12" }, false]
  ];
  for (const [input, blocked] of cases) {
    const event = cancelableEvent();
    child.webContents.emit("before-input-event", event, input);
    assert.equal(event.defaultPrevented, blocked, JSON.stringify(input));
    assert.equal(event.preventions, blocked ? 1 : 0, JSON.stringify(input));
  }
  assert.equal(child.destroyCalls, 0);
  assert.deepEqual(child.calls, []);
});