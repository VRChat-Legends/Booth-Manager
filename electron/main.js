"use strict";

const path = require("path");
const fs = require("fs");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");
const { spawn } = require("child_process");
const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, shell, protocol, session } = require("electron");
const { readConfig, writeConfig } = require("./configStore");
const shareStore = require("./shareStore");
const auth = require("./auth");
const updater = require("./updater");

protocol.registerSchemesAsPrivileged([{
  scheme: "booth-local",
  privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true }
}]);

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

const APP_DISPLAY_NAME = "Booth Manager";
app.setName(APP_DISPLAY_NAME);
if (process.platform === "win32") {
  app.setAppUserModelId("com.vrchatlegends.boothmanager");
}

let mainWindow = null;
const incomingTransfers = new Map();
const receivedFiles = new Map();
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;
const RECEIVED_ROOT = () => path.join(app.getPath("temp"), "vrchat-legends-booth-manager", String(process.pid));

// Older service builds did not return a user object, but the SDK JWT itself
// carries identity. Decode it locally so the app never shows a blank user and
// the peer file service always knows who we are.
function identityFromToken(token) {
  try {
    const payload = JSON.parse(Buffer.from(String(token).split(".")[1], "base64url").toString("utf8"));
    const discordUserId = String(payload.discordUserId || "");
    const username = String(payload.username || "");
    let avatarUrl = String(payload.avatar || "");
    if (avatarUrl && !/^https:\/\//i.test(avatarUrl)) {
      // raw Discord avatar hash from an older token
      avatarUrl = discordUserId && /^[a-f0-9_]+$/i.test(avatarUrl)
        ? `https://cdn.discordapp.com/avatars/${discordUserId}/${avatarUrl}.png?size=128`
        : "";
    }
    return discordUserId ? { discordUserId, username, avatarUrl } : null;
  } catch {
    return null;
  }
}

function fillIdentityFromToken() {
  const cfg = readConfig();
  if (!cfg.alleyToken || (cfg.alleyDiscordId && cfg.alleyUsername)) return;
  const identity = identityFromToken(cfg.alleyToken);
  if (!identity) return;
  writeConfig({
    alleyDiscordId: cfg.alleyDiscordId || identity.discordUserId,
    alleyUsername: cfg.alleyUsername || identity.username,
    alleyAvatarUrl: cfg.alleyAvatarUrl || identity.avatarUrl
  });
}

function alleyBase() {
  return String(readConfig().alleyApiBase || "https://alley.vrchatlegends.com").replace(/\/$/, "");
}

// ------------------------------------------------------------------
// HTTP proxy helpers (renderer never talks to the network directly,
// so tokens stay in the main process and CORS never applies)
// ------------------------------------------------------------------

const BLOCKED_HOSTS = /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[?::1)/i;

// A compromised renderer must never be able to point these helpers at
// file:// paths, other protocols, or a different origin than the service.
function resolveProxyUrl(base, pathName) {
  const raw = String(pathName || "");
  if (base) {
    if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return null;
    let url;
    try { url = new URL(base + raw); } catch { return null; }
    if (url.origin !== new URL(base).origin) return null;
    return url;
  }
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== "https:" || BLOCKED_HOSTS.test(url.hostname)) return null;
  return url;
}

async function proxyFetch(base, token, pathName, options = {}) {
  const target = resolveProxyUrl(base, pathName);
  if (!target) return { status: 0, data: null, error: "Blocked request path." };
  const url = target.href;
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;

  let body;
  if (options.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.json);
  } else if (options.bufferBase64) {
    headers["Content-Type"] = options.contentType || "application/octet-stream";
    body = Buffer.from(options.bufferBase64, "base64");
  }

  try {
    const res = await fetch(url, { method: options.method || "GET", headers, body });
    const status = res.status;
    const contentType = res.headers.get("content-type") || "";

    if (options.binary) {
      if (!res.ok) return { status, error: `HTTP ${status}` };
      const buf = Buffer.from(await res.arrayBuffer());
      return { status, dataBase64: buf.toString("base64"), contentType };
    }

    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    const error = !res.ok
      ? (data && (data.error || data.message)) || `HTTP ${status}`
      : "";
    return { status, data, error };
  } catch (ex) {
    return { status: 0, data: null, error: String(ex && ex.message ? ex.message : ex) };
  }
}

