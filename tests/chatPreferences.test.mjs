import test from "node:test";
import assert from "node:assert/strict";
import {
  CHAT_DEFAULTS, ROOM_DEFAULTS, applyChatPatch, chatProfileKey,
  createChatPreferenceWriter, normalizeChatPreferences, normalizeChatProfile,
  notificationText, readChatProfile, roomPreferences, shouldNotifyMessage,
  shouldSendOnKey
} from "../src/lib/chatPreferences.mjs";

const defaults = {
  density: "comfortable", fontSize: "medium", timeFormat: "12h",
  showAvatars: true, showTimestamps: true, showRoleBadges: true, groupMessages: true,
  showMediaPreviews: true, autoLoadImages: true, autoScroll: true, sendShortcut: "enter",
  notificationMode: "mentions", notificationSound: true, desktopNotifications: false,
  notificationPreview: false, sendSound: true
};
const roomDefaults = { favorite: false, notifications: "inherit" };
const choices = {
  density: ["comfortable", "compact"], fontSize: ["small", "medium", "large"],
  timeFormat: ["12h", "24h"], sendShortcut: ["enter", "mod-enter"],
  notificationMode: ["all", "mentions", "muted"]
};
const identity = { alleyApiBase: "https://chat.example.test/service", alleyDiscordId: "self" };
const key = chatProfileKey(identity);
const config = (extra = {}) => ({ ...identity, ...extra });

function freezeTree(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freezeTree);
    Object.freeze(value);
  }
  return value;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("defaults contain exactly the supported preferences and are frozen", () => {
  assert.deepEqual(CHAT_DEFAULTS, defaults);
  assert.deepEqual(ROOM_DEFAULTS, roomDefaults);
  assert.ok(Object.isFrozen(CHAT_DEFAULTS));
  assert.ok(Object.isFrozen(ROOM_DEFAULTS));
  assert.deepEqual(normalizeChatPreferences(), defaults);
  assert.deepEqual(normalizeChatProfile(), { preferences: defaults, rooms: {} });
});

test("normalization returns independent defaults for absent or malformed input", () => {
  for (const value of [undefined, null, false, 42, "compact", ["compact"]]) {
    assert.deepEqual(normalizeChatPreferences(value), defaults);
    assert.deepEqual(normalizeChatProfile(value), { preferences: defaults, rooms: {} });
  }
  const first = normalizeChatPreferences();
  const second = normalizeChatPreferences();
  first.autoScroll = false;
  assert.notStrictEqual(first, second);
  assert.deepEqual(second, defaults);
  assert.deepEqual(CHAT_DEFAULTS, defaults);
});

for (const [field, values] of Object.entries(choices)) {
  test(`${field} accepts every supported choice and falls back for invalid values`, () => {
    for (const value of values) {
      assert.deepEqual(normalizeChatPreferences({ [field]: value }), { ...defaults, [field]: value });
    }
    for (const value of [undefined, null, "invalid", "", true, false, 0, [], {}]) {
      assert.deepEqual(normalizeChatPreferences({ [field]: value }), defaults);
    }
  });
}

test("boolean preferences preserve both false and true without coercion", () => {
  for (const [field, fallback] of Object.entries(defaults)) {
    if (typeof fallback !== "boolean") continue;
    for (const value of [false, true]) {
      assert.equal(normalizeChatPreferences({ [field]: value })[field], value, field);
    }
    for (const value of [undefined, null, 0, 1, "false", "true", [], {}]) {
      assert.equal(normalizeChatPreferences({ [field]: value })[field], fallback, field);
    }
  }
});

test("preference normalization drops unknown and inherited fields", () => {
  const input = Object.assign(Object.create({ density: "compact", showAvatars: false }), {
    fontSize: "large", unknown: true, favorite: true
  });
  const normalized = normalizeChatPreferences(input);
  assert.deepEqual(normalized, { ...defaults, fontSize: "large" });
  assert.deepEqual(Object.keys(normalized), Object.keys(defaults));
  assert.equal(Object.hasOwn(normalized, "unknown"), false);
});

