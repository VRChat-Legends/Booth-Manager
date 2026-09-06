import test from "node:test";
import assert from "node:assert/strict";
import {
  canGroupMessages,
  filterMessages,
  formatChatTime,
  isPinged,
  messageDayKey,
  messageTextParts,
  quoteMessage
} from "../src/lib/chatMessages.mjs";

const messages = Object.freeze([
  Object.freeze({ id: "one", authorId: "self", authorName: "Alex", body: "My reminder for @Alex", attachments: Object.freeze([]) }),
  Object.freeze({ id: "two", authorId: "other", authorName: "Ada", body: "Hey @Alex, check the draft", attachments: Object.freeze([]) }),
  Object.freeze({ id: "three", authorId: "other", authorName: "Ada", body: "Build a+b.*", attachments: Object.freeze([
    Object.freeze({ name: "preview[2].png", path: "assets/drafts/preview[2].png" })
  ]) }),
  Object.freeze({ id: "four", authorId: "self", authorName: "Alex", attachments: Object.freeze([
    Object.freeze({ name: "Shared folder", entries: Object.freeze([
      Object.freeze({ relPath: "textures/Blue Wall.png" })
    ]) })
  ]) }),
  Object.freeze({ id: "five", authorId: "third", body: "Email me@Alex.example or ask @Alexander" }),
  Object.freeze({ id: "empty" })
]);

const ids = (items) => items.map((item) => item.id);
const fragments = (parts) => parts.flatMap((segment) => segment.parts);
const plainText = (parts) => fragments(parts).map((part) => part.text).join("");
const highlightedText = (parts) => fragments(parts).filter((part) => part.match).map((part) => part.text).join("");
const record = (createdAt, extra = {}) => ({ authorId: "member", authorRole: "member", createdAt, ...extra });