// ------------------------------------------------------------------
// IPC: config
// ------------------------------------------------------------------

ipcMain.handle("config:get", () => readConfig());
ipcMain.handle("config:save", (_e, patch) => {
  const result = writeConfig(patch);
  if (patch && Object.prototype.hasOwnProperty.call(patch, "startWithWindows")) applyLoginItemSettings();
  return result;
});
ipcMain.handle("app:version", () => app.getVersion());
ipcMain.handle("app:openExternal", async (_e, url) => {
  const s = String(url || "");
  if (/^https?:\/\//i.test(s)) await shell.openExternal(s);
});

// ------------------------------------------------------------------
// IPC: alley service API (SDK JWT)
// ------------------------------------------------------------------

ipcMain.handle("alley:login", async () => {
  const result = await auth.loginAlley(alleyBase());
  if (result.ok) {
    writeConfig({
      alleyToken: result.token,
      alleyStaff: result.staff,
      alleyRole: result.role,
      alleyCommunityName: result.community ? String(result.community.name || "") : "",
      alleyCommunityId: result.community ? String(result.community.id || "") : "",
      alleyGroupId: result.community ? String(result.community.groupId || "") : "",
      alleyLogoUrl: result.community ? String(result.community.logoUrl || "") : "",
      alleyDiscordId: result.user ? String(result.user.discordUserId || "") : "",
      alleyUsername: result.user ? String(result.user.username || "") : "",
      alleyAvatarUrl: result.user ? String(result.user.avatarUrl || "") : ""
    });
  }
  return result;
});

ipcMain.handle("alley:logout", async () => {
  writeConfig({
    alleyToken: "",
    alleyStaff: false,
    alleyRole: "",
    alleyCommunityName: "",
    alleyCommunityId: "",
    alleyGroupId: "",
    alleyLogoUrl: "",
    alleyDiscordId: "",
    alleyUsername: "",
    alleyAvatarUrl: ""
  });
  return { ok: true };
});

ipcMain.handle("alley:request", async (_e, pathName, options) => {
  const cfg = readConfig();
  const res = await proxyFetch(alleyBase(), cfg.alleyToken, pathName, options || {});
  if (pathName === "/api/auth/me" && res.status === 200 && res.data) {
    const community = res.data.community || null;
    const user = res.data.user || null;
    // Cosmetic identity fields (avatar, username, logo) fall back to the last
    // known value instead of blanking when the service omits them.
    writeConfig({
      alleyStaff: res.data.staff === true,
      alleyRole: String(res.data.role || ""),
      alleyCommunityName: community ? String(community.name || "") : "",
      alleyCommunityId: community ? String(community.id || "") : "",
      alleyGroupId: community ? String(community.groupId || "") : "",
      alleyLogoUrl: community ? (String(community.logoUrl || "") || cfg.alleyLogoUrl) : cfg.alleyLogoUrl,
      alleyDiscordId: user ? (String(user.discordUserId || "") || cfg.alleyDiscordId) : cfg.alleyDiscordId,
      alleyUsername: user ? (String(user.username || "") || cfg.alleyUsername) : cfg.alleyUsername,
      alleyAvatarUrl: user ? (String(user.avatarUrl || "") || cfg.alleyAvatarUrl) : cfg.alleyAvatarUrl
    });
    if (!user) fillIdentityFromToken();
  }
  if ((res.status === 401 || res.status === 403) && pathName === "/api/auth/me") {
    writeConfig({
      alleyToken: "",
      alleyStaff: false,
      alleyRole: "",
      alleyCommunityName: "",
      alleyCommunityId: "",
      alleyGroupId: "",
      alleyLogoUrl: "",
      alleyDiscordId: "",
      alleyUsername: "",
      alleyAvatarUrl: ""
    });
  }
  return res;
});

ipcMain.handle("alley:download", async (_e, pathName, defaultName) => {
  const requestPath = String(pathName || "");
  const isBooth = /^\/api\/booths\/[A-Za-z0-9_-]+\/download$/.test(requestPath);
  const isBroadcastAsset = /^\/api\/broadcasts\/assets\/[A-Za-z0-9_-]+$/.test(requestPath);
  if (!isBooth && !isBroadcastAsset) {
    return { ok: false, error: "That download is not allowed." };
  }
  const picked = await dialog.showSaveDialog(mainWindow, {
    defaultPath: String(defaultName || (isBooth ? "booth-backup.zip" : "attachment")),
    filters: isBooth
      ? [{ name: "Booth backup", extensions: ["zip"] }]
      : [{ name: "All files", extensions: ["*"] }]
  });
  if (picked.canceled || !picked.filePath) return { ok: false, canceled: true };

  const cfg = readConfig();
  try {
    const response = await fetch(alleyBase() + requestPath, {
      headers: { Authorization: `Bearer ${cfg.alleyToken}` }
    });
    if (!response.ok || !response.body) {
      const body = await response.json().catch(() => ({}));
      return { ok: false, error: body.error || `Download failed (${response.status}).` };
    }
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(picked.filePath));
    shell.showItemInFolder(picked.filePath);
    return { ok: true, path: picked.filePath };
  } catch (error) {
    try { fs.unlinkSync(picked.filePath); } catch { /* ignore */ }
    return { ok: false, error: String(error.message || error) };
  }
});

