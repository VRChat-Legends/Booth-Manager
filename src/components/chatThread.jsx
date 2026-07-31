// Shared chat thread rendering: message rows, peer-served attachments, and
// the folder viewer. Team chat and support ticket threads both render
// through this component so the attachment pipeline stays single-source.
import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronRight,
  Download,
  File,
  Folder,
  FolderOpen,
  Image,
  LoaderCircle,
  Lock,
  Music,
  Play,
  Trash2,
  Video,
  X
} from "lucide-react";
import * as api from "../lib/api.js";
import peerFiles from "../lib/peerFiles.js";
import ModalPortal from "./ModalPortal.jsx";

export const RISKY_FILE_PATTERN = /\.(exe|msi|bat|cmd|ps1|psm1|vbs|vbe|js|jse|jar|scr|com|dll|apk|reg|lnk|hta|wsf|wsh|gadget)$/i;

export function iconFor(kind) {
  if (kind === "image") return <Image size={13} />;
  if (kind === "video") return <Video size={13} />;
  if (kind === "audio") return <Music size={13} />;
  if (kind === "folder") return <Folder size={13} />;
  return <File size={13} />;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isPinged(body, selfName) {
  if (!body || !selfName) return false;
  return new RegExp(`@${escapeRegExp(selfName)}(?![\\w])`, "i").test(body);
}

/** Highlights @mentions of known members inside a message body. */
export function renderBody(body, members, selfName) {
  const names = (members || []).map((member) => member.name).filter(Boolean).sort((a, b) => b.length - a.length);
  if (!names.length || !body.includes("@")) return body;
  const pattern = new RegExp(`@(${names.map(escapeRegExp).join("|")})`, "gi");
  const parts = [];
  let last = 0;
  let match;
  let key = 0;
  while ((match = pattern.exec(body)) !== null) {
    if (match.index > last) parts.push(body.slice(last, match.index));
    const self = selfName && match[1].toLowerCase() === selfName.toLowerCase();
    parts.push(<span key={key++} className={`mention${self ? " self" : ""}`}>@{match[1]}</span>);
    last = match.index + match[0].length;
  }
  if (!parts.length) return body;
  if (last < body.length) parts.push(body.slice(last));
  return parts;
}

export function MessageAvatar({ url, name }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  if (url && !failed) return <img src={url} alt="" onError={() => setFailed(true)} />;
  return <div className="message-avatar">{(name || "?")[0]?.toUpperCase()}</div>;
}

function AutoPauseVideo({ src }) {
  const ref = useRef(null);
  // pause playback when the video scrolls out of view
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting && !el.paused) el.pause();
      }
    }, { threshold: 0.2 });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return <video ref={ref} src={src} controls preload="metadata" />;
}

export function Attachment({ attachment, transfer, communityId, own, peerDisabled }) {
  const request = () => peerFiles.request(attachment, communityId);
  const pending = ["requesting", "connecting", "transferring"].includes(transfer?.status);
  const ready = transfer?.status === "ready" && transfer.localUrl;
  const failed = transfer?.status === "error";
  // Own files never depend on the server availability flag: they either
  // resolve from disk or the local copy itself is gone.
  const missing = !ready && !pending && (own
    ? transfer?.status === "unavailable"
    : (!attachment.available || transfer?.status === "unavailable"));

  // Rooms where peer transfers are shut off (the Alley Lounge): show the
  // file info but never offer a download that would broker a connection.
  if (peerDisabled && !ready) {
    return (
      <div className="attachment-missing attachment-disabled">
        <Lock size={18} />
        <div>
          <strong>{attachment.name}</strong>
          <span>File transfers are disabled in this room to protect member privacy.</span>
        </div>
      </div>
    );
  }

  if (attachment.kind === "folder") {
    return <FolderAttachment attachment={attachment} communityId={communityId} own={own} />;
  }

  if (attachment.kind === "image" && ready) {
    return <div className="attachment-media"><img src={transfer.localUrl} alt={attachment.name} /><AttachmentCaption attachment={attachment} transfer={transfer} own={own} /></div>;
  }

  if (attachment.kind === "video" && ready) {
    return <div className="attachment-media"><AutoPauseVideo src={transfer.localUrl} /><AttachmentCaption attachment={attachment} transfer={transfer} own={own} /></div>;
  }

  if (attachment.kind === "audio" && ready) {
    return (
      <div className="attachment-audio">
        <span className="attachment-file-icon"><Music size={19} /></span>
        <div className="grow">
          <strong>{attachment.name}</strong>
          <audio src={transfer.localUrl} controls preload="metadata" />
        </div>
        {!own && <button className="icon-button small" title="Save file" onClick={() => peerFiles.save(attachment.id)}><Download size={14} /></button>}
        {own && <span className="pill teal">LOCAL</span>}
      </div>
    );
  }

  if (missing) {
    return (
      <div className="attachment-missing">
        <AlertTriangle size={18} />
        <div>
          <strong>{attachment.name}</strong>
          <span>{own
            ? "Your local copy of this file was moved, renamed, or changed since you shared it."
            : "This local file was moved, changed, deleted, or the uploader is offline."}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`attachment-file${failed ? " failed" : ""}`}>
      <span className="attachment-file-icon">{attachment.kind === "video" ? <Video size={19} /> : attachment.kind === "audio" ? <Music size={19} /> : attachment.kind === "image" ? <Image size={19} /> : <File size={19} />}</span>
      <div className="grow"><strong>{attachment.name}</strong><span>{api.formatBytes(attachment.size)} | served from the uploader's computer</span>{failed && <small>{transfer.error}</small>}</div>
      {pending && <div className="transfer-progress"><LoaderCircle size={15} className="spin" /><span>{Math.round((transfer.progress || 0) * 100)}%</span></div>}
      {!pending && !ready && <button className="small" onClick={request}>{attachment.kind === "video" || attachment.kind === "audio" ? <Play size={14} /> : <Download size={14} />}Load from peer</button>}
      {ready && !own && <button className="small" onClick={() => peerFiles.save(attachment.id)}><Download size={14} />Save</button>}
      {ready && own && <span className="pill teal">LOCAL</span>}
    </div>
  );
}

