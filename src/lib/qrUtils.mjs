import QRCode from "qrcode";

export const QR_PRESETS = Object.freeze({
  screen: Object.freeze({ size: 512, margin: 4, correction: "M", dark: "#000000", light: "#ffffff", transparent: false }),
  print: Object.freeze({ size: 1024, margin: 4, correction: "Q", dark: "#000000", light: "#ffffff", transparent: false }),
  poster: Object.freeze({ size: 2048, margin: 6, correction: "H", dark: "#000000", light: "#ffffff", transparent: false })
});

export const QR_BYTE_CAPACITY = Object.freeze({ L: 2953, M: 2331, Q: 1663, H: 1273 });

function wifiEscape(value) {
  return String(value ?? "").replace(/([\\;,:"])/g, "\\$1");
}

export function buildWifiPayload({ ssid = "", password = "", security = "WPA", hidden = false } = {}) {
  if (!String(ssid).trim()) return "";
  if (!["WPA", "WEP", "nopass"].includes(security)) throw new Error("Choose a supported WiFi security mode.");
  const fields = [`WIFI:T:${security}`, `S:${wifiEscape(ssid)}`];
  if (security !== "nopass") fields.push(`P:${wifiEscape(password)}`);
  fields.push(`H:${hidden ? "true" : "false"}`);
  return `${fields.join(";")};;`;
}

export function getPayloadStats(value) {
  return { characters: Array.from(value).length, bytes: new TextEncoder().encode(value).length };
}

export function relativeLuminance(hex) {
  if (!/^#[a-f0-9]{6}$/i.test(hex)) throw new Error("Choose valid code and background colors.");
  const channels = [1, 3, 5].map((offset) => {
    const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

export function getQrReadiness(settings, modules = 0) {
  const foreground = relativeLuminance(settings.dark);
  const background = relativeLuminance(settings.light);
  const ratio = (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  const contrastReady = settings.transparent || (foreground < background && ratio >= 4.5);
  const quietReady = settings.margin >= 4;
  const pixelsPerModule = modules > 0 ? settings.size / (modules + settings.margin * 2) : null;
  const pngReady = pixelsPerModule !== null && pixelsPerModule >= 4;
  const checks = [
    {
      id: "contrast", label: "Luminance contrast",
      state: settings.transparent ? "check" : contrastReady ? "pass" : "fix",
      detail: settings.transparent
        ? "Unknown until a background is chosen for placement."
        : `${ratio.toFixed(2)}:1. Aim for at least 4.5:1 with a darker code on a lighter background.`
    },
    {
      id: "quiet", label: "Clear border",
      state: quietReady ? "pass" : "fix",
      detail: `${settings.margin} modules on every side. Keep at least four clear modules around the code.`
    },
    {
      id: "background", label: "Background",
      state: settings.transparent ? "check" : "pass",
      detail: settings.transparent
        ? "Transparent output has no solid backing. Keep the final background uniform, including the clear border."
        : "A solid background is included in both exports."
    },
    {
      id: "density", label: "PNG detail",
      state: pixelsPerModule === null ? "pending" : pngReady ? "pass" : "fix",
      detail: pixelsPerModule === null
        ? "Available once the payload has been encoded."
        : `${pixelsPerModule.toFixed(1)} pixels per module. The PNG export uses a conservative minimum of four. SVG can scale further.`
    }
  ];
  return {
    checks, pixelsPerModule, contrastRatio: settings.transparent ? null : ratio,
    canExportSvg: contrastReady && quietReady,
    canExportPng: contrastReady && quietReady && pngReady
  };
}

export function createQrRequest(value, settings) {
  const snapshot = Object.freeze({ ...settings });
  const color = Object.freeze({ dark: `${snapshot.dark}ff`, light: `${snapshot.light}${snapshot.transparent ? "00" : "ff"}` });
  return Object.freeze({
    value,
    settings: snapshot,
    options: Object.freeze({ errorCorrectionLevel: snapshot.correction, margin: snapshot.margin, width: snapshot.size, color })
  });
}

function createSymbol(request, encoder) {
  if (!request.value) throw new Error("Enter content before generating a QR code.");
  if (getPayloadStats(request.value).characters > 7089) throw new Error("This payload is too long for a QR code. Shorten the content.");
  return encoder.create(request.value, request.options);
}

async function pngDataUrl(request, encoder) {
  const dataUrl = await encoder.toDataURL(request.value, { ...request.options, type: "image/png" });
  if (!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(dataUrl)) throw new Error("Could not create a PNG image.");
  return dataUrl;
}

export async function generateQrPreview(request, encoder = QRCode) {
  const symbol = createSymbol(request, encoder);
  const dataUrl = await pngDataUrl(request, encoder);
  return { dataUrl, version: symbol.version, modules: symbol.modules.size };
}

export function startQrPreview(request, publish, encoder = QRCode) {
  let canceled = false;
  const update = (state) => { if (!canceled) publish({ request, error: "", ...state }); };
  const done = (async () => {
    if (!request.value) {
      update({ phase: "empty" });
      return;
    }
    update({ phase: "building" });
    try {
      update({ phase: "ready", ...await generateQrPreview(request, encoder) });
    } catch (error) {
      update({ phase: "error", error: String(error?.message || error) });
    }
  })();
  return { done, cancel: () => { canceled = true; } };
}

export async function generateQrExport(request, format, encoder = QRCode) {
  if (!["png", "svg"].includes(format)) throw new Error("Choose PNG or SVG for export.");
  const symbol = createSymbol(request, encoder);
  const readiness = getQrReadiness(request.settings, symbol.modules.size);
  const blocking = readiness.checks.filter((check) => check.state === "fix" && (format === "png" || check.id !== "density"));
  if (blocking.length) throw new Error(blocking.map((check) => check.detail).join(" "));
  if (format === "png") return (await pngDataUrl(request, encoder)).split(",")[1];
  const svg = await encoder.toString(request.value, { ...request.options, type: "svg" });
  if (typeof svg !== "string" || !svg.includes("<svg")) throw new Error("Could not create an SVG image.");
  return svg;
}

function fileStem(value) {
  if (/^https?:\/\//i.test(value)) {
    try { return `qr-${new URL(value).hostname.replace(/^www\./, "").replace(/[^a-z0-9.-]+/gi, "-")}`; } catch { return "qr-code"; }
  }
  return "qr-code";
}

export async function saveQrRequest(request, format, bridge, { isCurrent = () => true, onPhase = () => {} } = {}, encoder = QRCode) {
  if (!isCurrent()) return { status: "canceled" };
  onPhase("preparing");
  const data = await generateQrExport(request, format, encoder);
  if (!isCurrent()) return { status: "canceled" };
  onPhase("choosing");
  const picked = await bridge.saveFileDialog({
    defaultName: `${fileStem(request.value)}.${format}`,
    filters: [{ name: format === "png" ? "PNG image" : "SVG vector image", extensions: [format] }]
  });
  if (!isCurrent()) return { status: "canceled" };
  if (!picked?.ok) {
    if (picked?.error) throw new Error(picked.error);
    return { status: "canceled" };
  }
  if (!picked.path) throw new Error("The save dialog did not return a file path.");
  onPhase("writing");
  const written = format === "png" ? await bridge.writeFile(picked.path, data) : await bridge.writeText(picked.path, data);
  if (!written?.ok) throw new Error(written?.error || `Could not save the ${format.toUpperCase()}.`);
  return { status: "saved", path: picked.path };
}