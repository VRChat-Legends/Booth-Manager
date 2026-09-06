import { isPinged } from "./chatMessages.mjs";

export const CHAT_DEFAULTS = Object.freeze({
  density: "comfortable", fontSize: "medium", timeFormat: "12h",
  showAvatars: true, showTimestamps: true, showRoleBadges: true, groupMessages: true,
  showMediaPreviews: true, autoLoadImages: true, autoScroll: true, sendShortcut: "enter",
  notificationMode: "mentions", notificationSound: true, desktopNotifications: false,
  notificationPreview: false, sendSound: true
});
export const ROOM_DEFAULTS = Object.freeze({ favorite: false, notifications: "inherit" });
const choices = {
  density: ["comfortable", "compact"], fontSize: ["small", "medium", "large"],
  timeFormat: ["12h", "24h"], sendShortcut: ["enter", "mod-enter"],
  notificationMode: ["all", "mentions", "muted"]
};
const record = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const ownValue = (value, key) => Object.hasOwn(record(value), key) ? value[key] : undefined;

export function chatProfileKey(cfg = {}) {
  const id = typeof cfg.alleyDiscordId === "string" ? cfg.alleyDiscordId.trim() : "";
  if (!id) return "";
  try {
    const url = new URL(cfg.alleyApiBase || "https://alley.vrchatlegends.com");
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return JSON.stringify([`${url.origin}${url.pathname.replace(/\/+$/, "")}`, id]);
  } catch { return ""; }
}

export function normalizeChatPreferences(value) {
  const input = record(value);
  return Object.fromEntries(Object.entries(CHAT_DEFAULTS).map(([key, fallback]) => {
    const candidate = ownValue(input, key);
    const valid = choices[key] ? choices[key].includes(candidate) : typeof candidate === "boolean";
    return [key, valid ? candidate : fallback];
  }));
}

export function roomPreferences(profile, roomId) {
  const value = record(ownValue(profile?.rooms, String(roomId || "")));
  return {
    favorite: value.favorite === true,
    notifications: ["inherit", "all", "mentions", "muted"].includes(value.notifications) ? value.notifications : "inherit"
  };
}

export function normalizeChatProfile(value) {
  const input = record(value);
  const rooms = Object.fromEntries(Object.keys(record(input.rooms)).filter((id) => id && id.length <= 200)
    .map((id) => [id, roomPreferences(input, id)]));
  return { preferences: normalizeChatPreferences(input.preferences), rooms };
}

export function readChatProfile(cfg) {
  return normalizeChatProfile(ownValue(cfg?.chatProfiles, chatProfileKey(cfg)));
}

export function applyChatPatch(profile, patch, roomId = "") {
  const next = normalizeChatProfile(profile);
  if (roomId) {
    const id = String(roomId);
    if (id.length > 200) throw new Error("Invalid chat room.");
    const changed = { ...next, rooms: { ...next.rooms, [id]: { ...roomPreferences(next, id), ...record(patch) } } };
    return { ...next, rooms: { ...next.rooms, [id]: roomPreferences(changed, id) } };
  }
  return { ...next, preferences: normalizeChatPreferences({ ...next.preferences, ...record(patch) }) };
}

export function createChatPreferenceWriter({ read, write }) {
  let queue = Promise.resolve();
  return (key, patch, roomId = "") => {
    const run = async () => {
      const cfg = await read();
      if (!key || chatProfileKey(cfg) !== key) throw new Error("Your account changed. Open chat again before changing preferences.");
      const profile = applyChatPatch(readChatProfile(cfg), patch, roomId);
      const saved = await write({ chatProfiles: { ...record(cfg.chatProfiles), [key]: profile } });
      if (chatProfileKey(saved) !== key) throw new Error("Your account changed while preferences were being saved.");
      return readChatProfile(saved);
    };
    const result = queue.then(run);
    queue = result.catch(() => {});
    return result;
  };
}

export function shouldNotifyMessage(message, { preferences, room, ownId, selfName }) {
  if (!message || message.authorRole === "system" || String(message.authorId) === String(ownId || "")) return false;
  const mode = room?.notifications && room.notifications !== "inherit" ? room.notifications : preferences.notificationMode;
  return mode === "all" || (mode === "mentions" && isPinged(message.body, selfName));
}

export function shouldSendOnKey(event, shortcut = "enter") {
  if (event.key !== "Enter" || event.shiftKey || event.altKey || event.isComposing || event.keyCode === 229 || event.repeat) return false;
  return shortcut === "mod-enter" ? Boolean(event.ctrlKey || event.metaKey) : true;
}

export function notificationText(message, preview = false) {
  if (!preview) return "New chat activity. Open Booth Manager to read it.";
  const author = typeof message?.authorName === "string" ? message.authorName : "A member";
  const body = typeof message?.body === "string" && message.body.trim() ? message.body : "Shared an attachment";
  return `${author}: ${body}`.replace(/[\s\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 240);
}