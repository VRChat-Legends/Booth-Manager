"use strict";

const { app } = require("electron");
const { autoUpdater } = require("electron-updater");

const GITHUB_REPO = "VRChat-Legends/Booth-Manager";

let updateState = {
  status: "idle", // idle | checking | available | downloading | downloaded | uptodate | error
  currentVersion: app.getVersion(),
  latestVersion: "",
  releaseNotes: "",
  progress: 0,
  error: ""
};

const listeners = new Set();
let checkTimer = null;

function emit() {
  const snapshot = { ...updateState };
  for (const fn of listeners) {
    try { fn(snapshot); } catch { /* ignore */ }
  }
}

function setState(patch) {
  updateState = { ...updateState, ...patch };
  emit();
}

function configure() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;

  autoUpdater.on("checking-for-update", () => setState({ status: "checking", error: "" }));
  autoUpdater.on("update-available", (info) => {
    setState({ status: "available", latestVersion: info?.version || "", releaseNotes: String(info?.releaseNotes || "").slice(0, 4000) });
  });
  autoUpdater.on("update-not-available", () => setState({ status: "uptodate" }));
  autoUpdater.on("download-progress", (p) => setState({ status: "downloading", progress: Math.round(p?.percent || 0) }));
  autoUpdater.on("update-downloaded", () => setState({ status: "downloaded", progress: 100 }));
  autoUpdater.on("error", (err) => {
    const message = String(err && err.message ? err.message : err);
    setState(message.includes("No published versions on GitHub")
      ? { status: "uptodate", error: "" }
      : { status: "error", error: message.slice(0, 300) });
  });
}

async function check() {
  if (!app.isPackaged) {
    // dev builds: compare against the GitHub latest release tag for visibility only
    try {
      const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "Booth-Manager" }
      });
      if (res.ok) {
        const data = await res.json();
        const latest = String(data.tag_name || "").replace(/^v/i, "");
        setState({ status: latest && latest !== app.getVersion() ? "available" : "uptodate", latestVersion: latest });
      } else {
        setState({ status: "uptodate" });
      }
    } catch {
      setState({ status: "uptodate" });
    }
    return { ...updateState };
  }
  try {
    await autoUpdater.checkForUpdates();
  } catch (ex) {
    const message = String(ex && ex.message ? ex.message : ex);
    setState(message.includes("No published versions on GitHub")
      ? { status: "uptodate", error: "" }
      : { status: "error", error: message.slice(0, 300) });
  }
  return { ...updateState };
}

async function download() {
  if (!app.isPackaged) return { ...updateState };
  try {
    await autoUpdater.downloadUpdate();
  } catch (ex) {
    setState({ status: "error", error: String(ex && ex.message ? ex.message : ex).slice(0, 300) });
  }
  return { ...updateState };
}

function install() {
  if (!app.isPackaged) return;
  autoUpdater.quitAndInstall(false, true);
}

function start(onState) {
  configure();
  if (typeof onState === "function") listeners.add(onState);
  // check on open, then every 30 minutes while the app runs (Discord-style)
  setTimeout(() => void check(), 4000);
  checkTimer = setInterval(() => void check(), 30 * 60 * 1000);
}

function stop() {
  if (checkTimer) clearInterval(checkTimer);
  checkTimer = null;
}

function getState() {
  return { ...updateState };
}

module.exports = { start, stop, check, download, install, getState };