// fetch an auth-protected alley image (booth previews, community logos)
ipcMain.handle("alley:image", async (_e, pathOrUrl) => {
  const cfg = readConfig();
  const p = String(pathOrUrl || "");
  const alleyOrigin = new URL(alleyBase()).origin;
  if (/^https?:\/\//i.test(p)) {
    let parsed = null;
    try { parsed = new URL(p); } catch { parsed = null; }
    if (!parsed) return { status: 0, error: "Blocked request path." };
    if (parsed.origin === alleyOrigin) {
      return await proxyFetch(alleyBase(), cfg.alleyToken, parsed.pathname + parsed.search, { binary: true });
    }
    // absolute non-alley URL (e.g. Discord CDN): https only, never with our token
    return await proxyFetch("", "", p, { binary: true });
  }
  return await proxyFetch(alleyBase(), cfg.alleyToken, p, { binary: true });
});

// ------------------------------------------------------------------
// IPC: GitHub (public repo metadata for the changelog + bug tracker)
// ------------------------------------------------------------------

const GITHUB_REPO = "VRChat-Legends/Booth-Manager";
const GITHUB_RELEASES_PATH = `/repos/${GITHUB_REPO}/releases?per_page=20`;
const GITHUB_ISSUES_PATH = `/repos/${GITHUB_REPO}/issues?state=all&per_page=50`;
const GITHUB_TTL_MS = 10 * 60 * 1000;
const githubCache = new Map();
const githubCacheFile = () => path.join(app.getPath("userData"), "github-cache.json");

function readGithubDisk() {
  try { return JSON.parse(fs.readFileSync(githubCacheFile(), "utf8")); } catch { return {}; }
}

async function githubFetch(apiPath) {
  try {
    const res = await fetch(`https://api.github.com${apiPath}`, {
      headers: { "User-Agent": "BoothManager", Accept: "application/vnd.github+json" }
    });
    if (!res.ok) return { status: res.status, data: null, error: `GitHub returned HTTP ${res.status}` };
    const value = { status: res.status, data: await res.json(), error: "" };
    const entry = { at: Date.now(), value };
    githubCache.set(apiPath, entry);
    try {
      const disk = readGithubDisk();
      disk[apiPath] = entry;
      fs.writeFileSync(githubCacheFile(), JSON.stringify(disk));
    } catch { /* cache write is best effort */ }
    return value;
  } catch (ex) {
    return { status: 0, data: null, error: String(ex && ex.message ? ex.message : ex) };
  }
}

