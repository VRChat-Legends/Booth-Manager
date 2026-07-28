"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { app } = require("electron");

const MAX_FILE_BYTES = 500 * 1024 * 1024;
const MAX_READ_BYTES = 64 * 1024;
const MAX_FOLDER_FILES = 400;
const MAX_FOLDER_BYTES = 2 * 1024 * 1024 * 1024;
const FOLDER_MIME = "application/x-folder";
const ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;
const FILE = () => path.join(app.getPath("userData"), "local-shares.json");

const MIME_BY_EXTENSION = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".txt": "text/plain",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".json": "application/json"
};

let cache = null;

function mimeFor(filePath) {
  return MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function load() {
  if (cache) return cache;
  try {
    const raw = JSON.parse(fs.readFileSync(FILE(), "utf8"));
    cache = raw && typeof raw === "object" && raw.files && typeof raw.files === "object"
      ? raw
      : { version: 1, files: {} };
    let migrated = false;
    for (const record of Object.values(cache.files)) {
      if (Number.isFinite(Number(record.modifiedAtMs))) continue;
      try {
        const stat = fs.statSync(record.path);
        if (stat.isFile() && stat.size === record.size) {
          record.modifiedAtMs = stat.mtimeMs;
          migrated = true;
        }
      } catch {
        /* unavailable legacy shares remain unavailable */
      }
    }
    if (migrated) {
      fs.mkdirSync(path.dirname(FILE()), { recursive: true });
      fs.writeFileSync(FILE(), JSON.stringify(cache, null, 2), "utf8");
    }
  } catch {
    cache = { version: 1, files: {} };
  }
  return cache;
}

function save() {
  fs.mkdirSync(path.dirname(FILE()), { recursive: true });
  fs.writeFileSync(FILE(), JSON.stringify(load(), null, 2), "utf8");
}

function assertId(id) {
  const value = String(id || "");
  if (!ID_PATTERN.test(value)) throw new Error("Invalid local share ID");
  return value;
}

function inspect(record) {
  if (record.kind === "folder") {
    try {
      const available = fs.statSync(record.path).isDirectory();
      return { available, modifiedAt: null };
    } catch {
      return { available: false, modifiedAt: null };
    }
  }
  try {
    const stat = fs.statSync(record.path);
    const expectedModifiedAt = Number(record.modifiedAtMs);
    const available = stat.isFile()
      && stat.size === record.size
      && Number.isFinite(expectedModifiedAt)
      && stat.mtimeMs === expectedModifiedAt;
    return { available, modifiedAt: available ? stat.mtime.toISOString() : null };
  } catch {
    return { available: false, modifiedAt: null };
  }
}

function publicRecord(record) {
  const status = inspect(record);
  const kind = record.kind === "folder"
    ? "folder"
    : record.mime.startsWith("image/") ? "image" : record.mime.startsWith("video/") ? "video" : record.mime.startsWith("audio/") ? "audio" : "file";
  return {
    id: record.id,
    name: record.name,
    size: record.size,
    mime: record.mime,
    kind,
    available: status.available,
    modifiedAt: status.modifiedAt,
    entryCount: record.kind === "folder" ? (record.entryIds || []).length : undefined,
    localUrl: status.available && record.kind !== "folder" ? `booth-local://shared/${record.id}` : ""
  };
}

function addPaths(filePaths) {
  const added = [];
  const rejected = [];
  for (const filePath of Array.isArray(filePaths) ? filePaths : []) {
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) throw new Error("Not a file");
      if (stat.size > MAX_FILE_BYTES) throw new Error("Files must be 500 MB or smaller");
      const id = `file_${crypto.randomBytes(12).toString("base64url")}`;
      const record = {
        id,
        path: path.resolve(filePath),
        name: path.basename(filePath).slice(0, 160),
        size: stat.size,
        mime: mimeFor(filePath),
        modifiedAtMs: stat.mtimeMs,
        addedAt: new Date().toISOString()
      };
      load().files[id] = record;
      added.push(publicRecord(record));
    } catch (error) {
      rejected.push({ name: path.basename(String(filePath || "file")), error: String(error.message || error) });
    }
  }
  if (added.length) save();
  return { files: added, rejected };
}

function get(id) {
  return load().files[assertId(id)] || null;
}

/** Registers every file in a folder as an individual share plus one folder
 * record, so peer transfers of single entries reuse the plain file path. */
