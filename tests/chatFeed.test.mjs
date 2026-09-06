import test from "node:test";
import assert from "node:assert/strict";
import { createRoomFeed, normalizeMessages } from "../src/lib/chatFeed.mjs";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function freezeTree(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freezeTree);
    Object.freeze(value);
  }
  return value;
}

function message(id, minute = 0, extra = {}) {
  return {
    id, authorId: "peer", authorName: "Peer", body: `message ${id}`, attachments: [],
    createdAt: new Date(Date.UTC(2026, 8, 5, 12, minute)).toISOString(), ...extra
  };
}

const ids = (messages) => messages.map((item) => item.id);
const response = (messages, community = { id: "general", name: "General" }) => ({
  status: 200, data: { messages, community }
});

function makeFeed(t, options = {}) {
  const requests = [];
  const published = [];
  const incoming = [];
  const peers = [];
  const feed = createRoomFeed({
    roomId: options.roomId ?? "general",
    request: options.request ?? ((url) => {
      const pending = deferred();
      requests.push({ url, ...pending });
      return pending.promise;
    }),
    publish(snapshot) {
      published.push(snapshot);
      options.onPublish?.(snapshot);
    },
    onIncoming(messages) {
      incoming.push(messages);
      options.onIncoming?.(messages);
    },
    onMessages(messages) {
      peers.push(messages);
      options.onMessages?.(messages);
    }
  });
  t.after(() => feed.dispose());
  return { feed, requests, published, incoming, peers };
}

async function load(harness, messages, community) {
  const index = harness.requests.length;
  const pending = harness.feed.refresh();
  assert.equal(harness.requests.length, index + 1, "a fresh load must issue a request");
  harness.requests[index].resolve(response(messages, community));
  await pending;
  return harness.feed.getState();
}

async function loadMembers(harness, members) {
  const index = harness.requests.length;
  const pending = harness.feed.refreshMembers();
  assert.equal(harness.requests.length, index + 1, "a fresh member load must issue a request");
  harness.requests[index].resolve({ status: 200, data: { members } });
  await pending;
  return harness.feed.getState();
}

test("normalizeMessages rejects a malformed list instead of inventing an empty snapshot", () => {
  for (const value of [undefined, null, false, 42, "[]", {}]) {
    assert.throws(() => normalizeMessages(value), /invalid message list/);
  }
  assert.deepEqual(normalizeMessages([]), []);
});

test("normalizeMessages skips malformed records and normalizes supported IDs and text", () => {
  const value = message(0, 0, { body: 42, authorName: null, attachments: null });
  const actual = normalizeMessages([
    undefined, null, false, 7, "message", [], {},
    { id: "" }, { id: null }, { id: false }, { id: [] }, { id: {} }, value
  ]);
  assert.deepEqual(actual, [{
    ...value, id: "0", body: "", authorName: "Unknown member", attachments: []
  }]);
});

test("normalizeMessages deduplicates string and numeric IDs using the last record", () => {
  const actual = normalizeMessages([
    message(7, 3, { body: "old body" }), message("early", 1),
    message("7", 2, { body: "confirmed body" }), message("last", 4)
  ]);
  assert.deepEqual(ids(actual), ["early", "7", "last"]);
  assert.equal(actual[1].body, "confirmed body");
  assert.equal(actual[1].createdAt, message("7", 2).createdAt);
});

test("normalizeMessages sorts valid timestamps including offsets and keeps ties stable", () => {
  const actual = normalizeMessages([
    message("late", 30),
    message("offset", 0, { createdAt: "2026-09-05T14:00:00+02:00" }),
    message("early", 0, { createdAt: "2026-09-05T11:30:00Z" }),
    message("tie", 0)
  ]);
  assert.deepEqual(ids(actual), ["early", "offset", "tie", "late"]);
});

test("normalizeMessages retains records with absent or invalid timestamps without inventing dates", () => {
  const actual = normalizeMessages([
    { id: "absent" }, { id: "invalid", createdAt: "not a date" }, message("valid")
  ]);
  assert.equal(actual.length, 3);
  assert.equal(actual.find((item) => item.id === "absent").createdAt, undefined);
  assert.equal(actual.find((item) => item.id === "invalid").createdAt, "not a date");
  assert.equal(actual.find((item) => item.id === "valid").createdAt, message("valid").createdAt);
});