// Stale-while-revalidate: any cached copy (memory or disk) renders the page
// instantly; an expired copy kicks off a background refresh for next time.
async function githubGet(apiPath) {
  let cached = githubCache.get(apiPath);
  if (!cached) {
    const disk = readGithubDisk()[apiPath];
    if (disk && disk.value) {
      cached = disk;
      githubCache.set(apiPath, disk);
    }
  }
  if (cached && cached.value && cached.value.status === 200) {
    if (Date.now() - cached.at >= GITHUB_TTL_MS) githubFetch(apiPath).catch(() => {});
    return cached.value;
  }
  return await githubFetch(apiPath);
}

ipcMain.handle("github:releases", async () => githubGet(GITHUB_RELEASES_PATH));
ipcMain.handle("github:issues", async () => githubGet(GITHUB_ISSUES_PATH));

// ------------------------------------------------------------------
// IPC: file dialogs + disk io for standee outputs
// ------------------------------------------------------------------

ipcMain.handle("dialog:openImage", async (_e, opts) => {
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: opts && opts.multi ? ["openFile", "multiSelections"] : ["openFile"],
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }]
  });
  if (res.canceled || res.filePaths.length === 0) return { ok: false };
  const files = res.filePaths.map((p) => ({
    path: p,
    name: path.basename(p),
    dataBase64: fs.readFileSync(p).toString("base64")
  }));
  return { ok: true, files };
});

ipcMain.handle("dialog:openSharedFiles", async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Images, videos, and files", extensions: ["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "mp4", "webm", "mov", "mkv", "pdf", "zip", "txt", "json", "unitypackage", "fbx", "obj", "glb", "gltf"] },
      { name: "All files", extensions: ["*"] }
    ]
  });
  if (res.canceled || !res.filePaths.length) return { ok: false, files: [], rejected: [] };
  const result = shareStore.addPaths(res.filePaths.slice(0, 5));
  return { ok: result.files.length > 0, ...result };
});

ipcMain.handle("dialog:openSharedFolder", async () => {
  const res = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory"] });
  if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
  return shareStore.addFolder(res.filePaths[0]);
});

// staff popup attachments upload straight from disk so the renderer never
// holds the bytes; the service enforces staff auth and the 40 MB cap again
ipcMain.handle("alley:broadcastAssets", async () => {
  const res = await dialog.showOpenDialog(mainWindow, { properties: ["openFile", "multiSelections"] });
  if (res.canceled || !res.filePaths.length) return { ok: false, assets: [], rejected: [] };
  const cfg = readConfig();
  const assets = [];
  const rejected = [];
  for (const filePath of res.filePaths.slice(0, 6)) {
    const name = path.basename(filePath).slice(0, 160);
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) throw new Error("Not a file.");
      if (stat.size > 40 * 1024 * 1024) throw new Error("Popup attachments must be 40 MB or smaller.");
      const mime = shareStore.mimeFor(filePath);
      const response = await fetch(
        `${alleyBase()}/api/broadcasts/assets?name=${encodeURIComponent(name)}&mime=${encodeURIComponent(mime)}`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${cfg.alleyToken}`, "Content-Type": mime },
          body: fs.readFileSync(filePath)
        }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Upload failed (${response.status}).`);
      if (data.asset) assets.push(data.asset);
    } catch (error) {
      rejected.push({ name, error: String(error.message || error) });
    }
  }
  return { ok: assets.length > 0, assets, rejected };
});

ipcMain.handle("shares:list", () => shareStore.list());
ipcMain.handle("shares:status", (_e, id) => shareStore.status(id));
ipcMain.handle("shares:readChunk", (_e, id, offset, length) => shareStore.readChunk(id, offset, length));