function withTimezone(zone, callback) {
  const previous = process.env.TZ;
  process.env.TZ = zone;
  try {
    callback();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

test("all messages retain their order and original references", () => {
  const before = JSON.stringify(messages);
  const options = Object.freeze({ filter: "all" });
  const result = filterMessages(messages, options);
  assert.notStrictEqual(result, messages);
  assert.deepEqual(result, messages);
  result.forEach((message, index) => assert.strictEqual(message, messages[index]));
  assert.equal(JSON.stringify(messages), before);
  assert.deepEqual(options, { filter: "all" });
});

test("queries match bodies and authors without case sensitivity", () => {
  assert.deepEqual(ids(filterMessages(messages, { query: "DRAFT" })), ["two", "three"]);
  assert.deepEqual(ids(filterMessages(messages, { query: "aDa" })), ["two", "three"]);
  assert.deepEqual(ids(filterMessages(messages, { query: "missing" })), []);
});

test("queries treat regex syntax and whitespace literally", () => {
  for (const query of [".*", "[a-z]+", "a+b", "(one)", "?", "^start$", "${name}", "a|b", "\\path", "  "]) {
    const literal = { body: `before ${query} after` };
    const unrelated = { body: "unrelated words" };
    assert.deepEqual(filterMessages([literal, unrelated], { query: query.toUpperCase() }), [literal]);
  }
  assert.deepEqual(ids(filterMessages(messages, { query: "a+b.*" })), ["three"]);
});

test("queries search attachment names and folder entry paths", () => {
  assert.deepEqual(ids(filterMessages(messages, { query: "preview[2]" })), ["three"]);
  assert.deepEqual(ids(filterMessages(messages, { query: "assets/drafts" })), ["three"]);
  assert.deepEqual(ids(filterMessages(messages, { query: "textures/BLUE" })), ["four"]);
  for (const field of ["name", "path", "relPath", "relativePath"]) {
    const message = { attachments: [{ [field]: "nested/report.txt" }] };
    assert.deepEqual(filterMessages([message], { query: "NESTED/REPORT" }), [message]);
  }
});

test("mentions exclude the current author's own messages", () => {
  assert.deepEqual(ids(filterMessages(messages, { filter: "mentions", selfName: "Alex", ownId: "self" })), ["two"]);
  assert.deepEqual(ids(filterMessages(messages, { filter: "mentions", selfName: "Alex" })), ["one", "two"]);
  assert.deepEqual(filterMessages(messages, { filter: "mentions" }), []);
});

test("files and mine filters can be combined with a query", () => {
  assert.deepEqual(ids(filterMessages(messages, { filter: "files" })), ["three", "four"]);
  assert.deepEqual(ids(filterMessages(messages, { filter: "files", query: "blue" })), ["four"]);
  assert.deepEqual(ids(filterMessages(messages, { filter: "mine", ownId: "self" })), ["one", "four"]);
  assert.deepEqual(ids(filterMessages(messages, { filter: "mine", ownId: "self", query: "folder" })), ["four"]);
  assert.deepEqual(filterMessages(messages, { filter: "mine" }), []);
});

test("numeric IDs work without treating missing IDs as owned", () => {
  const numeric = { authorId: 0, body: "@Alex" };
  const text = { authorId: "0", body: "@Alex" };
  const missing = { body: "@Alex" };
  assert.deepEqual(filterMessages([numeric, text, missing], { filter: "mine", ownId: 0 }), [numeric, text]);
  assert.deepEqual(filterMessages([numeric, text, missing], { filter: "mentions", ownId: "0", selfName: "Alex" }), [missing]);
  assert.deepEqual(filterMessages([missing], { filter: "mine", ownId: " " }), []);
});

test("invalid collections and sparse message fields are safe", () => {
  for (const value of [undefined, null, false, 4, "messages", {}, Symbol("messages")]) {
    assert.deepEqual(filterMessages(value), []);
  }
  const empty = {};
  assert.deepEqual(filterMessages([null, [], false, 1, "body", empty]), [empty]);
  const sparse = { body: {}, authorName: 4, attachments: [null, false, { entries: [null, { name: null }] }] };
  assert.deepEqual(filterMessages([sparse], { query: "anything" }), []);
  assert.deepEqual(filterMessages([{ attachments: "not an array" }, { attachments: [null] }], { filter: "files" }), []);
  assert.deepEqual(filterMessages(messages, null), messages);
  assert.deepEqual(filterMessages(messages, { query: {}, filter: "unknown" }), messages);
});

test("mentions match names at real text boundaries", () => {
  for (const body of ["@Alex", "hey (@alex), thanks", "'@Alex'!", "hello\n@Alex.", "@Alex and @Alex"]) {
    assert.equal(isPinged(body, "Alex"), true, body);
  }
  assert.equal(isPinged("@Ægir!", "æGIR"), true);
  assert.equal(isPinged("@李雷 hello", "李雷"), true);
  assert.equal(isPinged("@Alex", "  Alex  "), true);
});

test("mentions reject partial names, email fragments, and repeated at signs", () => {
  for (const body of ["@Alexander", "@Alex2", "@Alex_2", "@Alexé", "@Alex\u0301", "me@Alex", "me@Alex.example",
    "local+@Alex", "local!@Alex", "@@Alex", "@Alex@team", "@Alex.profile", "@Alex+tag", "@Alex-smith"]) {
    assert.equal(isPinged(body, "Alex"), false, body);
  }
});

test("usernames escape regex punctuation", () => {
  for (const name of ["a.b", "a+b", "a[b]", "a(b)?", "a|b", "a^b$", "a.*b", "a\\b", "A+B (QA)?"]) {
    assert.equal(isPinged(`hello @${name}!`, name), true, name);
    assert.equal(isPinged(`hello @${name}more`, name), false, name);
  }
  assert.equal(isPinged("@axb", "a.b"), false);
  assert.equal(isPinged("@aaab", "a+b"), false);
});

test("blank and invalid mention inputs never throw", () => {
  for (const value of [undefined, null, "", "   ", 2, {}, [], Symbol("name")]) {
    assert.equal(isPinged("@Alex", value), false);
    assert.equal(isPinged(value, "Alex"), false);
  }
  assert.equal(isPinged("@Alex\nOther", "Alex\nOther"), false);
});

test("quotes contain an author and a single plain snippet", () => {
  assert.equal(quoteMessage({ authorName: "Ada", body: "Hello there" }), "> Ada: Hello there");
  assert.equal(quoteMessage({ authorName: "Ada\nLovelace", body: "  hello\r\n  there  " }), "> Ada Lovelace: hello there");
  assert.equal(quoteMessage({ authorName: "Ada", body: "<b>not HTML</b>" }), "> Ada: <b>not HTML</b>");
});

test("quotes fall back to attachment names or safe missing field labels", () => {
  assert.equal(quoteMessage({ attachments: [{ name: "mesh.fbx" }, { path: "textures/wall.png" }] }), "> Unknown: mesh.fbx, textures/wall.png");
  assert.equal(quoteMessage({}), "> Unknown: Message");
  assert.equal(quoteMessage({ authorName: {}, body: [], attachments: [null] }), "> Unknown: Message");
  for (const value of [undefined, null, false, [], "message", 42]) assert.equal(quoteMessage(value), "");
});

test("the complete quote is capped at 500 characters", () => {
  const message = Object.freeze({ authorName: "A".repeat(600), body: "body ".repeat(300) });
  const quote = quoteMessage(message);
  assert.ok(quote.length <= 500);
  assert.ok(quote.startsWith("> A"));
  assert.ok(quote.includes(": body"));
  assert.ok(quote.endsWith("..."));
  assert.equal(quoteMessage({ authorName: "A", body: "x".repeat(495) }).length, 500);
});

test("invalid dates and nonstring values produce empty labels", () => {
  for (const value of [undefined, null, "", " ", "not a date", "2026-99-99", "2026-02-30T12:00:00Z", "2025-02-29", "2026-04-31", 0, NaN, {}, [], new Date(NaN), Symbol("date")]) {
    assert.equal(messageDayKey(value), "");
    assert.equal(formatChatTime(value), "");
  }
});

test("calendar validation handles leap years without rolling dates forward", () => {
  withTimezone("UTC", () => {
    assert.equal(messageDayKey("2024-02-29T12:00:00Z"), "2024-02-29");
    assert.equal(messageDayKey("2000-02-29T12:00:00Z"), "2000-02-29");
    assert.equal(messageDayKey("1900-02-29T12:00:00Z"), "");
    assert.equal(canGroupMessages(record("2026-02-30T12:00:00Z"), record("2026-03-02T12:01:00Z")), false);
  });
});

test("day keys use the local calendar rather than UTC", () => {
  withTimezone("America/Los_Angeles", () => {
    assert.equal(messageDayKey("2026-09-05T00:30:00Z"), "2026-09-04");
    assert.equal(messageDayKey("2026-01-01T00:30:00Z"), "2025-12-31");
    assert.equal(messageDayKey("2026-03-08T09:59:00Z"), "2026-03-08");
    assert.equal(messageDayKey("2026-03-08T10:01:00Z"), "2026-03-08");
  });
  withTimezone("Asia/Tokyo", () => {
    assert.equal(messageDayKey("2026-09-05T23:30:00Z"), "2026-09-06");
  });
});

test("local day keys have padded months and days", () => {
  const date = new Date(2026, 0, 2, 12, 0);
  assert.equal(messageDayKey(date.toISOString()), "2026-01-02");
});

test("time formats use local hour and minute with the selected clock", () => {
  withTimezone("America/Los_Angeles", () => {
    const iso = "2026-09-05T20:07:51Z";
    const date = new Date(iso);
    assert.equal(formatChatTime(iso), date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hourCycle: "h12" }));
    assert.equal(formatChatTime(iso, "24h"), date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }));
    assert.equal(formatChatTime(iso, "invalid"), formatChatTime(iso, "12h"));
    assert.notEqual(formatChatTime(iso, "12h"), formatChatTime(iso, "24h"));
  });
});