test("account keys normalize service URLs and omit credentials query and fragments", () => {
  const actual = chatProfileKey(config({
    alleyApiBase: "https://login:secret@CHAT.EXAMPLE.TEST:443/service///?token=querySecret#fragmentSecret",
    alleyDiscordId: "  self  "
  }));
  assert.deepEqual(JSON.parse(actual), ["https://chat.example.test/service", "self"]);
  assert.equal(actual, key);
  for (const content of ["login", "secret", "token", "querySecret", "fragmentSecret", "?", "#"]) {
    assert.equal(actual.includes(content), false, content);
  }
});

test("account keys separate users origins protocols ports and service paths", () => {
  const keys = [
    key,
    chatProfileKey(config({ alleyDiscordId: "another" })),
    chatProfileKey(config({ alleyApiBase: "https://other.example.test/service" })),
    chatProfileKey(config({ alleyApiBase: "https://chat.example.test/other" })),
    chatProfileKey(config({ alleyApiBase: "http://chat.example.test/service" })),
    chatProfileKey(config({ alleyApiBase: "https://chat.example.test:8443/service" }))
  ];
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(keys.every(Boolean));
});

test("an absent API base uses the existing default service", () => {
  for (const alleyApiBase of [undefined, null, ""]) {
    assert.deepEqual(JSON.parse(chatProfileKey({ alleyApiBase, alleyDiscordId: "self" })), [
      "https://alley.vrchatlegends.com", "self"
    ]);
  }
});

test("missing blank and nonstring account IDs cannot produce a key", () => {
  assert.equal(chatProfileKey(), "");
  assert.equal(chatProfileKey({ alleyApiBase: identity.alleyApiBase }), "");
  for (const alleyDiscordId of [undefined, null, "", " \t\n ", 42, 0, false, true, [], {}]) {
    assert.equal(chatProfileKey(config({ alleyDiscordId })), "");
  }
});

test("invalid URLs and unsupported service schemes cannot produce a key", () => {
  for (const alleyApiBase of [
    "not a url", "/api/chat", "https://", "ftp://chat.example.test",
    "file:///C:/chat", "ws://chat.example.test", "wss://chat.example.test",
    "javascript:void(0)", "data:text/plain,chat"
  ]) {
    assert.equal(chatProfileKey(config({ alleyApiBase })), "", alleyApiBase);
  }
});

test("profile reads select the current account and ignore inherited account entries", () => {
  const otherIdentity = config({ alleyDiscordId: "another" });
  const otherKey = chatProfileKey(otherIdentity);
  const ownProfile = normalizeChatProfile({ preferences: { density: "compact" } });
  const otherProfile = normalizeChatProfile({ preferences: { fontSize: "large" } });
  const chatProfiles = freezeTree({ [key]: ownProfile, [otherKey]: otherProfile });
  assert.deepEqual(readChatProfile(config({ chatProfiles })), ownProfile);
  assert.deepEqual(readChatProfile({ ...otherIdentity, chatProfiles }), otherProfile);
  assert.notStrictEqual(readChatProfile(config({ chatProfiles })), ownProfile);
  assert.deepEqual(readChatProfile(config({ alleyApiBase: "https://other.example.test", chatProfiles })), {
    preferences: defaults, rooms: {}
  });
  assert.deepEqual(readChatProfile(config({ chatProfiles: Object.create({ [key]: ownProfile }) })), {
    preferences: defaults, rooms: {}
  });
  assert.deepEqual(readChatProfile(), { preferences: defaults, rooms: {} });
});

test("profile normalization sanitizes rooms and keeps the supported room ID boundary", () => {
  const maximum = "r".repeat(200);
  const input = freezeTree({
    preferences: { density: "compact", unknown: true }, unknown: true,
    rooms: {
      general: { favorite: true, notifications: "all", unknown: true },
      quiet: { favorite: "true", notifications: "invalid" },
      missing: null, "": { favorite: true },
      [maximum]: { favorite: true, notifications: "muted" },
      ["r".repeat(201)]: { favorite: true }
    }
  });
  assert.deepEqual(normalizeChatProfile(input), {
    preferences: { ...defaults, density: "compact" },
    rooms: {
      general: { favorite: true, notifications: "all" },
      quiet: roomDefaults, missing: roomDefaults,
      [maximum]: { favorite: true, notifications: "muted" }
    }
  });
  assert.deepEqual(normalizeChatProfile({ rooms: [] }), { preferences: defaults, rooms: {} });
});

