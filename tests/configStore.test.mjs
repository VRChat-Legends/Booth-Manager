import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

const source = readFileSync(new URL("../electron/configStore.js", import.meta.url), "utf8");
function store(fail = "") {
  const file = path.join("test-only-settings", "settings.json");
  const disk = new Map([[file, JSON.stringify({ alleyDiscordId: "test-user", chatProfiles: {}, sfxEnabled: false })]]);
  let failure = fail;
  const fs = {
    readFileSync: (target) => disk.get(target),
    mkdirSync() { if (failure === "mkdir") throw new Error("Denied"); },
    writeFileSync(target, text) { if (failure === "write") throw new Error("Disk full"); disk.set(target, text); },
    renameSync(from, to) { if (failure === "rename") throw new Error("Denied"); disk.set(to, disk.get(from)); disk.delete(from); },
    unlinkSync: (target) => disk.delete(target)
  };
  const module = { exports: {} };
  vm.runInNewContext(source, { module, require: (name) => name === "fs" ? fs : name === "path" ? path : { app: { getPath: () => "test-only-settings" } } });
  return { ...module.exports, file, disk, recover: () => { failure = ""; } };
}

test("chat profiles save atomically without changing unrelated settings", () => {
  const config = store();
  const profiles = { local: { preferences: { fontSize: "large" }, rooms: {} } };
  const result = config.writeConfig({ chatProfiles: profiles });
  assert.equal(result.sfxEnabled, false);
  assert.deepEqual(JSON.parse(config.disk.get(config.file)).chatProfiles, profiles);
  assert.equal(config.disk.has(`${config.file}.tmp`), false);
  assert.deepEqual(config.readConfig().chatProfiles, profiles);
});

for (const stage of ["mkdir", "write", "rename"]) {
  test(`chat ${stage} failure rejects without changing the saved file or cache and can recover`, () => {
    const config = store(stage);
    const before = config.disk.get(config.file);
    config.readConfig();
    assert.throws(() => config.writeConfig({ chatProfiles: { local: { preferences: {} } } }), /could not be saved to disk/);
    assert.equal(config.disk.get(config.file), before);
    assert.equal(Object.keys(config.readConfig().chatProfiles).length, 0);
    assert.equal(config.disk.has(`${config.file}.tmp`), false);
    config.recover();
    config.writeConfig({ chatProfiles: { local: { preferences: { fontSize: "small" } } } });
    assert.equal(config.readConfig().chatProfiles.local.preferences.fontSize, "small");
  });
}

test("non-chat writes retain the legacy in-memory fallback on failure", () => {
  const config = store("write");
  assert.equal(config.writeConfig({ sfxEnabled: true }).sfxEnabled, true);
  assert.equal(config.readConfig().sfxEnabled, true);
  assert.equal(JSON.parse(config.disk.get(config.file)).sfxEnabled, false);
});