ipcMain.handle("incoming:begin", (_e, sessionId, metadata) => {
  const id = String(sessionId || "");
  if (!SESSION_ID_PATTERN.test(id)) return { ok: false, error: "Invalid transfer ID." };
  const size = Math.floor(Number(metadata?.size));
  if (!Number.isFinite(size) || size < 0 || size > shareStore.MAX_FILE_BYTES) {
    return { ok: false, error: "Invalid incoming file size." };
  }
  try {
    fs.mkdirSync(RECEIVED_ROOT(), { recursive: true });
    const partPath = path.join(RECEIVED_ROOT(), `${id}.part`);
    const existing = incomingTransfers.get(id);
    if (existing) fs.closeSync(existing.fd);
    const fd = fs.openSync(partPath, "w");
    incomingTransfers.set(id, {
      fd,
      path: partPath,
      received: 0,
      size,
      name: path.basename(String(metadata?.name || "attachment")).slice(0, 160),
      mime: String(metadata?.mime || "application/octet-stream").slice(0, 120)
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
});

ipcMain.handle("incoming:append", (_e, sessionId, data) => {
  const transfer = incomingTransfers.get(String(sessionId || ""));
  if (!transfer) return { ok: false, error: "Transfer is not open." };
  try {
    const bytes = data instanceof ArrayBuffer ? Buffer.from(new Uint8Array(data)) : Buffer.from(data);
    if (bytes.length > shareStore.MAX_READ_BYTES || transfer.received + bytes.length > transfer.size) {
      throw new Error("Invalid incoming chunk.");
    }
    fs.writeSync(transfer.fd, bytes, 0, bytes.length, transfer.received);
    transfer.received += bytes.length;
    return { ok: true, received: transfer.received };
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
});

ipcMain.handle("incoming:finish", (_e, sessionId) => {
  const id = String(sessionId || "");
  const transfer = incomingTransfers.get(id);
  if (!transfer) return { ok: false, error: "Transfer is not open." };
  try {
    fs.closeSync(transfer.fd);
    incomingTransfers.delete(id);
    if (transfer.received !== transfer.size) throw new Error("The transfer ended before the complete file arrived.");
    const extension = path.extname(transfer.name).match(/^\.[A-Za-z0-9]{1,10}$/)?.[0] || ".bin";
    const finalPath = path.join(RECEIVED_ROOT(), `${id}${extension}`);
    fs.renameSync(transfer.path, finalPath);
    const received = { ...transfer, path: finalPath, id };
    delete received.fd;
    receivedFiles.set(id, received);
    return { ok: true, localUrl: `booth-local://received/${id}`, name: transfer.name, size: transfer.size, mime: transfer.mime };
  } catch (error) {
    try { fs.unlinkSync(transfer.path); } catch { /* ignore */ }
    return { ok: false, error: String(error.message || error) };
  }
});

ipcMain.handle("incoming:cancel", (_e, sessionId) => {
  const id = String(sessionId || "");
  const transfer = incomingTransfers.get(id);
  if (transfer) {
    try { fs.closeSync(transfer.fd); } catch { /* ignore */ }
    try { fs.unlinkSync(transfer.path); } catch { /* ignore */ }
    incomingTransfers.delete(id);
  }
  return { ok: true };
});

ipcMain.handle("incoming:save", async (_e, sessionId) => {
  const received = receivedFiles.get(String(sessionId || ""));
  if (!received || !fs.existsSync(received.path)) return { ok: false, error: "Download the peer file again first." };
  const picked = await dialog.showSaveDialog(mainWindow, { defaultPath: received.name });
  if (picked.canceled || !picked.filePath) return { ok: false };
  try {
    fs.copyFileSync(received.path, picked.filePath);
    shell.showItemInFolder(picked.filePath);
    return { ok: true, path: picked.filePath };
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
});

ipcMain.handle("dialog:saveFile", async (_e, opts) => {
  const res = await dialog.showSaveDialog(mainWindow, {
    defaultPath: opts && opts.defaultName ? opts.defaultName : "output",
    filters: opts && Array.isArray(opts.filters) && opts.filters.length
      ? opts.filters
      : [{ name: "All files", extensions: ["*"] }]
  });
  if (res.canceled || !res.filePath) return { ok: false };
  return { ok: true, path: res.filePath };
});

ipcMain.handle("dialog:pickFolder", async () => {
  const res = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory", "createDirectory"] });
  if (res.canceled || res.filePaths.length === 0) return { ok: false };
  return { ok: true, path: res.filePaths[0] };
});

ipcMain.handle("fs:writeFile", async (_e, filePath, dataBase64) => {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, Buffer.from(String(dataBase64 || ""), "base64"));
    return { ok: true };
  } catch (ex) {
    return { ok: false, error: String(ex && ex.message ? ex.message : ex) };
  }
});

ipcMain.handle("fs:writeText", async (_e, filePath, text) => {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, String(text ?? ""), "utf8");
    return { ok: true };
  } catch (ex) {
    return { ok: false, error: String(ex && ex.message ? ex.message : ex) };
  }
});

ipcMain.handle("fs:showInFolder", async (_e, filePath) => {
  try { shell.showItemInFolder(String(filePath || "")); } catch { /* ignore */ }
});

// ------------------------------------------------------------------
// IPC: updates
// ------------------------------------------------------------------

ipcMain.handle("updates:getState", () => updater.getState());
ipcMain.handle("updates:check", async () => await updater.check());
ipcMain.handle("updates:download", async () => await updater.download());
ipcMain.handle("updates:install", () => updater.install());

// ------------------------------------------------------------------
// IPC: uninstall
// ------------------------------------------------------------------

ipcMain.handle("app:uninstall", async () => {
  if (app.isPackaged) {
    const uninstaller = path.join(path.dirname(process.execPath), "Uninstall Booth Manager.exe");
    if (fs.existsSync(uninstaller)) {
      spawn(uninstaller, [], { detached: true, stdio: "ignore" }).unref();
      isQuitting = true;
      setTimeout(() => app.quit(), 300);
      return { ok: true };
    }
  }
  // Fallback: open Windows installed-apps settings so the user can remove it there.
  await shell.openExternal("ms-settings:appsfeatures");
  return { ok: true, fallback: true };
});

// ------------------------------------------------------------------
// window
// ------------------------------------------------------------------

let tray = null;
let isQuitting = false;
let trayBalloonShown = false;
const startHidden = process.argv.includes("--hidden");

function applyLoginItemSettings() {
  if (!app.isPackaged || process.platform !== "win32") return;
  app.setLoginItemSettings({
    openAtLogin: readConfig().startWithWindows === true,
    args: ["--hidden"]
  });
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!mainWindow.isVisible()) mainWindow.show();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

function createTray() {
  tray = new Tray(path.join(__dirname, "..", "assets", "app-icon.ico"));
  tray.setToolTip("Booth Manager");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Booth Manager", click: () => showMainWindow() },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]));
  tray.on("double-click", () => showMainWindow());
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1120,
    minHeight: 700,
    backgroundColor: "#080b10",
    show: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, "..", "assets", "app-icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  Menu.setApplicationMenu(null);

  mainWindow.once("ready-to-show", () => { if (!startHidden) mainWindow.show(); });
  // Safety net: if the renderer stalls (e.g. vite optimizing deps on first run),
  // show the window anyway so the app never appears to silently not launch.
  setTimeout(() => {
    if (!startHidden && mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) mainWindow.show();
  }, 5000);

  if (process.env.VITE_DEV_SERVER === "1" || !app.isPackaged) {
    // Retry: Electron's network service can crash-restart on cold start, and vite
    // may still be optimizing deps; a single failed load left a hidden blank window.
    const devUrl = "http://127.0.0.1:5175";
    let attempts = 0;
    const tryLoad = () => {
      attempts += 1;
      mainWindow.loadURL(devUrl).catch(() => {
        if (attempts < 15) setTimeout(tryLoad, 1200);
        else mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
      });
    };
    tryLoad();
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  // The app never navigates; block anything that tries.
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const devOk = !app.isPackaged && url.startsWith("http://127.0.0.1:5175");
    if (!devOk) event.preventDefault();
  });

  // Run in tray: closing the window hides it instead of quitting.
  mainWindow.on("close", (event) => {
    if (isQuitting) return;
    if (readConfig().runInTray === false) return;
    event.preventDefault();
    mainWindow.hide();
    if (!trayBalloonShown && tray && process.platform === "win32") {
      trayBalloonShown = true;
      tray.displayBalloon({
        iconType: "info",
        title: "Booth Manager is still running",
        content: "The app is running in the tray. Double-click the tray icon to reopen it, or right-click it to quit."
      });
    }
  });
}