test("room reads preserve favorites and all supported notification overrides", () => {
  for (const notifications of ["inherit", "all", "mentions", "muted"]) {
    for (const favorite of [false, true]) {
      const profile = { rooms: { general: { favorite, notifications } } };
      assert.deepEqual(roomPreferences(profile, "general"), { favorite, notifications });
    }
  }
  assert.deepEqual(roomPreferences(undefined, "general"), roomDefaults);
  assert.deepEqual(roomPreferences({ rooms: {} }, "general"), roomDefaults);
  assert.deepEqual(roomPreferences({ rooms: { general: { favorite: 1, notifications: false } } }, "general"), roomDefaults);
});

test("account patches are immutable preserve rooms and never save unknown fields", () => {
  const original = {
    preferences: { ...defaults, fontSize: "large" },
    rooms: { general: { favorite: true, notifications: "mentions" } }
  };
  const profile = freezeTree(structuredClone(original));
  const patch = freezeTree({ density: "compact", showAvatars: false, unknown: true, favorite: true });
  const result = applyChatPatch(profile, patch);
  assert.notStrictEqual(result, profile);
  assert.notStrictEqual(result.preferences, profile.preferences);
  assert.deepEqual(result, {
    preferences: { ...defaults, fontSize: "large", density: "compact", showAvatars: false },
    rooms: original.rooms
  });
  assert.deepEqual(profile, original);
  assert.deepEqual(patch, { density: "compact", showAvatars: false, unknown: true, favorite: true });
});

test("invalid patched values fall back rather than replacing stored values with invalid data", () => {
  const profile = normalizeChatProfile({ preferences: { density: "compact", showAvatars: false } });
  assert.deepEqual(applyChatPatch(profile, { density: "invalid", showAvatars: "false" }).preferences, defaults);
  for (const patch of [undefined, null, false, 12, "compact", []]) {
    assert.deepEqual(applyChatPatch(profile, patch), profile);
  }
});

test("room patches update only the selected room and preserve false favorites", () => {
  const original = {
    preferences: { ...defaults, density: "compact" },
    rooms: {
      general: { favorite: true, notifications: "all" },
      other: { favorite: true, notifications: "mentions" }
    }
  };
  const profile = freezeTree(structuredClone(original));
  const patch = freezeTree({ favorite: false, notifications: "muted", fontSize: "large", unknown: true });
  const result = applyChatPatch(profile, patch, "general");
  assert.notStrictEqual(result.rooms, profile.rooms);
  assert.deepEqual(result, {
    preferences: original.preferences,
    rooms: { ...original.rooms, general: { favorite: false, notifications: "muted" } }
  });
  assert.deepEqual(profile, original);
  assert.equal(Object.hasOwn(result.rooms.general, "unknown"), false);
  assert.equal(Object.hasOwn(result.rooms.general, "fontSize"), false);
});

test("new room patches normalize values and reject IDs longer than 200 characters", () => {
  const profile = freezeTree(normalizeChatProfile());
  assert.deepEqual(applyChatPatch(profile, { favorite: true }, 42).rooms, {
    "42": { favorite: true, notifications: "inherit" }
  });
  assert.deepEqual(applyChatPatch(profile, { favorite: "true", notifications: "invalid" }, "general").rooms, {
    general: roomDefaults
  });
  const maximum = "r".repeat(200);
  assert.deepEqual(applyChatPatch(profile, { favorite: true }, maximum).rooms[maximum], {
    favorite: true, notifications: "inherit"
  });
  assert.throws(() => applyChatPatch(profile, {}, "r".repeat(201)), /Invalid chat room/);
  assert.deepEqual(profile, { preferences: defaults, rooms: {} });
});