test("normalizeMessages filters malformed attachments without mutating the response", () => {
  const attachment = { id: "file", name: "notes.txt" };
  const input = freezeTree([
    message("late", 2, { attachments: [null, [], "file", 1, {}, { id: "" }, { id: 0 }, attachment] }),
    message("early", 1, { attachments: "invalid" })
  ]);
  const before = structuredClone(input);
  const actual = normalizeMessages(input);
  assert.deepEqual(ids(actual), ["early", "late"]);
  assert.deepEqual(actual[0].attachments, []);
  assert.deepEqual(actual[1].attachments, [attachment]);
  assert.notStrictEqual(actual, input);
  assert.notStrictEqual(actual[1], input[0]);
  assert.notStrictEqual(actual[1].attachments, input[0].attachments);
  assert.deepEqual(input, before);
});

test("the first snapshot publishes sorted messages and peers without incoming notifications", async (t) => {
  const h = makeFeed(t, { roomId: "room /?&" });
  assert.deepEqual(h.feed.getState(), {
    messages: [], room: null, members: [], loading: true, refreshing: false,
    hasLoaded: false, error: "", membersError: "", updatedAt: null
  });
  assert.deepEqual(h.published, []);
  const pending = h.feed.refresh();
  assert.equal(h.requests[0].url, "/api/chat/messages?communityId=room%20%2F%3F%26&limit=300");
  assert.equal(h.feed.getState().loading, true);
  assert.equal(h.feed.getState().refreshing, false);
  const community = { id: "room /?&", name: "A room" };
  h.requests[0].resolve(freezeTree(response([message("later", 2), message("earlier", 1)], community)));
  await pending;
  const state = h.feed.getState();
  assert.deepEqual(ids(state.messages), ["earlier", "later"]);
  assert.deepEqual(state.room, community);
  assert.equal(state.hasLoaded, true);
  assert.equal(state.loading, false);
  assert.equal(state.refreshing, false);
  assert.equal(state.error, "");
  assert.ok(Number.isFinite(Date.parse(state.updatedAt)));
  assert.deepEqual(h.peers, [state.messages]);
  assert.deepEqual(h.incoming, []);
  assert.strictEqual(h.published.at(-1), state);
});

test("later snapshots invoke incoming only for new IDs while peers receive the entire snapshot", async (t) => {
  const h = makeFeed(t);
  await load(h, [message("old", 0), message("existing", 1)]);
  const records = [
    message("old", 0, { body: "edited text" }), message("existing", 1),
    message("newer", 3, { body: "duplicate first copy" }), message("new", 2),
    message("newer", 3, { body: "duplicate final copy" })
  ];
  await load(h, records);
  assert.equal(h.incoming.length, 1);
  assert.deepEqual(ids(h.incoming[0]), ["new", "newer"]);
  assert.equal(h.incoming[0][1].body, "duplicate final copy");
  assert.deepEqual(ids(h.peers.at(-1)), ["old", "existing", "new", "newer"]);
  await load(h, records);
  assert.equal(h.incoming.length, 1);
  assert.equal(h.peers.length, 3);
});

test("previously seen records do not notify again after disappearing from a snapshot", async (t) => {
  const h = makeFeed(t);
  await load(h, [message("old")]);
  await load(h, []);
  await load(h, [message("old"), message("new", 1)]);
  assert.deepEqual(h.incoming.map(ids), [["new"]]);
});

test("overlapping refresh calls return the same promise and make one request", async (t) => {
  const h = makeFeed(t);
  const first = h.feed.refresh();
  const duplicate = h.feed.refresh();
  assert.strictEqual(first, duplicate);
  assert.equal(h.requests.length, 1);
  assert.equal(h.published.length, 1);
  h.requests[0].resolve(response([message("old")]));
  await Promise.all([first, duplicate]);
  const next = h.feed.refresh();
  assert.notStrictEqual(next, first);
  assert.strictEqual(h.feed.refresh(), next);
  assert.equal(h.requests.length, 2);
  assert.equal(h.feed.getState().loading, false);
  assert.equal(h.feed.getState().refreshing, true);
  h.requests[1].resolve(response([message("old"), message("new", 1)]));
  await next;
  assert.deepEqual(h.incoming.map(ids), [["new"]]);
});