function AttachmentCaption({ attachment, transfer, own }) {
  return <div className="attachment-caption"><span><strong>{attachment.name}</strong><small>{api.formatBytes(attachment.size)}</small></span>{!own && <button className="icon-button small" title="Save file" onClick={() => peerFiles.save(attachment.id)}><Download size={14} /></button>}{own && <span className="pill teal">LOCAL</span>}</div>;
}

/* ---------- shared folders ---------- */

function FolderAttachment({ attachment, communityId, own }) {
  const [open, setOpen] = useState(false);
  const offline = !own && !attachment.available;
  const count = attachment.entryCount ?? (attachment.entries || []).length;
  return (
    <>
      <div className="attachment-file attachment-folder">
        <span className="attachment-file-icon"><Folder size={19} /></span>
        <div className="grow">
          <strong>{attachment.name}</strong>
          <span>{count} files | {api.formatBytes(attachment.size)} | shared folder{offline ? " | uploader offline" : ""}</span>
        </div>
        <button className="small" onClick={() => setOpen(true)}><FolderOpen size={14} />Browse files</button>
        {own && <span className="pill teal">LOCAL</span>}
      </div>
      {open && <FolderViewer attachment={attachment} communityId={communityId} own={own} onClose={() => setOpen(false)} />}
    </>
  );
}

/** In-app file viewer for a shared folder: browse subfolders, download
 * individual files over the same peer channel as single attachments. */
