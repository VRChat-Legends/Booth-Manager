import test from "node:test";
import assert from "node:assert/strict";
import QRCode from "qrcode";
import {
  QR_BYTE_CAPACITY, QR_PRESETS, buildWifiPayload, createQrRequest, generateQrExport,
  generateQrPreview, getPayloadStats, getQrReadiness, relativeLuminance, saveQrRequest, startQrPreview
} from "../src/lib/qrUtils.mjs";

const request = (value = "https://example.com/current", settings = {}) => createQrRequest(value, { ...QR_PRESETS.screen, ...settings });
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const delayedEncoder = (pending) => ({
  create: () => ({ version: 1, modules: { size: 21 } }),
  toDataURL: () => pending.promise
});

test("WiFi preserves significant spaces and escapes reserved payload characters", () => {
  assert.equal(buildWifiPayload({ ssid: ' Cafe;,:"\\ ', password: ' p;,:"\\ ', hidden: true }),
    'WIFI:T:WPA;S: Cafe\\;\\,\\:\\"\\\\ ;P: p\\;\\,\\:\\"\\\\ ;H:true;;');
});

test("an open network never includes a remembered password", () => {
  assert.equal(buildWifiPayload({ ssid: "Guest", password: "private", security: "nopass" }), "WIFI:T:nopass;S:Guest;H:false;;");
  assert.equal(buildWifiPayload({ ssid: "   ", password: "private" }), "");
  assert.match(buildWifiPayload({ ssid: "Legacy", security: "WEP", password: "abcde" }), /T:WEP;S:Legacy;P:abcde;/);
  assert.throws(() => buildWifiPayload({ ssid: "Guest", security: "invalid" }), /security/);
});

test("payload counts distinguish characters from UTF8 bytes", () => {
  assert.deepEqual(getPayloadStats(""), { characters: 0, bytes: 0 });
  assert.deepEqual(getPayloadStats("abc"), { characters: 3, bytes: 3 });
  assert.deepEqual(getPayloadStats("é水\u{10437}"), { characters: 3, bytes: 9 });
});

test("contrast uses linearized sRGB luminance rather than an RGB average", () => {
  assert.equal(relativeLuminance("#000000"), 0);
  assert.equal(relativeLuminance("#ffffff"), 1);
  assert.equal(relativeLuminance("#ff0000"), 0.2126);
  assert.equal(relativeLuminance("#00ff00"), 0.7152);
  assert.equal(relativeLuminance("#0000ff"), 0.0722);
  assert.ok(Math.abs(relativeLuminance("#808080") - 0.2158605) < 0.000001);
  assert.throws(() => relativeLuminance("not a color"), /colors/);
});

test("presets restore opaque contrasting colors and a full quiet zone", () => {
  for (const preset of Object.values(QR_PRESETS)) {
    const result = getQrReadiness(preset, 29);
    assert.equal(result.contrastRatio, 21);
    assert.equal(result.canExportPng, true);
    assert.equal(result.canExportSvg, true);
    assert.ok(preset.margin >= 4);
    assert.equal(preset.transparent, false);
    assert.equal(Object.isFrozen(preset), true);
  }
});

test("known poor contrast, inverted colors and short quiet zones block export", () => {
  for (const settings of [
    { dark: "#ffffff" }, { dark: "#ffffff", light: "#000000" },
    { dark: "#00ff00" }, { margin: 2 }
  ]) {
    const result = getQrReadiness({ ...QR_PRESETS.screen, ...settings }, 21);
    assert.equal(result.canExportPng, false);
    assert.equal(result.canExportSvg, false);
  }
  assert.equal(getQrReadiness({ ...QR_PRESETS.screen, dark: "#0000ff" }, 21).canExportSvg, true);
});