test("resetting account defaults preserves every room favorite and notification override", () => {
  const profile = freezeTree(normalizeChatProfile({
    preferences: { density: "compact", notificationMode: "muted", showAvatars: false },
    rooms: {
      general: { favorite: true, notifications: "all" },
      other: { favorite: false, notifications: "muted" }
    }
  }));
  const reset = applyChatPatch(profile, CHAT_DEFAULTS);
  assert.deepEqual(reset.preferences, defaults);
  assert.deepEqual(reset.rooms, profile.rooms);
  assert.equal(profile.preferences.density, "compact");
});

test("writer serializes concurrent account and room updates", { timeout: 5000 }, async () => {
  let stored = config({ chatProfiles: {} });
  const entered = deferred();
  const release = deferred();
  const events = [];
  let writes = 0;
  const writer = createChatPreferenceWriter({
    read() {
      events.push("read");
      return freezeTree(structuredClone(stored));
    },
    async write(update) {
      const number = ++writes;
      events.push(`write ${number} start`);
      if (number === 1) {
        entered.resolve();
        await release.promise;
      }
      stored = { ...stored, ...update };
      events.push(`write ${number} end`);
      return stored;
    }
  });
  const first = writer(key, { density: "compact" });
  const second = writer(key, { fontSize: "large", showAvatars: false });
  const third = writer(key, { favorite: true, notifications: "muted" }, "general");
  await entered.promise;
  const whileBlocked = [...events];
  release.resolve();
  const results = await Promise.all([first, second, third]);
  assert.deepEqual(whileBlocked, ["read", "write 1 start"]);
  assert.deepEqual(events, [
    "read", "write 1 start", "write 1 end",
    "read", "write 2 start", "write 2 end",
    "read", "write 3 start", "write 3 end"
  ]);
  assert.equal(results[0].preferences.fontSize, "medium");
  assert.deepEqual(results[1].rooms, {});
  assert.deepEqual(results[2], {
    preferences: { ...defaults, density: "compact", fontSize: "large", showAvatars: false },
    rooms: { general: { favorite: true, notifications: "muted" } }
  });
  assert.deepEqual(readChatProfile(stored), results[2]);
});

test("queued writes read fresh settings and preserve unrelated config and account maps", async () => {
  const otherKey = chatProfileKey(config({ alleyDiscordId: "another" }));
  const thirdKey = chatProfileKey(config({ alleyApiBase: "https://other.example.test" }));
  const otherProfile = normalizeChatProfile({ preferences: { notificationMode: "all" } });
  const thirdProfile = normalizeChatProfile({ rooms: { other: { favorite: true } } });
  let stored = config({
    appearance: { scale: 1 },
    chatProfiles: {
      [key]: normalizeChatProfile({
        preferences: { showAvatars: false }, rooms: { general: { favorite: true } }
      }),
      [otherKey]: normalizeChatProfile()
    }
  });
  const reads = [];
  const updates = [];
  const writer = createChatPreferenceWriter({
    read() {
      const snapshot = freezeTree(structuredClone(stored));
      reads.push(snapshot);
      return snapshot;
    },
    async write(update) {
      updates.push(structuredClone(update));
      stored = { ...stored, ...update };
      if (updates.length === 1) {
        stored = {
          ...stored, appearance: { scale: 2 },
          chatProfiles: {
            ...stored.chatProfiles,
            [key]: applyChatPatch(stored.chatProfiles[key], { sendSound: false }),
            [otherKey]: otherProfile, [thirdKey]: thirdProfile
          }
        };
      }
      return stored;
    }
  });
  const results = await Promise.all([
    writer(key, { density: "compact" }),
    writer(key, { fontSize: "large" })
  ]);
  assert.equal(reads.length, 2);
  assert.deepEqual(reads[0].appearance, { scale: 1 });
  assert.deepEqual(reads[1].appearance, { scale: 2 });
  for (const update of updates) assert.deepEqual(Object.keys(update), ["chatProfiles"]);
  assert.deepEqual(updates[1].chatProfiles[otherKey], otherProfile);
  assert.deepEqual(updates[1].chatProfiles[thirdKey], thirdProfile);
  assert.deepEqual(stored.appearance, { scale: 2 });
  assert.deepEqual(results[1], {
    preferences: { ...defaults, showAvatars: false, density: "compact", fontSize: "large", sendSound: false },
    rooms: { general: { favorite: true, notifications: "inherit" } }
  });
});