function addFolder(dirPath) {
  const root = path.resolve(String(dirPath || ""));
  let rootStat;
  try {
    rootStat = fs.statSync(root);
  } catch {
    return { ok: false, error: "That folder could not be read." };
  }
  if (!rootStat.isDirectory()) return { ok: false, error: "Pick a folder, not a file." };

  const records = [];
  const skipped = [];
  let total = 0;
  const walk = (dir, rel) => {
    let items;
    try {
      items = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const item of items) {
      if (records.length >= MAX_FOLDER_FILES) {
        skipped.push({ name: item.name, error: `Only the first ${MAX_FOLDER_FILES} files were shared.` });
        return;
      }
      if (item.name.startsWith(".")) continue;
      if (item.isSymbolicLink()) continue;
      const full = path.join(dir, item.name);
      const relPath = rel ? `${rel}/${item.name}` : item.name;
      if (item.isDirectory()) {
        walk(full, relPath);
        continue;
      }
      if (!item.isFile()) continue;
      let stat;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      if (stat.size > MAX_FILE_BYTES) {
        skipped.push({ name: relPath, error: "Files must be 500 MB or smaller." });
        continue;
      }
      if (total + stat.size > MAX_FOLDER_BYTES) {
        skipped.push({ name: relPath, error: "The folder passed the 2 GB share limit." });
        continue;
      }
      total += stat.size;
      records.push({
        id: `file_${crypto.randomBytes(12).toString("base64url")}`,
        path: full,
        name: item.name.slice(0, 160),
        relPath: relPath.slice(0, 300),
        size: stat.size,
        mime: mimeFor(full),
        modifiedAtMs: stat.mtimeMs,
        addedAt: new Date().toISOString()
      });
    }
  };
  walk(root, "");
  if (!records.length) return { ok: false, error: "That folder has no shareable files.", rejected: skipped };

  const folder = {
    id: `folder_${crypto.randomBytes(12).toString("base64url")}`,
    kind: "folder",
    path: root,
    name: path.basename(root).slice(0, 120) || "Shared folder",
    size: total,
    mime: FOLDER_MIME,
    modifiedAtMs: 0,
    addedAt: new Date().toISOString(),
    entryIds: records.map((record) => record.id)
  };
  const store = load();
  for (const record of records) store.files[record.id] = record;
  store.files[folder.id] = folder;
  save();
  return {
    ok: true,
    folder: publicRecord(folder),
    entries: records.map((record) => ({ id: record.id, relPath: record.relPath, name: record.name, size: record.size, mime: record.mime })),
    rejected: skipped
  };
}

function list() {
  return Object.values(load().files).map(publicRecord);
}

function status(id) {
  const record = get(id);
  return record ? publicRecord(record) : { id: String(id || ""), available: false };
}

function readChunk(id, offset, requestedBytes) {
  const record = get(id);
  if (!record) return { ok: false, error: "Local file is no longer shared." };
  if (record.kind === "folder") return { ok: false, error: "Folders cannot be streamed directly." };
  const current = inspect(record);
  if (!current.available) return { ok: false, error: "The local file was moved, changed, or deleted." };
  const start = Math.max(0, Math.floor(Number(offset) || 0));
  if (start > record.size) return { ok: false, error: "Invalid file offset." };
  if (start === record.size) return { ok: true, data: new ArrayBuffer(0), offset: start, eof: true };
  const length = Math.max(1, Math.min(Math.floor(Number(requestedBytes) || MAX_READ_BYTES), MAX_READ_BYTES, record.size - start));

  const buffer = Buffer.allocUnsafe(length);
  let fd = null;
  let bytesRead = 0;
  try {
    fd = fs.openSync(record.path, "r");
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size !== record.size || stat.mtimeMs !== Number(record.modifiedAtMs)) {
      throw new Error("The local file changed while it was being shared.");
    }
    bytesRead = fs.readSync(fd, buffer, 0, length, start);
    if (bytesRead <= 0) throw new Error("The local file ended before the transfer completed.");
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
  }
  const data = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + bytesRead);
  return { ok: true, data, offset: start + bytesRead, eof: start + bytesRead >= record.size };
}

module.exports = { addPaths, addFolder, get, list, status, readChunk, publicRecord, mimeFor, MAX_FILE_BYTES, MAX_READ_BYTES, ID_PATTERN };