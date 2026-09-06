// shared message rows and peer attachments
import { Fragment, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronRight,
  Copy,
  Download,
  File,
  Folder,
  FolderOpen,
  Image,
  LoaderCircle,
  Lock,
  Music,
  Play,
  Quote,
  Trash2,
  Video,
  X
} from "lucide-react";
import * as api from "../lib/api.js";
import { canGroupMessages, formatChatTime, isPinged, messageDayKey, messageTextParts } from "../lib/chatMessages.mjs";
import { MarkdownView } from "../lib/markdown.jsx";
import peerFiles from "../lib/peerFiles.js";
import ModalPortal, { usePortalDocument } from "./ModalPortal.jsx";
import "../message-refinements.css";

export { isPinged } from "../lib/chatMessages.mjs";

export const RISKY_FILE_PATTERN = /\.(exe|msi|bat|cmd|ps1|psm1|vbs|vbe|js|jse|jar|scr|com|dll|apk|reg|lnk|hta|wsf|wsh|gadget)$/i;

export function iconFor(kind) {
  if (kind === "image") return <Image size={13} />;
  if (kind === "video") return <Video size={13} />;
  if (kind === "audio") return <Music size={13} />;
  if (kind === "folder") return <Folder size={13} />;
  return <File size={13} />;
}

export function renderBody(body, members, selfName, searchQuery = "") {
  return messageTextParts(body, members, selfName, searchQuery).map((segment, index) => {
    const content = segment.parts.map((part, partIndex) => part.match
      ? <mark key={partIndex} className="message-search-match">{part.text}</mark>
      : part.text);
    return segment.mention
      ? <span key={index} className={`mention${segment.self ? " self" : ""}`}>{content}</span>
      : <Fragment key={index}>{content}</Fragment>;
  });
}

export function MessageAvatar({ url, name }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  if (url && !failed) return <img src={url} alt="" onError={() => setFailed(true)} />;
  return <div className="message-avatar">{(name || "?")[0]?.toUpperCase()}</div>;
}

function AutoPauseVideo({ src }) {
  const owner = usePortalDocument();
  const ref = useRef(null);
  // pause playback when the video scrolls out of view
  useEffect(() => {
    const el = ref.current;
    if (!el || !owner.defaultView?.IntersectionObserver) return undefined;
    const observer = new owner.defaultView.IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting && !el.paused) el.pause();
      }
    }, { threshold: 0.2 });
    observer.observe(el);
    return () => observer.disconnect();
  }, [owner]);
  return <video ref={ref} src={src} controls preload="metadata" />;
}

