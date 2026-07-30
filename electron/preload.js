const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("boothApi", {
  // config
  getConfig: () => ipcRenderer.invoke("config:get"),
  saveConfig: (patch) => ipcRenderer.invoke("config:save", patch),
  getAppVersion: () => ipcRenderer.invoke("app:version"),
  openExternal: (url) => ipcRenderer.invoke("app:openExternal", url),
  uninstallApp: () => ipcRenderer.invoke("app:uninstall"),

  // alley service API
  alleyLogin: () => ipcRenderer.invoke("alley:login"),
  alleyLogout: () => ipcRenderer.invoke("alley:logout"),
  alleyRequest: (path, options) => ipcRenderer.invoke("alley:request", path, options),
  alleyDownload: (path, defaultName) => ipcRenderer.invoke("alley:download", path, defaultName),
  alleyImage: (pathOrUrl) => ipcRenderer.invoke("alley:image", pathOrUrl),

  // github (changelog + bug tracker + sdk page)
  githubReleases: () => ipcRenderer.invoke("github:releases"),
  githubIssues: () => ipcRenderer.invoke("github:issues"),
  githubSdkReleases: () => ipcRenderer.invoke("github:sdkReleases"),
  githubSdkReadme: () => ipcRenderer.invoke("github:sdkReadme"),

  // native notifications
  notifyNative: (payload) => ipcRenderer.invoke("notify:show", payload),

  // dialogs + files
  openImageDialog: (opts) => ipcRenderer.invoke("dialog:openImage", opts),
  openSharedFiles: () => ipcRenderer.invoke("dialog:openSharedFiles"),
  openSharedFolder: () => ipcRenderer.invoke("dialog:openSharedFolder"),
  // drag and drop: File -> absolute path (Electron removed File.path)
  pathForFile: (file) => {
    try { return webUtils.getPathForFile(file); } catch { return ""; }
  },
  addSharedPaths: (paths) => ipcRenderer.invoke("shares:addPaths", paths),
  readImageFile: (path) => ipcRenderer.invoke("file:readImage", path),
  broadcastUploadAssets: () => ipcRenderer.invoke("alley:broadcastAssets"),
  saveFileDialog: (opts) => ipcRenderer.invoke("dialog:saveFile", opts),
  pickFolder: () => ipcRenderer.invoke("dialog:pickFolder"),
  writeFile: (path, dataBase64) => ipcRenderer.invoke("fs:writeFile", path, dataBase64),
  writeText: (path, text) => ipcRenderer.invoke("fs:writeText", path, text),
  showInFolder: (path) => ipcRenderer.invoke("fs:showInFolder", path),
  listLocalShares: () => ipcRenderer.invoke("shares:list"),
  getLocalShareStatus: (id) => ipcRenderer.invoke("shares:status", id),
  readLocalShareChunk: (id, offset, length) => ipcRenderer.invoke("shares:readChunk", id, offset, length),
  beginIncomingFile: (sessionId, metadata) => ipcRenderer.invoke("incoming:begin", sessionId, metadata),
  appendIncomingFile: (sessionId, data) => ipcRenderer.invoke("incoming:append", sessionId, data),
  finishIncomingFile: (sessionId) => ipcRenderer.invoke("incoming:finish", sessionId),
  cancelIncomingFile: (sessionId) => ipcRenderer.invoke("incoming:cancel", sessionId),
  saveIncomingFile: (sessionId) => ipcRenderer.invoke("incoming:save", sessionId),

  // updates
  getUpdateState: () => ipcRenderer.invoke("updates:getState"),
  checkForUpdates: () => ipcRenderer.invoke("updates:check"),
  downloadUpdate: () => ipcRenderer.invoke("updates:download"),
  installUpdate: () => ipcRenderer.invoke("updates:install"),
  onUpdateState: (handler) => {
    if (typeof handler !== "function") return () => {};
    const listener = (_event, state) => handler(state);
    ipcRenderer.on("updates:state", listener);
    return () => ipcRenderer.removeListener("updates:state", listener);
  }
});