test("member refreshes share their own promise without blocking a message refresh", async (t) => {
  const h = makeFeed(t, { roomId: "room /?&" });
  const members = h.feed.refreshMembers();
  assert.strictEqual(members, h.feed.refreshMembers());
  const messages = h.feed.refresh();
  assert.notStrictEqual(messages, members);
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[0].url, "/api/chat/members?communityId=room%20%2F%3F%26");
  const member = { id: "peer", name: "Peer" };
  h.requests[0].resolve({ status: 200, data: { members: [null, [], "bad", false, member] } });
  await members;
  assert.deepEqual(h.feed.getState().members, [member]);
  assert.deepEqual(h.peers, []);
  assert.deepEqual(h.incoming, []);
  h.requests[1].resolve(response([message("old")]));
  await messages;
  assert.deepEqual(h.feed.getState().members, [member]);
  assert.equal(h.peers.length, 1);
  const again = h.feed.refreshMembers();
  assert.notStrictEqual(again, members);
  assert.equal(h.requests.length, 3);
  h.requests[2].resolve({ status: 200, data: { members: [] } });
  await again;
  assert.deepEqual(h.feed.getState().members, []);
  assert.deepEqual(ids(h.feed.getState().messages), ["old"]);
});

test("a feed with no room does not request messages or members", async (t) => {
  const h = makeFeed(t, { roomId: "" });
  await Promise.all([h.feed.refresh(), h.feed.refreshMembers()]);
  assert.deepEqual(h.requests, []);
  assert.deepEqual(h.published, []);
  assert.deepEqual(h.peers, []);
  assert.deepEqual(h.incoming, []);
});

test("disposed feeds ignore new refresh append and remove operations", async (t) => {
  const h = makeFeed(t);
  await load(h, [message("old")]);
  const state = h.feed.getState();
  const counts = [h.requests.length, h.published.length, h.peers.length, h.incoming.length];
  h.feed.dispose();
  h.feed.dispose();
  h.feed.append(message("late", 1));
  h.feed.remove("old");
  await Promise.all([h.feed.refresh(), h.feed.refreshMembers()]);
  assert.deepEqual([h.requests.length, h.published.length, h.peers.length, h.incoming.length], counts);
  assert.strictEqual(h.feed.getState(), state);
});

for (const firstCompletion of ["messages", "members"]) {
  test(`disposal silences late message and member responses when ${firstCompletion} completes first`, async (t) => {
    const h = makeFeed(t);
    await load(h, [message("old")]);
    await loadMembers(h, [{ id: "oldPeer", name: "Old peer" }]);
    const messages = h.feed.refresh();
    const messageRequest = h.requests.at(-1);
    const members = h.feed.refreshMembers();
    const memberRequest = h.requests.at(-1);
    const before = h.feed.getState();
    const counts = [h.published.length, h.peers.length, h.incoming.length];
    h.feed.dispose();
    if (firstCompletion === "messages") {
      messageRequest.resolve(response([message("late", 1)]));
      await messages;
      memberRequest.resolve({ status: 200, data: { members: [{ id: "latePeer" }] } });
      await members;
    } else {
      memberRequest.resolve({ status: 200, data: { members: [{ id: "latePeer" }] } });
      await members;
      messageRequest.resolve(response([message("late", 1)]));
      await messages;
    }
    assert.deepEqual([h.published.length, h.peers.length, h.incoming.length], counts);
    assert.strictEqual(h.feed.getState(), before);
  });
}

test("disposal also silences late request rejections", async (t) => {
  const h = makeFeed(t);
  await load(h, [message("old")]);
  const messages = h.feed.refresh();
  const messageRequest = h.requests.at(-1);
  const members = h.feed.refreshMembers();
  const memberRequest = h.requests.at(-1);
  const counts = [h.published.length, h.peers.length, h.incoming.length];
  const state = h.feed.getState();
  h.feed.dispose();
  messageRequest.reject(new Error("late message failure"));
  memberRequest.reject(new Error("late member failure"));
  await Promise.all([messages, members]);
  assert.deepEqual([h.published.length, h.peers.length, h.incoming.length], counts);
  assert.strictEqual(h.feed.getState(), state);
});

test("disposal during publication prevents later peer and incoming callbacks", async (t) => {
  let disposed = false;
  const callbacksAfterDisposal = [];
  const h = makeFeed(t, {
    onPublish(snapshot) {
      if (snapshot.messages.some((item) => item.id === "new")) {
        h.feed.dispose();
        disposed = true;
      }
    },
    onMessages() { if (disposed) callbacksAfterDisposal.push("peers"); },
    onIncoming() { if (disposed) callbacksAfterDisposal.push("incoming"); }
  });
  await load(h, [message("old")]);
  await load(h, [message("old"), message("new", 1)]);
  assert.equal(disposed, true);
  assert.deepEqual(callbacksAfterDisposal, []);
});