test("transparent backgrounds have unknown contrast and an explicit warning", () => {
  const result = getQrReadiness({ ...QR_PRESETS.screen, transparent: true }, 21);
  assert.equal(result.contrastRatio, null);
  assert.equal(result.checks.find((check) => check.id === "contrast").state, "check");
  assert.equal(result.checks.find((check) => check.id === "background").state, "check");
  assert.equal(result.canExportPng, true);
});

test("dense PNGs need a larger raster size but can still export as vectors", () => {
  const result = getQrReadiness({ ...QR_PRESETS.screen, size: 256 }, 177);
  assert.equal(result.canExportPng, false);
  assert.equal(result.canExportSvg, true);
  assert.equal(getQrReadiness(QR_PRESETS.screen).canExportPng, false);
});

test("requests capture exact text and immutable settings", () => {
  const settings = { ...QR_PRESETS.screen };
  const snapshot = createQrRequest("  exact content\n", settings);
  settings.size = 2048;
  settings.dark = "#ff0000";
  assert.equal(snapshot.value, "  exact content\n");
  assert.equal(snapshot.options.width, 512);
  assert.equal(snapshot.options.color.dark, "#000000ff");
  assert.throws(() => { snapshot.settings.margin = 1; }, TypeError);
  assert.throws(() => { snapshot.options.color.dark = "#ffffffff"; }, TypeError);
});

test("the real encoder returns a PNG of the selected size and real symbol metadata", async () => {
  const snapshot = request();
  const preview = await generateQrPreview(snapshot);
  const bytes = Buffer.from(preview.dataUrl.split(",")[1], "base64");
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(bytes.readUInt32BE(16), 512);
  assert.equal(bytes.readUInt32BE(20), 512);
  assert.equal(preview.modules, 17 + preview.version * 4);
  assert.ok(preview.version >= 1 && preview.version <= 40);
  assert.equal(await generateQrExport(snapshot, "png"), preview.dataUrl.split(",")[1]);
});

test("SVG export contains vectors with the selected colors and dimensions", async () => {
  const svg = await generateQrExport(request("current payload", { size: 1024, dark: "#123456" }), "svg");
  assert.match(svg, /<svg\b/);
  assert.match(svg, /width="1024"/);
  assert.match(svg, /stroke="#123456"/);
  assert.doesNotMatch(svg, /<image\b/);
  const transparent = await generateQrExport(request("current payload", { transparent: true }), "svg");
  assert.doesNotMatch(transparent, /fill="#ffffff"/);
});

test("documented byte limits match the installed encoder and are not a numeric cap", () => {
  for (const [level, limit] of Object.entries(QR_BYTE_CAPACITY)) {
    assert.equal(QRCode.create("a".repeat(limit), { errorCorrectionLevel: level }).version, 40);
    assert.throws(() => QRCode.create("a".repeat(limit + 1), { errorCorrectionLevel: level }), /too big/i);
  }
  assert.ok(QRCode.create("1".repeat(QR_BYTE_CAPACITY.H + 20), { errorCorrectionLevel: "H" }).version <= 40);
});

test("empty and overcapacity payloads cannot produce an export", async () => {
  await assert.rejects(generateQrExport(request(""), "png"), /Enter content/);
  await assert.rejects(generateQrExport(request("a".repeat(1274), { correction: "H" }), "svg"), /too big/i);
  await assert.rejects(generateQrExport(request("1".repeat(7090)), "svg"), /too long/);
  await assert.rejects(generateQrExport(request(), "jpg"), /PNG or SVG/);
  await assert.rejects(generateQrExport(request("bad contrast", { dark: "#ffffff" }), "svg"), /4.5:1/);
});

test("failed image generation is not published as a usable preview", async () => {
  const states = [];
  const pending = deferred();
  const job = startQrPreview(request(), (state) => states.push(state), delayedEncoder(pending));
  pending.reject(new Error("Image generation failed"));
  await job.done;
  assert.equal(states.at(-1).phase, "error");
  assert.equal(states.at(-1).error, "Image generation failed");
  assert.equal(states.at(-1).dataUrl, undefined);
});

