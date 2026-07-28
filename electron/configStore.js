"use strict";

const fs = require("fs");
const path = require("path");
const { app } = require("electron");

const FILE = () => path.join(app.getPath("userData"), "settings.json");
const LEGACY_KEYS = ["apiBase", "bmToken", "bmRole", "bmUsername", "bmAvatarUrl", "bmDiscordId"];

const DEFAULTS = {
  alleyApiBase: "https://alley.vrchatlegends.com",
  // alley service session (SDK-style JWT)
  alleyToken: "",
  alleyStaff: false,
  alleyRole: "",
  alleyCommunityName: "",
  alleyCommunityId: "",
  alleyGroupId: "",
  alleyDiscordId: "",
  alleyUsername: "",
  alleyAvatarUrl: "",
  seenBoothUploadIds: [],
  seenBoothUploadsInitialized: false,
  // preferences
  musicEnabled: true,
  sfxEnabled: true
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
  cache = next;
  try {
    fs.mkdirSync(path.dirname(FILE()), { recursive: true });
    fs.writeFileSync(FILE(), JSON.stringify(next, null, 2), "utf8");
  } catch {
    /* non-fatal */
  }
  return { ...next };
}

module.exports = { readConfig, writeConfig, DEFAULTS };