test("disposal from the peer callback prevents a later incoming callback", async (t) => {
  let disposed = false;
  const h = makeFeed(t, {
    onMessages(messages) {
      if (messages.some((item) => item.id === "new")) {
        h.feed.dispose();
        disposed = true;
      }
    }
  });
  await load(h, [message("old")]);
  await load(h, [message("old"), message("new", 1)]);
  assert.equal(disposed, true);
  assert.equal(h.peers.length, 2);
  assert.deepEqual(h.incoming, []);
});

const badSnapshots = [
  ["HTTP 500", { status: 500, error: "service unavailable", data: { messages: [] } }],
  ["an absent response", undefined],
  ["a null response", null],
  ["an absent status", { data: { messages: [] } }],
  ["absent data", { status: 200 }],
  ["null data", { status: 200, data: null }],
  ["an absent message list", { status: 200, data: {} }],
  ["a null message list", { status: 200, data: { messages: null } }],
  ["a text message list", { status: 200, data: { messages: "[]" } }],
  ["an object message list", { status: 200, data: { messages: {} } }]
];

for (const [name, invalidResponse] of badSnapshots) {
  test(`${name} preserves the successful snapshot instead of publishing an empty one`, async (t) => {
    const h = makeFeed(t);
    await load(h, [message("old")]);
    const before = h.feed.getState();
    const publicationCount = h.published.length;
    const pending = h.feed.refresh();
    h.requests.at(-1).resolve(invalidResponse);
    await pending;
    const after = h.feed.getState();
    assert.deepEqual(after.messages, before.messages);
    assert.deepEqual(after.room, before.room);
    assert.equal(after.updatedAt, before.updatedAt);
    assert.equal(after.hasLoaded, true);
    assert.equal(after.loading, false);
    assert.equal(after.refreshing, false);
    assert.equal(typeof after.error, "string");
    assert.ok(after.error.length > 0);
    if (invalidResponse?.error) assert.equal(after.error, invalidResponse.error);
    assert.equal(h.peers.length, 1);
    assert.deepEqual(h.incoming, []);
    for (const published of h.published.slice(publicationCount)) {
      assert.deepEqual(published.messages, before.messages);
      assert.deepEqual(published.room, before.room);
      assert.equal(published.updatedAt, before.updatedAt);
    }
  });
}

test("a valid empty message list clears the snapshot without pretending it is an error", async (t) => {
  const h = makeFeed(t);
  await load(h, [message("old")]);
  const state = await load(h, [], null);
  assert.deepEqual(state.messages, []);
  assert.equal(state.room, null);
  assert.equal(state.error, "");
  assert.equal(state.hasLoaded, true);
  assert.deepEqual(h.peers.map(ids), [["old"], []]);
  assert.deepEqual(h.incoming, []);
});

test("a rejected refresh preserves data and recovers on the next successful snapshot", async (t) => {
  const h = makeFeed(t);
  const before = await load(h, [message("old")]);
  const pending = h.feed.refresh();
  h.requests.at(-1).reject(new Error("network unavailable"));
  await pending;
  assert.deepEqual(h.feed.getState().messages, before.messages);
  assert.equal(h.feed.getState().error, "network unavailable");
  assert.equal(h.feed.getState().refreshing, false);
  const recovered = await load(h, [message("old"), message("new", 1)]);
  assert.equal(recovered.error, "");
  assert.equal(recovered.loading, false);
  assert.equal(recovered.refreshing, false);
  assert.deepEqual(h.incoming.map(ids), [["new"]]);
});

test("an initial request failure does not turn the first successful snapshot into incoming messages", async (t) => {
  const h = makeFeed(t);
  const pending = h.feed.refresh();
  h.requests[0].reject(new Error("initial request failed"));
  await pending;
  assert.equal(h.feed.getState().hasLoaded, false);
  assert.equal(h.feed.getState().loading, false);
  assert.equal(h.feed.getState().updatedAt, null);
  assert.deepEqual(h.peers, []);
  assert.deepEqual(h.incoming, []);
  await load(h, [message("existing")]);
  assert.equal(h.feed.getState().error, "");
  assert.equal(h.feed.getState().hasLoaded, true);
  assert.deepEqual(h.incoming, []);
});

