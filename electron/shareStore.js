"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { app } = require("electron");

const MAX_FILE_BYTES = 500 * 1024 * 1024;
const MAX_READ_BYTES = 64 * 1024;
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
  return {
    id: record.id,
    name: record.name,
    size: record.size,
    mime: record.mime,
    kind: record.mime.startsWith("image/") ? "image" : record.mime.startsWith("video/") ? "video" : "file",
    available: status.available,
    modifiedAt: status.modifiedAt,
    localUrl: status.available ? `booth-local://shared/${record.id}` : ""
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

module.exports = { addPaths, get, list, status, readChunk, publicRecord, MAX_FILE_BYTES, MAX_READ_BYTES, ID_PATTERN };