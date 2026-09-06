const { contextBridge, ipcRenderer } = require("electron");

const listen = (channel, handler) => {
  const callback = (_event, value) => handler(value);
  ipcRenderer.on(channel, callback);
  return () => ipcRenderer.removeListener(channel, callback);
};

contextBridge.exposeInMainWorld("__chatNative", {
  chatWindowReady: () => ipcRenderer.invoke("chat-window:ready"),
  focusChatWindow: () => ipcRenderer.invoke("chat-window:focus"),
  finishChatDock: (options) => ipcRenderer.invoke("chat-window:docked", options),
  abortChatWindow: () => ipcRenderer.invoke("chat-window:abort"),
  onChatDockRequest: (handler) => listen("chat-window:dock-request", handler),
  onChatWindowState: (handler) => listen("chat-window:state", handler)
});