test("writer rejects an account change before writing", async () => {
  for (const changed of [
    config({ alleyDiscordId: "another" }),
    config({ alleyApiBase: "https://other.example.test/service" }),
    config({ alleyDiscordId: "" }),
    config({ alleyApiBase: "file:///C:/chat" })
  ]) {
    let stored = config();
    let writes = 0;
    const writer = createChatPreferenceWriter({
      read: () => stored,
      write: async (update) => { writes += 1; return { ...stored, ...update }; }
    });
    const pending = writer(key, { density: "compact" });
    stored = changed;
    await assert.rejects(pending, /Your account changed\. Open chat again/);
    assert.equal(writes, 0);
  }
});

test("writer rejects an empty account key and a changed account in the save result", async () => {
  let writes = 0;
  const writer = createChatPreferenceWriter({
    read: () => config(),
    write: async (update) => {
      writes += 1;
      return config({ ...update, alleyDiscordId: "another" });
    }
  });
  await assert.rejects(writer("", {}), /Your account changed\. Open chat again/);
  assert.equal(writes, 0);
  await assert.rejects(writer(key, { density: "compact" }), /account changed while preferences were being saved/);
  assert.equal(writes, 1);
});

test("writer rejects a failed save and still runs an already queued update", { timeout: 5000 }, async () => {
  let stored = config({ chatProfiles: {} });
  const entered = deferred();
  const save = deferred();
  const failure = new Error("settings save failed");
  let reads = 0;
  let writes = 0;
  const writer = createChatPreferenceWriter({
    read() { reads += 1; return stored; },
    async write(update) {
      writes += 1;
      if (writes === 1) {
        entered.resolve();
        await save.promise;
      }
      stored = { ...stored, ...update };
      return stored;
    }
  });
  const first = writer(key, { density: "compact", showAvatars: false });
  const rejected = assert.rejects(first, (error) => {
    assert.strictEqual(error, failure);
    return true;
  });
  const second = writer(key, { fontSize: "large" });
  const completed = Promise.all([rejected, second]);
  await entered.promise;
  save.reject(failure);
  const [, result] = await completed;
  assert.equal(reads, 2);
  assert.equal(writes, 2);
  assert.deepEqual(result, { preferences: { ...defaults, fontSize: "large" }, rooms: {} });
  assert.deepEqual(readChatProfile(stored), result);
});

test("writer also recovers after a settings read rejects", async () => {
  let stored = config();
  let reads = 0;
  let writes = 0;
  const writer = createChatPreferenceWriter({
    async read() {
      if (++reads === 1) throw new Error("settings read failed");
      return stored;
    },
    async write(update) { writes += 1; stored = { ...stored, ...update }; return stored; }
  });
  const first = assert.rejects(writer(key, { density: "compact" }), /settings read failed/);
  const second = writer(key, { showAvatars: false });
  const [, result] = await Promise.all([first, second]);
  assert.equal(reads, 2);
  assert.equal(writes, 1);
  assert.deepEqual(result.preferences, { ...defaults, showAvatars: false });
});

test("writer persists only supported keys and reset keeps saved rooms", async () => {
  let stored = config();
  const updates = [];
  const writer = createChatPreferenceWriter({
    read: () => stored,
    async write(update) { updates.push(update); stored = { ...stored, ...update }; return stored; }
  });
  await writer(key, { density: "compact", unknown: true });
  await writer(key, { favorite: true, notifications: "all", unknown: true }, "general");
  const reset = await writer(key, CHAT_DEFAULTS);
  for (const update of updates) {
    assert.deepEqual(Object.keys(update.chatProfiles[key]), ["preferences", "rooms"]);
    assert.deepEqual(Object.keys(update.chatProfiles[key].preferences), Object.keys(defaults));
    for (const room of Object.values(update.chatProfiles[key].rooms)) {
      assert.deepEqual(Object.keys(room), Object.keys(roomDefaults));
    }
  }
  assert.deepEqual(reset, {
    preferences: defaults, rooms: { general: { favorite: true, notifications: "all" } }
  });
});