test("canceled older previews cannot overwrite a newer completed request", async () => {
  const oldPending = deferred();
  const newPending = deferred();
  const states = [];
  const oldJob = startQrPreview(request("old"), (state) => states.push(state), delayedEncoder(oldPending));
  oldJob.cancel();
  const current = request("current");
  const newJob = startQrPreview(current, (state) => states.push(state), delayedEncoder(newPending));
  newPending.resolve("data:image/png;base64,bmV3");
  await newJob.done;
  oldPending.resolve("data:image/png;base64,b2xk");
  await oldJob.done;
  assert.equal(states.filter((state) => state.phase === "ready").length, 1);
  assert.equal(states.at(-1).request, current);
});

test("clearing content clears errors and suppresses a late failure", async () => {
  const pending = deferred();
  let state = { phase: "error", error: "previous failure" };
  const job = startQrPreview(request(), (next) => { state = next; }, delayedEncoder(pending));
  job.cancel();
  await startQrPreview(request(""), (next) => { state = next; }).done;
  pending.reject(new Error("late failure"));
  await job.done;
  assert.equal(state.phase, "empty");
  assert.equal(state.error, "");
});

test("malformed renderer output is rejected", async () => {
  const encoder = { create: () => ({ version: 1, modules: { size: 21 } }), toDataURL: async () => "data:,", toString: async () => "" };
  await assert.rejects(generateQrPreview(request(), encoder), /PNG image/);
  await assert.rejects(generateQrExport(request(), "svg", encoder), /SVG image/);
});

test("native cancellation and canceled requests never write a file", async () => {
  let writes = 0;
  const bridge = { saveFileDialog: async () => ({ ok: false }), writeText: async () => { writes += 1; } };
  assert.equal((await saveQrRequest(request(), "svg", bridge)).status, "canceled");
  let current = true;
  bridge.saveFileDialog = async () => { current = false; return { ok: true, path: "ignored.svg" }; };
  assert.equal((await saveQrRequest(request(), "svg", bridge, { isCurrent: () => current })).status, "canceled");
  assert.equal(writes, 0);
});

test("save encodes its current snapshot, never an older preview or edited options", async () => {
  const settings = { ...QR_PRESETS.screen };
  const current = createQrRequest("current content", settings);
  const phases = [];
  let written;
  const outcome = await saveQrRequest(current, "png", {
    saveFileDialog: async ({ defaultName }) => {
      assert.equal(defaultName, "qr-code.png");
      settings.dark = "#ffffff";
      settings.size = 2048;
      return { ok: true, path: "output.png" };
    },
    writeFile: async (path, data) => { written = { path, data }; return { ok: true }; }
  }, { onPhase: (phase) => phases.push(phase) });
  assert.deepEqual(phases, ["preparing", "choosing", "writing"]);
  assert.equal(outcome.status, "saved");
  assert.equal(written.path, "output.png");
  assert.equal(written.data, await generateQrExport(current, "png"));
  assert.notEqual(written.data, await generateQrExport(request("older content"), "png"));
});

test("save surfaces native and write failures instead of reporting cancellation or success", async () => {
  await assert.rejects(saveQrRequest(request(), "svg", { saveFileDialog: async () => { throw new Error("Dialog failed"); } }), /Dialog failed/);
  await assert.rejects(saveQrRequest(request(), "svg", { saveFileDialog: async () => ({ ok: false, error: "No dialog" }) }), /No dialog/);
  await assert.rejects(saveQrRequest(request(), "svg", {
    saveFileDialog: async () => ({ ok: true, path: "output.svg" }),
    writeText: async () => ({ ok: false, error: "Disk full" })
  }), /Disk full/);
});

test("failed generation does not open a save dialog", async () => {
  await assert.rejects(saveQrRequest(request("a".repeat(1274), { correction: "H" }), "png", {
    saveFileDialog: async () => assert.fail("Invalid QR data reached the save dialog")
  }), /too big/i);
});