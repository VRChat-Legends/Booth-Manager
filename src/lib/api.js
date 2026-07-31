// Thin wrappers over the preload bridge.

const api = window.boothApi;

export const getConfig = () => api.getConfig();
export const saveConfig = (patch) => api.saveConfig(patch);
export const getAppVersion = () => api.getAppVersion();
export const openExternal = (url) => api.openExternal(url);
export const uninstallApp = () => api.uninstallApp();

// alley service
export const alleyLogin = () => api.alleyLogin();
export const alleyLogout = () => api.alleyLogout();
export const alley = (path, options) => api.alleyRequest(path, options);
export const alleyDownload = (path, defaultName) => api.alleyDownload(path, defaultName);

// github (public repo)
export const githubReleases = () => api.githubReleases();
export const githubIssues = () => api.githubIssues();
export const githubSdkReleases = () => api.githubSdkReleases();
export const githubSdkReadme = () => api.githubSdkReadme();

// native notifications (respects the Settings toggle in the main process)
export const notifyNative = (payload) => api.notifyNative(payload);

const imageCache = new Map();

/** Fetches an auth-protected alley image and returns an object URL (cached). */
export async function alleyImageUrl(pathOrUrl) {
  const key = String(pathOrUrl || "");
  if (!key) return "";
  if (imageCache.has(key)) return imageCache.get(key);
  const res = await api.alleyImage(key);
  if (!res || !res.dataBase64) return "";
  const bytes = Uint8Array.from(atob(res.dataBase64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: res.contentType || "image/png" }));
  imageCache.set(key, url);
  return url;
}

export const openImageDialog = (opts) => api.openImageDialog(opts);
export const openSharedFiles = () => api.openSharedFiles();
export const openSharedFolder = () => api.openSharedFolder();
export const pathForFile = (file) => api.pathForFile(file);
export const addSharedPaths = (paths) => api.addSharedPaths(paths);
export const readImageFile = (path) => api.readImageFile(path);
export const openAtlasPackage = () => api.openAtlasPackage();
export const readAtlasPackage = (paths) => api.readAtlasPackage(paths);
export const broadcastUploadAssets = () => api.broadcastUploadAssets();
export const saveFileDialog = (opts) => api.saveFileDialog(opts);
export const pickFolder = () => api.pickFolder();
export const writeFile = (path, dataBase64) => api.writeFile(path, dataBase64);
export const writeText = (path, text) => api.writeText(path, text);
export const showInFolder = (path) => api.showInFolder(path);
export const listLocalShares = () => api.listLocalShares();
export const getLocalShareStatus = (id) => api.getLocalShareStatus(id);
export const readLocalShareChunk = (id, offset, length) => api.readLocalShareChunk(id, offset, length);
export const beginIncomingFile = (sessionId, metadata) => api.beginIncomingFile(sessionId, metadata);
export const appendIncomingFile = (sessionId, data) => api.appendIncomingFile(sessionId, data);
export const finishIncomingFile = (sessionId) => api.finishIncomingFile(sessionId);
export const cancelIncomingFile = (sessionId) => api.cancelIncomingFile(sessionId);
export const saveIncomingFile = (sessionId) => api.saveIncomingFile(sessionId);

export const getUpdateState = () => api.getUpdateState();
export const checkForUpdates = () => api.checkForUpdates();
export const downloadUpdate = () => api.downloadUpdate();
export const installUpdate = () => api.installUpdate();
export const onUpdateState = (fn) => api.onUpdateState(fn);

export function timeAgo(iso) {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(t).toLocaleDateString();
}

export function formatDate(iso) {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit"
  });
}

export function formatBytes(n) {
  const b = Number(n) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}