const notificationCases = [
  ["all", "inherit", true, true], ["all", "all", true, true],
  ["all", "mentions", false, true], ["all", "muted", false, false],
  ["mentions", "inherit", false, true], ["mentions", "all", true, true],
  ["mentions", "mentions", false, true], ["mentions", "muted", false, false],
  ["muted", "inherit", false, false], ["muted", "all", true, true],
  ["muted", "mentions", false, true], ["muted", "muted", false, false]
];
const incomingMessage = { id: "message", authorId: "peer", authorName: "Peer", body: "hello team" };
const notificationOptions = (notificationMode = "mentions", notifications = "inherit") => ({
  preferences: normalizeChatPreferences({ notificationMode }),
  room: { ...roomDefaults, notifications }, ownId: "self", selfName: "Cadyn"
});

for (const [mode, override, ordinary, mentioned] of notificationCases) {
  test(`notification mode ${mode} with room ${override} handles ordinary messages and mentions`, () => {
    const options = notificationOptions(mode, override);
    assert.equal(shouldNotifyMessage(incomingMessage, options), ordinary);
    assert.equal(shouldNotifyMessage({ ...incomingMessage, body: "hello @Cadyn!" }, options), mentioned);
  });
}

test("absent room preferences inherit the account notification mode", () => {
  for (const [mode, expected] of [["all", true], ["mentions", false], ["muted", false]]) {
    for (const room of [undefined, null, {}]) {
      assert.equal(shouldNotifyMessage(incomingMessage, { ...notificationOptions(mode), room }), expected);
    }
  }
});

test("own system and absent messages never notify regardless of overrides", () => {
  for (const [mode, override] of notificationCases) {
    const options = { ...notificationOptions(mode, override), ownId: "42" };
    for (const message of [
      undefined, null,
      { ...incomingMessage, authorId: "42", body: "@Cadyn" },
      { ...incomingMessage, authorId: 42, body: "@Cadyn" },
      { ...incomingMessage, authorRole: "system", body: "@Cadyn" }
    ]) {
      assert.equal(shouldNotifyMessage(message, options), false, `${mode} ${override}`);
    }
  }
});

test("mentions accept punctuation and case differences without matching emails or longer names", () => {
  const options = { ...notificationOptions(), selfName: "  CaDyN  " };
  for (const body of ["@cadyn", "hello (@CADYN)!", "hello\n@Cadyn, welcome", "@Cadyn."]) {
    assert.equal(shouldNotifyMessage({ ...incomingMessage, body }, options), true, body);
  }
  for (const body of [
    "Cadyn", "@Cadynson", "@Cadyn_2", "@@Cadyn", "mail@Cadyn",
    "@Cadyn.example", "@Cadyn+tag", "@Cadyn-team", "https://example.test/@Cadyn",
    "someone.@Cadyn", "界@Cadyn", "@Cadyn\u0301", "@everyone"
  ]) {
    assert.equal(shouldNotifyMessage({ ...incomingMessage, body }, options), false, body);
  }
});

test("mention names are escaped literally instead of acting as regular expressions", () => {
  for (const [selfName, lookalike] of [
    ["A.B", "AxB"], ["Cady(n)", "Cadyn"], ["Name+", "Nameee"],
    ["[AB]", "A"], ["Cadyn|Admin", "Admin"], ["Name?", "Nam"], ["A*", "AAAA"]
  ]) {
    const options = { ...notificationOptions(), selfName };
    assert.equal(shouldNotifyMessage({ ...incomingMessage, body: `hello @${selfName}!` }, options), true, selfName);
    assert.equal(shouldNotifyMessage({ ...incomingMessage, body: `hello @${lookalike}!` }, options), false, selfName);
  }
  assert.equal(shouldNotifyMessage({ ...incomingMessage, body: "hello @(!" }, {
    ...notificationOptions(), selfName: "("
  }), true);
});