function FolderViewer({ attachment, communityId, own, onClose }) {
  const [transfers, setTransfers] = useState({});
  const [dir, setDir] = useState("");
  const [confirmId, setConfirmId] = useState("");
  useEffect(() => peerFiles.subscribe(setTransfers), []);

  const entries = attachment.entries || [];
  const prefix = dir ? `${dir}/` : "";
  const subdirs = new Map();
  const files = [];
  for (const entry of entries) {
    if (!entry.relPath.startsWith(prefix)) continue;
    const rest = entry.relPath.slice(prefix.length);
    const slash = rest.indexOf("/");
    if (slash === -1) {
      files.push(entry);
    } else {
      const name = rest.slice(0, slash);
      const info = subdirs.get(name) || { count: 0, size: 0 };
      info.count += 1;
      info.size += entry.size;
      subdirs.set(name, info);
    }
  }
  const crumbs = dir ? dir.split("/") : [];

  const download = (entry) => {
    if (RISKY_FILE_PATTERN.test(entry.relPath) && confirmId !== entry.id) {
      setConfirmId(entry.id);
      return;
    }
    setConfirmId("");
    peerFiles.request({
      id: entry.id,
      name: entry.relPath.split("/").pop(),
      size: entry.size,
      mime: entry.mime,
      authorId: attachment.authorId,
      available: attachment.available && entry.available !== false
    }, communityId).catch(() => {});
  };

  return (
    <ModalPortal><div className="modal-scrim" onClick={onClose}>
      <div className="modal folder-viewer" onClick={(clickEvent) => clickEvent.stopPropagation()}>
        <div className="fv-head">
          <Folder size={17} />
          <h2>{attachment.name}</h2>
          <span className="muted tiny">{entries.length} files | {api.formatBytes(attachment.size)}</span>
          <button className="icon-button right" title="Close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="fv-warning">
          <AlertTriangle size={14} />
          <span>These files stream from {own ? "your" : "the uploader's"} computer, not from Legends Alley servers. Only download files from people you trust.</span>
        </div>
        <div className="fv-breadcrumbs">
          <button className={dir ? "" : "current"} onClick={() => setDir("")}>{attachment.name}</button>
          {crumbs.map((crumb, index) => (
            <span key={index} className="fv-crumb">
              <ChevronRight size={12} />
              <button
                className={index === crumbs.length - 1 ? "current" : ""}
                onClick={() => setDir(crumbs.slice(0, index + 1).join("/"))}
              >{crumb}</button>
            </span>
          ))}
        </div>
        <div className="fv-list">
          {[...subdirs.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, info]) => (
            <button key={name} className="fv-row fv-dir" onClick={() => setDir(prefix + name)}>
              <Folder size={16} />
              <strong>{name}</strong>
              <span>{info.count} files | {api.formatBytes(info.size)}</span>
              <ChevronRight size={14} className="right" />
            </button>
          ))}
          {files.sort((a, b) => a.relPath.localeCompare(b.relPath)).map((entry) => {
            const transfer = transfers[entry.id];
            const pending = ["requesting", "connecting", "transferring"].includes(transfer?.status);
            const ready = transfer?.status === "ready";
            const failed = transfer?.status === "error" || transfer?.status === "unavailable";
            const risky = RISKY_FILE_PATTERN.test(entry.relPath);
            const fileName = entry.relPath.split("/").pop();
            return (
              <div key={entry.id} className={`fv-row${failed ? " failed" : ""}`}>
                {iconFor(entry.kind)}
                <strong title={fileName}>{fileName}</strong>
                {risky && <span className="pill amber" title="This file type can run code on your computer"><AlertTriangle size={10} /> RISKY</span>}
                <span>{api.formatBytes(entry.size)}</span>
                {failed && <small className="fv-error">{transfer.error || "Unavailable"}</small>}
                {pending && <span className="transfer-progress"><LoaderCircle size={14} className="spin" />{Math.round((transfer.progress || 0) * 100)}%</span>}
                {!pending && !ready && confirmId !== entry.id && (
                  <button className="small" onClick={() => download(entry)}><Download size={13} />{failed ? "Retry" : own ? "Open" : "Download"}</button>
                )}
                {confirmId === entry.id && (
                  <span className="fv-confirm">
                    <small>Runs code when opened. Sure?</small>
                    <button className="small danger" onClick={() => download(entry)}>Yes, download</button>
                    <button className="small" onClick={() => setConfirmId("")}>No</button>
                  </span>
                )}
                {ready && !own && <button className="small" onClick={() => peerFiles.save(entry.id)}><Download size={13} />Save</button>}
                {ready && own && <span className="pill teal">LOCAL</span>}
              </div>
            );
          })}
          {!subdirs.size && !files.length && <div className="muted small" style={{ padding: 14 }}>This folder level is empty.</div>}
        </div>
      </div>
    </div></ModalPortal>
  );
}

/* ---------- message list ---------- */

/**
 * The message rows themselves: grouping, author meta, mention highlighting,
 * attachments, and the optional shift-click delete affordance.
 */
export function MessageList({
  messages,
  ownId,
  selfName,
  members = [],
  memberAvatars,
  transfers = {},
  roomId,
  canDelete,
  onDelete,
  onHint,
  peerDisabled = false
}) {
  return messages.map((message, index) => {
    if (message.authorRole === "system") {
      return (
        <div key={message.id} className={`ticket-system-event${message.action ? ` ${message.action}` : ""}`}>
          <span className="ticket-system-line" />
          <div>
            <strong>{message.body}</strong>
            <time dateTime={message.createdAt}>{api.formatDate(message.createdAt)}</time>
          </div>
          <span className="ticket-system-line" />
        </div>
      );
    }
    const own = String(message.authorId) === ownId;
    const previous = messages[index - 1];
    const grouped = previous?.authorId === message.authorId
      && Date.parse(message.createdAt) - Date.parse(previous.createdAt) < 5 * 60 * 1000;
    const avatarUrl = message.authorAvatarUrl || memberAvatars?.get(String(message.authorId)) || "";
    const deletable = canDelete ? canDelete(message) : false;
    return (
      <div key={message.id} className={`message${own ? " own" : ""}${grouped ? " grouped" : ""}`}>
        {!grouped && <MessageAvatar url={avatarUrl} name={message.authorName} />}
        <div className="message-content">
          {!grouped && <div className="message-meta"><strong>{own ? "You" : message.authorName}</strong><span className="author-role">{message.authorRole}</span><span>{api.formatDate(message.createdAt)}</span></div>}
          {message.body && (
            <div className={`message-bubble${isPinged(message.body, selfName) && !own ? " pinged" : ""}`}>
              {renderBody(message.body, members, selfName)}
            </div>
          )}
          {(message.attachments || []).map((attachment) => (
            <Attachment
              key={attachment.id}
              attachment={attachment}
              transfer={transfers[attachment.id]}
              communityId={roomId}
              own={String(attachment.authorId) === ownId}
              peerDisabled={peerDisabled}
            />
          ))}
        </div>
        {deletable && (
          <button
            className="message-delete"
            title="Hold Shift and click to delete"
            onClick={(clickEvent) => {
              if (!clickEvent.shiftKey) {
                onHint?.("Hold Shift and click the trash icon to delete a message.");
                return;
              }
              onDelete?.(message);
            }}
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
    );
  });
}