test("message refresh recovers when the request function throws before returning a promise", async (t) => {
  const recovery = deferred();
  let calls = 0;
  const h = makeFeed(t, {
    request() {
      if (++calls === 1) throw new Error("request setup failed");
      return recovery.promise;
    }
  });
  await h.feed.refresh();
  assert.equal(h.feed.getState().error, "request setup failed");
  const retried = h.feed.refresh();
  recovery.resolve(response([message("recovered")]));
  await retried;
  assert.equal(calls, 2, "a synchronous throw must release the message request gate");
  assert.deepEqual(ids(h.feed.getState().messages), ["recovered"]);
  assert.equal(h.feed.getState().error, "");
});

test("member refresh recovers when the request function throws before returning a promise", async (t) => {
  const recovery = deferred();
  let calls = 0;
  const h = makeFeed(t, {
    request() {
      if (++calls === 1) throw new Error("member request setup failed");
      return recovery.promise;
    }
  });
  await h.feed.refreshMembers();
  assert.equal(h.feed.getState().membersError, "member request setup failed");
  const retried = h.feed.refreshMembers();
  recovery.resolve({ status: 200, data: { members: [{ id: "recovered" }] } });
  await retried;
  assert.equal(calls, 2, "a synchronous throw must release the member request gate");
  assert.deepEqual(h.feed.getState().members, [{ id: "recovered" }]);
  assert.equal(h.feed.getState().membersError, "");
});

test("append normalizes deduplicates and sorts confirmed messages without incoming notifications", async (t) => {
  const h = makeFeed(t);
  await load(h, [message("old", 1)]);
  h.feed.append(message(7, 3, { authorId: "self", body: "first confirmation" }));
  h.feed.append(message("7", 2, { authorId: "self", body: "latest confirmation" }));
  const state = h.feed.getState();
  assert.deepEqual(ids(state.messages), ["old", "7"]);
  assert.equal(state.messages[1].body, "latest confirmation");
  assert.equal(state.messages[1].createdAt, message("7", 2).createdAt);
  assert.equal(h.peers.length, 3);
  assert.deepEqual(h.peers.at(-1), state.messages);
  assert.deepEqual(h.incoming, []);
});

test("malformed append records leave the snapshot and callbacks untouched", async (t) => {
  const h = makeFeed(t);
  await load(h, [message("old")]);
  const state = h.feed.getState();
  const counts = [h.published.length, h.peers.length, h.incoming.length];
  for (const invalid of [undefined, null, [], "text", {}, { id: "" }, { id: false }]) h.feed.append(invalid);
  assert.strictEqual(h.feed.getState(), state);
  assert.deepEqual([h.published.length, h.peers.length, h.incoming.length], counts);
});

for (const staleContainsSend of [false, true]) {
  test(`a GET already in flight cannot overwrite a confirmed send when its stale copy is ${staleContainsSend ? "present" : "absent"}`, async (t) => {
    const h = makeFeed(t);
    await load(h, [message("old")]);
    const pending = h.feed.refresh();
    const request = h.requests.at(-1);
    h.feed.append(message("sent", 2, { authorId: "self", body: "confirmed body" }));
    h.feed.append(message("sent", 2, { authorId: "self", body: "latest confirmed body" }));
    const stale = [message("old"), message("newPeer", 1)];
    if (staleContainsSend) stale.push(message("sent", 2, { authorId: "self", body: "stale body" }));
    request.resolve(response(stale));
    await pending;
    assert.deepEqual(ids(h.feed.getState().messages), ["old", "newPeer", "sent"]);
    assert.equal(h.feed.getState().messages[2].body, "latest confirmed body");
    assert.deepEqual(h.incoming.map(ids), [["newPeer"]]);
  });
}

test("a confirmed delete is not resurrected by an existing request with the deleted message", async (t) => {
  const h = makeFeed(t);
  await load(h, [message("old"), message(7, 1)]);
  const pending = h.feed.refresh();
  h.feed.remove(7);
  assert.deepEqual(ids(h.feed.getState().messages), ["old"]);
  h.requests.at(-1).resolve(response([message("old"), message("7", 1), message("new", 2)]));
  await pending;
  assert.deepEqual(ids(h.feed.getState().messages), ["old", "new"]);
  assert.deepEqual(h.incoming.map(ids), [["new"]]);
});