test("invalid mention names and nontext bodies do not create notifications", () => {
  for (const selfName of [undefined, null, false, {}, "", " \t ", "Cadyn\nTeam", "\u0000Cadyn"]) {
    assert.equal(shouldNotifyMessage({ ...incomingMessage, body: "@Cadyn" }, {
      ...notificationOptions(), selfName
    }), false);
  }
  for (const body of [undefined, null, false, 42, ["@Cadyn"], {}]) {
    assert.equal(shouldNotifyMessage({ ...incomingMessage, body }, notificationOptions()), false);
  }
});

test("notification text hides all author and message content unless preview is explicitly enabled", () => {
  const hidden = "New chat activity. Open Booth Manager to read it.";
  const message = {
    authorName: "PrivateAuthor", body: "PrivateBody", attachments: [{ name: "PrivateAttachment" }]
  };
  for (const value of [undefined, null, message]) {
    assert.equal(notificationText(value), hidden);
    assert.equal(notificationText(value, false), hidden);
  }
  const unreadable = {
    get authorName() { throw new Error("author content was accessed"); },
    get body() { throw new Error("message content was accessed"); }
  };
  assert.equal(notificationText(unreadable), hidden);
});

test("notification previews include text with whitespace and control characters flattened", () => {
  const text = notificationText({ authorName: "Alice\tSmith", body: "hello\r\nthere\u0000team\u007f" }, true);
  assert.equal(text, "Alice Smith: hello there team");
  assert.equal(/[\u0000-\u001f\u007f]/.test(text), false);
});

test("notification previews have safe fallbacks for missing authors and attachment only messages", () => {
  for (const message of [undefined, null, {}, { authorName: 42, body: false }]) {
    assert.equal(notificationText(message, true), "A member: Shared an attachment");
  }
  for (const body of [undefined, null, "", " \n\t "]) {
    assert.equal(notificationText({ authorName: "Alice", body }, true), "Alice: Shared an attachment");
  }
});

test("notification preview limits include the author and cap the entire output at 240 characters", () => {
  for (const message of [
    { authorName: "Alice", body: "x".repeat(600) },
    { authorName: "a".repeat(600), body: "private body" }
  ]) {
    const actual = notificationText(message, true);
    assert.equal(actual.length, 240);
    assert.equal(actual, `${message.authorName}: ${message.body}`.slice(0, 240));
  }
});

const enterEvent = {
  key: "Enter", keyCode: 13, shiftKey: false, altKey: false,
  ctrlKey: false, metaKey: false, isComposing: false, repeat: false
};

test("the enter shortcut accepts plain control and meta enter", () => {
  assert.equal(shouldSendOnKey({ key: "Enter" }), true);
  for (const modifiers of [{}, { ctrlKey: true }, { metaKey: true }, { ctrlKey: true, metaKey: true }]) {
    assert.equal(shouldSendOnKey({ ...enterEvent, ...modifiers }), true);
    assert.equal(shouldSendOnKey({ ...enterEvent, ...modifiers }, "enter"), true);
  }
});

test("the modifier shortcut requires control or meta", () => {
  assert.equal(shouldSendOnKey(enterEvent, "mod-enter"), false);
  for (const modifiers of [{ ctrlKey: true }, { metaKey: true }, { ctrlKey: true, metaKey: true }]) {
    assert.equal(shouldSendOnKey({ ...enterEvent, ...modifiers }, "mod-enter"), true);
  }
});

for (const [name, blocker] of [
  ["shift", { shiftKey: true }], ["alt", { altKey: true }],
  ["IME composition", { isComposing: true }], ["IME key code", { keyCode: 229 }],
  ["repeated keydown", { repeat: true }], ["a different key", { key: "Escape" }]
]) {
  test(`${name} prevents sending with either shortcut and every modifier combination`, () => {
    for (const shortcut of ["enter", "mod-enter"]) {
      for (const modifiers of [{}, { ctrlKey: true }, { metaKey: true }, { ctrlKey: true, metaKey: true }]) {
        assert.equal(shouldSendOnKey({ ...enterEvent, ...modifiers, ...blocker }, shortcut), false);
      }
    }
  });
}