export function Attachment({ attachment, transfer, communityId, own, peerDisabled, showMediaPreviews = true }) {
  const request = () => peerFiles.request(attachment, communityId);
  const pending = ["requesting", "connecting", "transferring"].includes(transfer?.status);
  const ready = transfer?.status === "ready" && transfer.localUrl;
  const failed = transfer?.status === "error";
  // own files resolve from disk, not the server availability flag
  const missing = !ready && !pending && (own
    ? transfer?.status === "unavailable"
    : (!attachment.available || transfer?.status === "unavailable"));

  // disabled rooms must not broker peer connections
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

  if (showMediaPreviews && attachment.kind === "image" && ready) {
    return <div className="attachment-media"><img src={transfer.localUrl} alt={attachment.name} /><AttachmentCaption attachment={attachment} transfer={transfer} own={own} /></div>;
  }

  if (showMediaPreviews && attachment.kind === "video" && ready) {
    return <div className="attachment-media"><AutoPauseVideo src={transfer.localUrl} /><AttachmentCaption attachment={attachment} transfer={transfer} own={own} /></div>;
  }

  if (showMediaPreviews && attachment.kind === "audio" && ready) {
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

// folders use the same peer channel as single files
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

function MessageTimestamp({ iso, timeFormat, grouped = false }) {
  const label = formatChatTime(iso, timeFormat);
  if (!label) return null;
  return (
    <time
      className={`message-time${grouped ? " message-time-grouped" : ""}`}
      dateTime={iso}
      title={new Date(iso).toLocaleString(undefined, { dateStyle: "full", timeStyle: "long" })}
    >{label}</time>
  );
}

async function runMessageAction(callback, value, onHint) {
  try {
    await callback?.(value);
  } catch {
    try {
      await onHint?.("That message action could not be completed. Please try again.");
    } catch {}
  }
}

function MessageActions({ message, deletable, onQuote, onCopy, onRequestDelete, onDelete, onHint }) {
  const canQuote = typeof onQuote === "function";
  const canCopy = typeof onCopy === "function";
  const confirmDelete = typeof onRequestDelete === "function";
  const deleteLabel = confirmDelete ? "Delete message" : "Hold Shift and click to delete";
  const deleteButton = deletable && (
    <button
      type="button"
      className="message-delete"
      title={deleteLabel}
      aria-label={deleteLabel}
      onClick={(clickEvent) => {
        if (confirmDelete) {
          return runMessageAction(onRequestDelete, message, onHint);
        }
        if (!clickEvent.shiftKey) {
          return runMessageAction(onHint, "Hold Shift and click the trash icon to delete a message.");
        }
        return runMessageAction(onDelete, message, onHint);
      }}
    ><Trash2 size={13} aria-hidden="true" /></button>
  );
  if (!canQuote && !canCopy) return deleteButton;
  return (
    <div className="message-actions">
      {canQuote && (
        <button type="button" className="message-action" title="Quote message" aria-label="Quote message" onClick={() => runMessageAction(onQuote, message, onHint)}>
          <Quote size={13} aria-hidden="true" />
        </button>
      )}
      {canCopy && (
        <button type="button" className="message-action" title="Copy message" aria-label="Copy message" onClick={() => runMessageAction(onCopy, message, onHint)}>
          <Copy size={13} aria-hidden="true" />
        </button>
      )}
      {deleteButton}
    </div>
  );
}

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
  peerDisabled = false,
  preferences,
  searchQuery = "",
  onQuote,
  onCopy,
  onRequestDelete,
  textOnly = false
}) {
  const hasPreferences = preferences != null;
  const showAvatars = preferences?.showAvatars !== false;
  const showTimestamps = preferences?.showTimestamps !== false;
  const showRoleBadges = preferences?.showRoleBadges !== false;
  const showMediaPreviews = preferences?.showMediaPreviews !== false && !textOnly;
  return messages.map((message, index) => {
    const previous = messages[index - 1];
    const day = hasPreferences ? messageDayKey(message.createdAt) : "";
    const dayLabel = day ? new Date(message.createdAt).toLocaleDateString(undefined, { dateStyle: "full" }) : "";
    const separator = day && day !== messageDayKey(previous?.createdAt) && (
      <div className="message-day-separator" role="separator" aria-label={dayLabel}>
        <time dateTime={day}>{dayLabel}</time>
      </div>
    );
    if (message.authorRole === "system") {
      return (
        <Fragment key={message.id}>
          {separator}
          <div data-message-id={message.id} className={`ticket-system-event${message.action ? ` ${message.action}` : ""}`}>
            <span className="ticket-system-line" />
            <div>
              <strong>{searchQuery ? renderBody(message.body, members, selfName, searchQuery) : message.body}</strong>
              {showTimestamps && (hasPreferences
                ? <MessageTimestamp iso={message.createdAt} timeFormat={preferences.timeFormat} />
                : <time dateTime={message.createdAt}>{api.formatDate(message.createdAt)}</time>)}
            </div>
            <span className="ticket-system-line" />
          </div>
        </Fragment>
      );
    }
    const own = String(message.authorId) === ownId;
    const elapsed = Date.parse(message.createdAt) - Date.parse(previous?.createdAt);
    const grouped = hasPreferences ? canGroupMessages(previous, message, preferences.groupMessages)
      : previous?.authorRole !== "system" && previous?.authorId === message.authorId
        && elapsed >= 0 && elapsed < 5 * 60 * 1000;
    const avatarUrl = message.authorAvatarUrl || memberAvatars?.get(String(message.authorId)) || "";
    const deletable = canDelete ? canDelete(message) : false;
    return (
      <Fragment key={message.id}>
        {separator}
        <div data-message-id={message.id} className={`message${own ? " own" : ""}${grouped ? " grouped" : ""}${!showAvatars ? " message-no-avatars" : ""}`}>
          {showAvatars && !grouped && <MessageAvatar url={avatarUrl} name={message.authorName} />}
          <div className="message-content">
            {!grouped && (
              <div className="message-meta">
                <strong>{searchQuery ? renderBody(own ? "You" : message.authorName, [], "", searchQuery) : own ? "You" : message.authorName}</strong>
                {showRoleBadges && <span className="author-role">{message.authorRole}</span>}
                {showTimestamps && (hasPreferences
                  ? <MessageTimestamp iso={message.createdAt} timeFormat={preferences.timeFormat} />
                  : <span>{api.formatDate(message.createdAt)}</span>)}
              </div>
            )}
            {message.body && (
              <div className={`message-bubble${isPinged(message.body, selfName) && !own ? " pinged" : ""}`} style={{ borderRadius: 4, maxWidth: "100%" }}>
                <MarkdownView text={message.body} members={members} selfName={selfName} searchQuery={searchQuery} showMediaPreviews={showMediaPreviews} textOnly={textOnly} />
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
                showMediaPreviews={showMediaPreviews}
              />
            ))}
            {hasPreferences && grouped && showTimestamps && <MessageTimestamp iso={message.createdAt} timeFormat={preferences.timeFormat} grouped />}
          </div>
          <MessageActions message={message} deletable={deletable} onQuote={onQuote} onCopy={onCopy} onRequestDelete={onRequestDelete} onDelete={onDelete} onHint={onHint} />
        </div>
      </Fragment>
    );
  });
}
