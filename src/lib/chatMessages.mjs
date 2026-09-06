const asText = (value) => typeof value === "string" ? value : "";
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const asId = (value) => typeof value === "string" ? value.trim()
  : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function memberName(value) {
  const name = asText(value).trim();
  return /[\u0000-\u001f\u007f]/.test(name) ? "" : name;
}

function mentionPattern(names) {
  const word = "\\p{L}\\p{M}\\p{N}\\p{Pc}";
  return new RegExp(`(?<![${word}@.!#$%&*+/=?^\\x60{|}~\\-])@(?:${names.map(escapeRegExp).join("|")})(?![${word}@]|[.+\\-][${word}@])`, "giu");
}

export function isPinged(body, selfName) {
  const name = memberName(selfName);
  return Boolean(typeof body === "string" && name && mentionPattern([name]).test(body));
}

function attachmentsOf(message) {
  return Array.isArray(message?.attachments) ? message.attachments.filter(isRecord) : [];
}

function attachmentText(attachment) {
  const entries = Array.isArray(attachment.entries) ? attachment.entries.filter(isRecord) : [];
  return [attachment, ...entries].flatMap((entry) =>
    [entry.name, entry.path, entry.relPath, entry.relativePath].map(asText));
}

export function filterMessages(messages, options = {}) {
  if (!Array.isArray(messages)) return [];
  const { query = "", filter = "all", selfName = "", ownId = "" } = isRecord(options) ? options : {};
  const needle = asText(query);
  const pattern = needle ? new RegExp(escapeRegExp(needle), "iu") : null;
  const id = asId(ownId);
  return messages.filter((message) => {
    if (!isRecord(message)) return false;
    const attachments = attachmentsOf(message);
    const own = Boolean(id && asId(message.authorId) === id);
    if (filter === "mentions" && (own || !isPinged(message.body, selfName))) return false;
    if (filter === "files" && !attachments.length) return false;
    if (filter === "mine" && !own) return false;
    return !pattern || [asText(message.body), asText(message.authorName), ...attachments.flatMap(attachmentText)]
      .some((value) => pattern.test(value));
  });
}

function truncate(value, limit) {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 3).replace(/[\uD800-\uDBFF]$/, "").trimEnd()}...`;
}

export function quoteMessage(message) {
  if (!isRecord(message)) return "";
  const author = truncate(asText(message.authorName).replace(/\s+/g, " ").trim() || "Unknown", 80);
  const body = asText(message.body).replace(/\s+/g, " ").trim();
  const files = attachmentsOf(message).map((attachment) =>
    asText(attachment.name) || asText(attachment.relPath) || asText(attachment.path)).filter(Boolean);
  const snippet = body || files.join(", ").replace(/\s+/g, " ").trim() || "Message";
  return truncate(`> ${author}: ${snippet}`, 500);
}

function chatDate(iso) {
  if (typeof iso !== "string" || !iso.trim()) return null;
  const calendar = /^(\d{4})-(\d{2})-(\d{2})(?:[Tt\s]|$)/.exec(iso.trim());
  if (calendar) {
    const year = Number(calendar[1]);
    const month = Number(calendar[2]);
    const day = Number(calendar[3]);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
    if (!days || day < 1 || day > days) return null;
  }
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function formatChatTime(iso, timeFormat = "12h") {
  const date = chatDate(iso);
  if (!date) return "";
  return date.toLocaleTimeString(undefined, {
    hour: timeFormat === "24h" ? "2-digit" : "numeric",
    minute: "2-digit",
    hourCycle: timeFormat === "24h" ? "h23" : "h12"
  });
}

export function messageDayKey(iso) {
  const date = chatDate(iso);
  if (!date) return "";
  return [String(date.getFullYear()).padStart(4, "0"), String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")].join("-");
}

export function canGroupMessages(previous, message, groupMessages = true) {
  if (groupMessages === false || !isRecord(previous) || !isRecord(message)) return false;
  if (previous.authorRole === "system" || message.authorRole === "system") return false;
  const author = asId(message.authorId);
  if (!author || asId(previous.authorId) !== author) return false;
  const before = chatDate(previous.createdAt);
  const current = chatDate(message.createdAt);
  if (!before || !current) return false;
  const elapsed = current.getTime() - before.getTime();
  return elapsed >= 0 && elapsed < 5 * 60 * 1000
    && messageDayKey(previous.createdAt) === messageDayKey(message.createdAt);
}

export function messageTextParts(body, members = [], selfName = "", searchQuery = "") {
  const text = asText(body);
  if (!text) return [];
  const names = [...new Set((Array.isArray(members) ? members : [])
    .map((member) => memberName(member?.name)).filter(Boolean))].sort((a, b) => b.length - a.length);
  const self = memberName(selfName);
  const selfPattern = self ? new RegExp(`^${escapeRegExp(self)}$`, "iu") : null;
  const query = asText(searchQuery);
  const matches = query ? [...text.matchAll(new RegExp(escapeRegExp(query), "giu"))]
    .map((match) => ({ start: match.index, end: match.index + match[0].length })) : [];
  const result = [];
  let matchIndex = 0;
  const append = (start, end, mention = "") => {
    if (end <= start) return;
    const parts = [];
    let cursor = start;
    while (matchIndex < matches.length && matches[matchIndex].end <= start) matchIndex += 1;
    for (let index = matchIndex; index < matches.length && matches[index].start < end; index += 1) {
      const from = Math.max(cursor, matches[index].start);
      const to = Math.min(end, matches[index].end);
      if (from > cursor) parts.push({ text: text.slice(cursor, from), match: false });
      parts.push({ text: text.slice(from, to), match: true });
      cursor = to;
    }
    if (cursor < end) parts.push({ text: text.slice(cursor, end), match: false });
    result.push({ mention: Boolean(mention), self: Boolean(mention && selfPattern?.test(mention)), parts });
  };
  let cursor = 0;
  if (names.length) {
    for (const match of text.matchAll(mentionPattern(names))) {
      append(cursor, match.index);
      append(match.index, match.index + match[0].length, match[0].slice(1));
      cursor = match.index + match[0].length;
    }
  }
  append(cursor, text.length);
  return result;
}