app.on("second-instance", () => {
  showMainWindow();
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.whenReady().then(() => {
  // The renderer needs no special browser permissions (mic, camera, geolocation, ...).
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(["clipboard-sanitized-write", "fullscreen"].includes(permission));
  });

  protocol.handle("booth-local", (request) => {
    const url = new URL(request.url);
    const id = url.pathname.replace(/^\//, "");
    let filePath = "";
    let mime = "application/octet-stream";
    if (url.hostname === "shared") {
      const record = shareStore.get(id);
      if (record && shareStore.status(id).available) {
        filePath = record.path;
        mime = record.mime || mime;
      }
    } else if (url.hostname === "received") {
      const received = receivedFiles.get(id);
      if (received && fs.existsSync(received.path)) {
        filePath = received.path;
        mime = received.mime || mime;
      }
    }
    if (!filePath) return new Response("Local file unavailable", { status: 404 });

    // Serve byte ranges ourselves so <video> can seek local files.
    let size = 0;
    try { size = fs.statSync(filePath).size; } catch { return new Response("Local file unavailable", { status: 404 }); }
    const baseHeaders = { "Content-Type": mime, "Accept-Ranges": "bytes" };
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(request.headers.get("range") || ""));
    if (range && (range[1] || range[2])) {
      let start = range[1] ? parseInt(range[1], 10) : NaN;
      let end = range[2] ? parseInt(range[2], 10) : NaN;
      if (Number.isNaN(start)) { start = Math.max(0, size - end); end = size - 1; }
      else if (Number.isNaN(end)) end = size - 1;
      end = Math.min(end, size - 1);
      if (!Number.isFinite(start) || start > end || start >= size) {
        return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
      }
      return new Response(Readable.toWeb(fs.createReadStream(filePath, { start, end })), {
        status: 206,
        headers: {
          ...baseHeaders,
          "Content-Range": `bytes ${start}-${end}/${size}`,
          "Content-Length": String(end - start + 1)
        }
      });
    }
    return new Response(Readable.toWeb(fs.createReadStream(filePath)), {
      status: 200,
      headers: { ...baseHeaders, "Content-Length": String(size) }
    });
  });
  fs.rmSync(RECEIVED_ROOT(), { recursive: true, force: true });
  fillIdentityFromToken();
  applyLoginItemSettings();
  createWindow();
  createTray();
  // Warm the changelog + bug tracker caches so those pages open instantly.
  githubGet(GITHUB_RELEASES_PATH).catch(() => {});
  githubGet(GITHUB_ISSUES_PATH).catch(() => {});
  updater.start((state) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("updates:state", state);
    }
  });
});

app.on("window-all-closed", () => {
  for (const transfer of incomingTransfers.values()) {
    try { fs.closeSync(transfer.fd); } catch { /* ignore */ }
  }
  fs.rmSync(RECEIVED_ROOT(), { recursive: true, force: true });
  updater.stop();
  app.quit();
});