test("mutations during a request are replayed in order with the last operation winning", async (t) => {
  const h = makeFeed(t);
  await load(h, [message("old")]);
  const pending = h.feed.refresh();
  h.feed.append(message("removed", 1));
  h.feed.remove("removed");
  h.feed.remove("restored");
  h.feed.append(message("restored", 2, { body: "confirmed final record" }));
  h.requests.at(-1).resolve(response([message("old"), message("removed", 1), message("restored", 2)]));
  await pending;
  assert.deepEqual(ids(h.feed.getState().messages), ["old", "restored"]);
  assert.equal(h.feed.getState().messages[1].body, "confirmed final record");
  assert.deepEqual(h.incoming, []);
});

test("a confirmed own append is already seen when a later snapshot includes it", async (t) => {
  const h = makeFeed(t);
  await load(h, [message("old")]);
  const own = message("own", 1, { authorId: "self" });
  h.feed.append(own);
  await load(h, [message("old"), own]);
  assert.deepEqual(h.incoming, []);
  await load(h, [message("old"), own, message("newPeer", 2)]);
  assert.deepEqual(h.incoming.map(ids), [["newPeer"]]);
});

test("an append confirmed before the first snapshot completes survives and never becomes incoming", async (t) => {
  const h = makeFeed(t);
  const pending = h.feed.refresh();
  const own = message("own", 1, { authorId: "self" });
  h.feed.append(own);
  h.requests[0].resolve(response([message("old")]));
  await pending;
  assert.deepEqual(ids(h.feed.getState().messages), ["old", "own"]);
  assert.deepEqual(h.incoming, []);
  await load(h, [message("old"), own]);
  assert.deepEqual(h.incoming, []);
});

for (const [name, result] of [
  ["HTTP 500", { status: 500, error: "member service unavailable" }],
  ["missing members", { status: 200, data: {} }],
  ["malformed members", { status: 200, data: { members: {} } }]
]) {
  test(`member ${name} preserves messages and the existing member list then recovers`, async (t) => {
    const h = makeFeed(t);
    await load(h, [message("old")]);
    await loadMembers(h, [{ id: "existing", name: "Existing member" }]);
    const before = h.feed.getState();
    const pending = h.feed.refreshMembers();
    h.requests.at(-1).resolve(result);
    await pending;
    const failed = h.feed.getState();
    assert.deepEqual(failed.messages, before.messages);
    assert.deepEqual(failed.members, before.members);
    assert.deepEqual(failed.room, before.room);
    assert.equal(failed.updatedAt, before.updatedAt);
    assert.equal(failed.error, "");
    assert.ok(failed.membersError.length > 0);
    assert.equal(h.peers.length, 1);
    assert.deepEqual(h.incoming, []);
    await loadMembers(h, [{ id: "recovered" }]);
    assert.equal(h.feed.getState().membersError, "");
    assert.deepEqual(h.feed.getState().members, [{ id: "recovered" }]);
    assert.deepEqual(h.feed.getState().messages, before.messages);
    assert.equal(h.peers.length, 1);
  });
}

test("a member request rejection does not interrupt a message refresh in flight", async (t) => {
  const h = makeFeed(t);
  await load(h, [message("old")]);
  const messages = h.feed.refresh();
  const messageRequest = h.requests.at(-1);
  const members = h.feed.refreshMembers();
  h.requests.at(-1).reject(new Error("members offline"));
  await members;
  assert.equal(h.feed.getState().membersError, "members offline");
  assert.equal(h.feed.getState().refreshing, true);
  assert.deepEqual(ids(h.feed.getState().messages), ["old"]);
  messageRequest.resolve(response([message("old"), message("new", 1)]));
  await messages;
  assert.deepEqual(ids(h.feed.getState().messages), ["old", "new"]);
  assert.equal(h.feed.getState().error, "");
  assert.equal(h.feed.getState().membersError, "members offline");
  assert.deepEqual(h.incoming.map(ids), [["new"]]);
});

test("a successful member refresh cannot hide a message refresh error", async (t) => {
  const h = makeFeed(t);
  await load(h, [message("old")]);
  const pending = h.feed.refresh();
  h.requests.at(-1).resolve({ status: 500, error: "messages offline" });
  await pending;
  await loadMembers(h, [{ id: "peer" }]);
  assert.equal(h.feed.getState().error, "messages offline");
  assert.equal(h.feed.getState().membersError, "");
  assert.deepEqual(ids(h.feed.getState().messages), ["old"]);
  assert.equal(h.peers.length, 1);
  assert.deepEqual(h.incoming, []);
});