test("the 24 hour clock does not display midnight as hour 24", () => {
  withTimezone("UTC", () => {
    const iso = "2026-09-05T00:05:00Z";
    const expected = new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    assert.equal(formatChatTime(iso, "24h"), expected);
    assert.ok(!formatChatTime(iso, "24h").startsWith("24"));
  });
});

test("grouping uses the same author and a strict five minute window", () => {
  const previous = record("2026-09-05T12:00:00Z");
  assert.equal(canGroupMessages(previous, record("2026-09-05T12:00:00Z")), true);
  assert.equal(canGroupMessages(previous, record("2026-09-05T12:04:59.999Z")), true);
  assert.equal(canGroupMessages(previous, record("2026-09-05T12:05:00Z")), false);
  assert.equal(canGroupMessages(previous, record("2026-09-05T12:01:00Z", { authorId: "someone else" })), false);
  assert.equal(canGroupMessages(previous, record("2026-09-05T12:01:00Z"), false), false);
  assert.equal(canGroupMessages(record(previous.createdAt, { authorId: 2 }), record(previous.createdAt, { authorId: "2" })), true);
});

test("grouping never crosses local midnight", () => {
  withTimezone("America/Los_Angeles", () => {
    const previous = record("2026-09-05T23:59:00-07:00");
    const current = record("2026-09-06T00:01:00-07:00");
    assert.equal(canGroupMessages(previous, current), false);
    assert.equal(canGroupMessages(record("2026-09-05T23:59:00Z"), record("2026-09-06T00:01:00Z")), true);
  });
});

