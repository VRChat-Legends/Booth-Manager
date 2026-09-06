"use strict";

const fs = require("fs");
const path = require("path");
const { app } = require("electron");

const FILE = () => path.join(app.getPath("userData"), "settings.json");
const LEGACY_KEYS = ["apiBase", "bmToken", "bmRole", "bmUsername", "bmAvatarUrl", "bmDiscordId", "musicEnabled"];

const DEFAULTS = {
  alleyApiBase: "https://alley.vrchatlegends.com",
  // alley service session (SDK-style JWT)
  alleyToken: "",
  alleyStaff: false,
  alleyRole: "",
  alleyCommunityName: "",
  alleyCommunityId: "",
  alleyGroupId: "",
  alleyLogoUrl: "",
  alleyDiscordId: "",
  alleyUsername: "",
  alleyAvatarUrl: "",
  seenBoothUploadIds: [],
  seenBoothUploadsInitialized: false,
  chatProfiles: {},
  // preferences
  sfxEnabled: true,
  pingSoundEnabled: true,
  nativeNotificationsEnabled: true,
  runInTray: true,
  startWithWindows: false
};

let cache = null;

function withoutLegacyFields(value) {
  const next = { ...DEFAULTS, ...(value && typeof value === "object" ? value : {}) };
  for (const key of LEGACY_KEYS) delete next[key];
  return next;
}

function readConfig() {
  if (cache) return { ...cache };
  try {
    const raw = fs.readFileSync(FILE(), "utf8");
    const parsed = JSON.parse(raw);
    cache = withoutLegacyFields(parsed);
    if (LEGACY_KEYS.some((key) => Object.prototype.hasOwnProperty.call(parsed, key))) {
      fs.writeFileSync(FILE(), JSON.stringify(cache, null, 2), "utf8");
    }
  } catch {
    cache = { ...DEFAULTS };
  }
  return { ...cache };
}

function writeConfig(patch) {
  const next = withoutLegacyFields({ ...readConfig(), ...(patch && typeof patch === "object" ? patch : {}) });
  const temporary = `${FILE()}.tmp`;
  try {
    fs.mkdirSync(path.dirname(FILE()), { recursive: true });
    fs.writeFileSync(temporary, JSON.stringify(next, null, 2), "utf8");
    fs.renameSync(temporary, FILE());
  } catch {
    try { fs.unlinkSync(temporary); } catch {}
    if (Object.prototype.hasOwnProperty.call(patch || {}, "chatProfiles")) {
      throw new Error("Chat preferences could not be saved to disk. Check free space and folder permissions, then try again.");
    }
  }
  cache = next;
  return { ...next };
}

module.exports = { readConfig, writeConfig, DEFAULTS };
