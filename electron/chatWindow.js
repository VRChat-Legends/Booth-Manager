"use strict";

const CHAT_WINDOW_NAME = "booth-manager-chat";

function createChatWindowManager({ owner, icon, canOpen = () => true, isQuitting = () => false, showMain = () => {}, schedule = setTimeout, cancel = clearTimeout }) {
  let child = null;
  let reserved = false;
  let ready = false;
  let closing = false;
  let disposed = false;
  let reserveTimer = null;
  let previousThrottling = null;
  const getState = () => ({ detached: Boolean(child || reserved), ready });
  const send = (channel, payload) => {
    if (!disposed && !owner.isDestroyed() && !owner.webContents.isDestroyed()) owner.webContents.send(channel, payload);
  };
  const clearReservation = () => {
    if (reserveTimer !== null) cancel(reserveTimer);
    reserveTimer = null;
    reserved = false;
  };
  const restoreThrottling = () => {
    if (previousThrottling !== null && !owner.webContents.isDestroyed()) owner.webContents.backgroundThrottling = previousThrottling;
    previousThrottling = null;
  };
  const focus = () => {
    if (!child || child.isDestroyed()) return { ok: false };
    if (child.isMinimized()) child.restore();
    child.show();
    child.focus();
    return { ok: true };
  };
  const handleOpen = ({ url, frameName }) => {
    if (url !== "about:blank" || frameName !== CHAT_WINDOW_NAME) return null;
    if (disposed || isQuitting() || !canOpen()) return { action: "deny" };
    if (child || reserved) { if (ready) focus(); return { action: "deny" }; }
    reserved = true;
    reserveTimer = schedule(() => { clearReservation(); send("chat-window:state", getState()); }, 10_000);
    reserveTimer?.unref?.();
    return {
      action: "allow",
      outlivesOpener: false,
      overrideBrowserWindowOptions: {
        title: "Team Chat | Booth Manager", width: 1280, height: 840, minWidth: 980, minHeight: 700,
        backgroundColor: "#100e15", autoHideMenuBar: true, show: false, icon,
        webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
      }
    };
  };
  const track = (window, details) => {
    if (details.url !== "about:blank" || details.frameName !== CHAT_WINDOW_NAME) return;
    if (disposed || child || !reserved || isQuitting() || !canOpen()) { clearReservation(); window.destroy(); return; }
    clearReservation();
    child = window;
    ready = false;
    previousThrottling = owner.webContents.backgroundThrottling;
    owner.webContents.backgroundThrottling = false;
    window.setMenu(null);
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    window.webContents.on("will-frame-navigate", (event) => event.preventDefault());
    window.webContents.on("before-input-event", (event, input) => {
      if (input.key === "F5" || ((input.control || input.meta) && String(input.key).toLowerCase() === "r")) event.preventDefault();
    });
    window.on("close", (event) => {
      if (closing || disposed || isQuitting()) return;
      event.preventDefault();
      send("chat-window:dock-request");
    });
    window.once("closed", () => {
      if (child !== window) return;
      child = null;
      ready = false;
      restoreThrottling();
      send("chat-window:state", getState());
    });
    send("chat-window:state", getState());
  };
  const finishDock = ({ quiet = false } = {}) => {
    const hadWindow = Boolean(child || reserved);
    if (!hadWindow) return { ok: true };
    clearReservation();
    const previous = child;
    child = null;
    closing = true;
    try { if (previous && !previous.isDestroyed()) previous.destroy(); }
    finally { child = null; ready = false; closing = false; restoreThrottling(); }
    send("chat-window:state", getState());
    if (hadWindow && !quiet && !disposed && !isQuitting()) showMain();
    return { ok: true };
  };
  const markReady = () => {
    if (!child || child.isDestroyed() || disposed) return { ok: false, error: "The chat window could not be opened." };
    ready = true;
    focus();
    send("chat-window:state", getState());
    return { ok: true };
  };
  const abort = () => child ? { ok: false } : (clearReservation(), send("chat-window:state", getState()), { ok: true });
  const navigation = (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace) finishDock({ quiet: true }); };
  const rendererGone = () => finishDock({ quiet: true });
  owner.webContents.on("did-create-window", track);
  owner.webContents.on("did-start-navigation", navigation);
  owner.webContents.on("render-process-gone", rendererGone);
  const dispose = () => {
    disposed = true;
    finishDock({ quiet: true });
    owner.webContents.removeListener("did-create-window", track);
    owner.webContents.removeListener("did-start-navigation", navigation);
    owner.webContents.removeListener("render-process-gone", rendererGone);
  };
  return { handleOpen, getState, getWindow: () => child, focus, markReady, finishDock, abort, dispose };
}

module.exports = { CHAT_WINDOW_NAME, createChatWindowManager };