test("grouping rejects system messages on either side and reverse time", () => {
  const previous = record("2026-09-05T12:00:00Z");
  const current = record("2026-09-05T12:01:00Z");
  assert.equal(canGroupMessages({ ...previous, authorRole: "system" }, current), false);
  assert.equal(canGroupMessages(previous, { ...current, authorRole: "system" }), false);
  assert.equal(canGroupMessages(current, previous), false);
});

test("grouping stays chronological through daylight saving time changes", () => {
  withTimezone("America/Los_Angeles", () => {
    const previous = record("2026-11-01T01:59:00-07:00");
    const current = record("2026-11-01T01:01:00-08:00");
    assert.equal(canGroupMessages(previous, current), true);
    assert.equal(canGroupMessages(current, previous), false);
  });
});

test("grouping needs valid messages, dates, and author IDs", () => {
  const valid = record("2026-09-05T12:00:00Z");
  for (const value of [undefined, null, [], {}, { authorId: "member" }, record("invalid"), record(valid.createdAt, { authorId: "" })]) {
    assert.equal(canGroupMessages(value, valid), false);
    assert.equal(canGroupMessages(valid, value), false);
  }
});

test("search highlights literal repeated text without losing content", () => {
  const body = "A+B a+b aaab <b>A+B</b>";
  const parts = messageTextParts(body, [], "", "a+b");
  assert.equal(plainText(parts), body);
  assert.equal(highlightedText(parts), "A+Ba+bA+B");
  assert.equal(highlightedText(messageTextParts("[v2].* wildcard", [], "", "[v2].*")), "[v2].*");
  assert.equal(highlightedText(messageTextParts("abc", [], "", ".*")), "");
});

test("query highlights can cross a mention boundary without splitting its pill", () => {
  const body = "hello @Ada, okay";
  const parts = messageTextParts(body, [{ name: "Ada" }], "ada", "lo @Ad");
  assert.equal(plainText(parts), body);
  assert.equal(highlightedText(parts), "lo @Ad");
  const mentions = parts.filter((part) => part.mention);
  assert.equal(mentions.length, 1);
  assert.equal(mentions[0].self, true);
  assert.deepEqual(mentions[0].parts, [{ text: "@Ad", match: true }, { text: "a", match: false }]);
});

test("mention text uses longest names first without mutating members", () => {
  const members = Object.freeze([Object.freeze({ name: "Ada" }), Object.freeze({ name: "Ada Lovelace" }), Object.freeze({ name: "A[1]" })]);
  const body = "@Ada Lovelace, ask @A[1]. Not me@Ada or @Adaline.";
  const parts = messageTextParts(body, members, "Ada Lovelace");
  assert.equal(plainText(parts), body);
  assert.deepEqual(parts.filter((part) => part.mention).map((part) => part.parts.map((fragment) => fragment.text).join("")), ["@Ada Lovelace", "@A[1]"]);
  assert.deepEqual(members.map((member) => member.name), ["Ada", "Ada Lovelace", "A[1]"]);
});

test("markup stays plain text alongside mentions and search matches", () => {
  const body = '<img src=x onerror=alert(1)> @A[1] & <script>alert(1)</script>';
  const parts = messageTextParts(body, [{ name: "A[1]" }], "A[1]", "<script>");
  assert.equal(plainText(parts), body);
  assert.equal(highlightedText(parts), "<script>");
  assert.equal(parts.filter((part) => part.mention && part.self).length, 1);
});

test("text segmentation safely handles missing names, body, and query", () => {
  for (const value of [undefined, null, {}, [], 42]) assert.deepEqual(messageTextParts(value), []);
  const body = "plain @Alex";
  assert.equal(plainText(messageTextParts(body, null, null, null)), body);
  assert.equal(plainText(messageTextParts(body, [null, {}, { name: 1 }, { name: "" }], {}, {})), body);
  assert.equal(highlightedText(messageTextParts(body, [], "", "")), "");
});