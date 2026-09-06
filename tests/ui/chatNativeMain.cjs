const { app, BrowserWindow, ipcMain, session } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createChatWindowManager } = require("../../electron/chatWindow.js");

const root = path.resolve(__dirname, "../..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "booth-chat-native-test-"));
app.setName("Booth Manager Desktop Tests");
app.setPath("userData", temporary);
let quitting = false;
let manager;
let main;
app.on("before-quit", () => { quitting = true; manager?.dispose(); });
app.on("window-all-closed", () => app.quit());
app.on("quit", () => { try { fs.rmSync(temporary, { recursive: true, force: true }); } catch {} });

app.whenReady().then(async () => {
  const blockedRequests = [];
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = new URL(details.url);
    const external = ["http:", "https:"].includes(url.protocol) && !["127.0.0.1", "localhost"].includes(url.hostname);
    if (external) blockedRequests.push(details.url);
    callback({ cancel: external });
  });
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => callback(permission.startsWith("clipboard")));
  main = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1120, minHeight: 700, show: true, backgroundColor: "#100e15",
    webPreferences: { preload: path.join(__dirname, "chatNativePreload.cjs"), contextIsolation: true, sandbox: false, nodeIntegration: false }
  });
  main.setMenu(null);
  manager = createChatWindowManager({ owner: main, canOpen: () => true, isQuitting: () => quitting, showMain: () => { main.show(); main.focus(); } });
  main.webContents.setWindowOpenHandler((details) => manager.handleOpen(details) || { action: "deny" });
  for (const [channel, method] of Object.entries({
    "chat-window:ready": "markReady", "chat-window:focus": "focus", "chat-window:docked": "finishDock", "chat-window:abort": "abort"
  })) {
    ipcMain.handle(channel, (event, options) => event.sender === main.webContents && event.senderFrame === event.sender.mainFrame
      ? manager[method](options) : { ok: false });
  }
  global.__chatTest = { manager, main, blockedRequests, temporary };
  if (process.argv.includes("--booth-chat-built")) {
    const html = fs.readFileSync(path.join(root, "dist/index.html"), "utf8");
    const fixture = fs.readFileSync(path.join(__dirname, "chatFixture.js"), "utf8");
    const base = pathToFileURL(path.join(root, "dist") + path.sep).href;
    const content = html.replace("<head>", `<head><base href="${base}"><script>${fixture}</script>`);
    const target = path.join(temporary, "fixture.html");
    fs.writeFileSync(target, content);
    await main.loadFile(target);
  } else {
    await main.loadURL("http://127.0.0.1:5175/tests/ui/chatDesktop.html");
  }
});