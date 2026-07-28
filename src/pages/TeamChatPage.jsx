import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronRight,
  Download,
  File,
  Folder,
  FolderOpen,
  Globe,
  Image,
  LoaderCircle,
  Lock,
  LockOpen,
  MessageCircle,
  Music,
  Paperclip,
  Play,
  RefreshCw,
  Send,
  Trash2,
  Users,
  Video,
  X
} from "lucide-react";
import * as api from "../lib/api.js";
import * as audio from "../lib/audio.js";
import peerFiles from "../lib/peerFiles.js";

export default function TeamChatPage({ cfg }) {
  const [rooms, setRooms] = useState(null);
  const [selectedId, setSelectedId] = useState(cfg.alleyCommunityId || "");
  const [room, setRoom] = useState(null);
  const [messages, setMessages] = useState([]);
  const [members, setMembers] = useState([]);
  const [text, setText] = useState("");
  const [mention, setMention] = useState(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [transfers, setTransfers] = useState({});
  const [error, setError] = useState("");
  const [hint, setHint] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const feedRef = useRef(null);
  const inputRef = useRef(null);
  const initialLoad = useRef(true);
  const hintTimerRef = useRef(0);
  const seenRef = useRef({ ids: new Set(), primed: false });
  const lastSendRef = useRef(0);
  const ownId = String(cfg.alleyDiscordId || "");
  const selfName = String(cfg.alleyUsername || "");
  const isStaff = cfg.alleyStaff === true;
  const isOwnRoom = selectedId && selectedId === String(cfg.alleyCommunityId || "");
  const canModerate = isStaff || (isOwnRoom && ["owner", "manager"].includes(String(cfg.alleyRole || "")));
  const canLock = isStaff || (isOwnRoom && ["owner", "manager"].includes(String(cfg.alleyRole || "")));
  const canShareFolders = isStaff || ["owner", "manager"].includes(String(cfg.alleyRole || ""));

  useEffect(() => peerFiles.subscribe(setTransfers), []);

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      const result = await api.alley("/api/chat/rooms");
      if (disposed) return;
      if (result.status === 200) {
        const list = result.data?.rooms || [];
        setRooms(list);
        setSelectedId((current) => current || list[0]?.communityId || "");
      } else {
        setRooms([]);
        setError(result.error || "Could not load team rooms.");
      }
    };
    load();
    const timer = window.setInterval(load, 30_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, []);

  const loadMessages = useCallback(async (quiet = false) => {
    if (!selectedId) return;
    if (!quiet) setLoading(true);
    const suffix = `?communityId=${encodeURIComponent(selectedId)}&limit=300`;
    const result = await api.alley(`/api/chat/messages${suffix}`);
    if (result.status === 200) {
      const next = result.data?.messages || [];
      const seen = seenRef.current;
      if (seen.primed) {
        const incoming = next.find((message) =>
          !seen.ids.has(String(message.id))
          && String(message.authorId) !== ownId
          && isPinged(message.body, selfName));
        if (incoming) audio.ping();
      }
      for (const message of next) seen.ids.add(String(message.id));
      seen.primed = true;
      setMessages(next);
      setRoom(result.data?.community || null);
      setError("");
      peerFiles.setCommunity(selectedId);
      peerFiles.watchAttachments(next.flatMap((message) => message.attachments || []));
    } else {
      setError(result.error || "Team chat is unavailable.");
    }
    setLoading(false);
  }, [selectedId, ownId, selfName]);

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      setRoom(null);
      setMembers([]);
      return undefined;
    }
    initialLoad.current = true;
    seenRef.current = { ids: new Set(), primed: false };
    setError("");
    loadMessages();
    const timer = window.setInterval(() => loadMessages(true), 3000);
    api.alley(`/api/chat/members?communityId=${encodeURIComponent(selectedId)}`).then((result) => {
      setMembers(result.status === 200 ? result.data?.members || [] : []);
    });
    return () => window.clearInterval(timer);
  }, [selectedId, loadMessages]);

  // Instant jump (bypasses the feed's smooth scrolling) so opening a room
  // lands on the newest messages, not an animated crawl from the top.
  const scrollFeedToBottom = useCallback(() => {
    const feed = feedRef.current;
    if (!feed) return;
    feed.style.scrollBehavior = "auto";
    feed.scrollTop = feed.scrollHeight;
    feed.style.scrollBehavior = "";
  }, []);

  useEffect(() => {
    const feed = feedRef.current;
    if (!feed) return;
    if (initialLoad.current || feed.scrollHeight - feed.scrollTop - feed.clientHeight < 160) {
      scrollFeedToBottom();
      if (initialLoad.current && messages.length) {
        initialLoad.current = false;
        requestAnimationFrame(scrollFeedToBottom);
      }
    }
  }, [messages, scrollFeedToBottom]);

  // Images and videos grow the feed after the initial jump; capture their
  // load events and stay pinned to the bottom while the user is near it.
  useEffect(() => {
    const feed = feedRef.current;
    if (!feed) return undefined;
    const onMediaLoad = () => {
      if (feed.scrollHeight - feed.scrollTop - feed.clientHeight < 300) scrollFeedToBottom();
    };
    feed.addEventListener("load", onMediaLoad, true);
    feed.addEventListener("loadedmetadata", onMediaLoad, true);
    return () => {
      feed.removeEventListener("load", onMediaLoad, true);
      feed.removeEventListener("loadedmetadata", onMediaLoad, true);
    };
  }, [scrollFeedToBottom]);

  useEffect(() => {
    for (const message of messages) {
      for (const attachment of message.attachments || []) {
        if (transfers[attachment.id]) continue;
        const own = String(attachment.authorId) === ownId;
        // Our own files resolve straight from disk (any kind); remote images
        // preview automatically only while the uploader is reachable.
        if (own || (attachment.kind === "image" && attachment.available)) {
          peerFiles.request(attachment, selectedId).catch(() => {});
        }
      }
    }
  }, [messages, selectedId, transfers, ownId]);

  const pickFiles = async () => {
    const result = await api.openSharedFiles();
    if (!result.ok) {
      if (result.rejected?.length) setError(result.rejected.map((item) => `${item.name}: ${item.error}`).join(" "));
      return;
    }
    setPendingFiles((current) => [...current, ...(result.files || [])].slice(0, 5));
    if (result.rejected?.length) setError(result.rejected.map((item) => `${item.name}: ${item.error}`).join(" "));
  };

  const pickFolderShare = async () => {
    const result = await api.openSharedFolder();
    if (!result.ok) {
      if (!result.canceled && result.error) setError(result.error);
      return;
    }
    setPendingFiles((current) => [...current, { ...result.folder, entries: result.entries }].slice(0, 5));
    if (result.rejected?.length) setError(result.rejected.map((item) => `${item.name}: ${item.error}`).join(" "));
  };

  const mentionCandidates = mention
    ? members.filter((member) => member.name.toLowerCase().startsWith(mention.query.toLowerCase())).slice(0, 6)
    : [];

  const updateMention = (value, caret) => {
    const before = value.slice(0, caret);
    const match = /(^|\s)@([\w .\-]{0,32})$/.exec(before);
    if (match && members.length) {
      setMention({ query: match[2], start: caret - match[2].length - 1, end: caret });
      setMentionIndex(0);
    } else {
      setMention(null);
    }
  };

  const insertMention = (member) => {
    if (!mention) return;
    const next = `${text.slice(0, mention.start)}@${member.name} ${text.slice(mention.end)}`;
    setText(next);
    setMention(null);
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      const caret = mention.start + member.name.length + 2;
      input.focus();
      input.setSelectionRange(caret, caret);
    });
  };

  const send = async () => {
    const body = text.trim();
    if (!selectedId || (!body && !pendingFiles.length) || sending) return;
    if (Date.now() - lastSendRef.current < 800) return; // soft anti-spam, server enforces the real limit
    lastSendRef.current = Date.now();
    setSending(true);
    const result = await api.alley("/api/chat/messages", {
      method: "POST",
      json: {
        communityId: selectedId,
        body,
        attachments: pendingFiles.map(({ id, name, size, mime, entries }) => (entries
          ? { id, name, size, mime, entries: entries.map((entry) => ({ id: entry.id, relPath: entry.relPath, size: entry.size, mime: entry.mime })) }
          : { id, name, size, mime }))
      }
    });
    setSending(false);
    if (result.status === 201) {
      const message = result.data?.message;
      setText("");
      setPendingFiles([]);
      if (message) {
        setMessages((current) => current.concat(message));
        peerFiles.watchAttachments(message.attachments || []);
      }
      setError("");
      audio.success();
    } else {
      setError(result.error || "Message was not sent.");
    }
  };

  const flashHint = (text) => {
    setHint(text);
    window.clearTimeout(hintTimerRef.current);
    hintTimerRef.current = window.setTimeout(() => setHint(""), 4000);
  };

  const removeMessage = async (message) => {
    const result = await api.alley(
      `/api/chat/messages/${encodeURIComponent(message.id)}?communityId=${encodeURIComponent(selectedId)}`,
      { method: "DELETE" }
    );
    if (result.status === 200) {
      setMessages((current) => current.filter((entry) => entry.id !== message.id));
    } else {
      setError(result.error || "Could not delete the message.");
    }
  };

  const toggleLock = async () => {
    const result = await api.alley("/api/chat/lock", {
      method: "POST",
      json: { communityId: selectedId, locked: !(room?.locked === true) }
    });
    if (result.status === 200) {
      audio.success();
      loadMessages(true);
    } else {
      setError(result.error || "Could not change the room lock.");
    }
  };

  const memberAvatars = useMemo(() => {
    const map = new Map();
    for (const member of members) {
      if (member.avatarUrl) map.set(String(member.id), member.avatarUrl);
    }
    return map;
  }, [members]);

  const selectedRoom = (rooms || []).find((candidate) => candidate.communityId === selectedId);
  const isGlobal = selectedId === "global";
  const locked = room?.locked === true || (room === null && selectedRoom?.locked === true);
  const composerBlocked = locked && !canModerate;
  const roomLogo = isGlobal ? "" : room?.logoUrl || selectedRoom?.logoUrl || cfg.alleyLogoUrl || "";

  return (
    <div className="chat-layout page staff-chat">
      <aside className="chat-rooms">
        <div className="panel-title"><span>{isStaff ? "Community rooms" : "Rooms"}</span><small>{rooms?.length || 0}</small></div>
        {!rooms && <div className="skeleton" style={{ height: 180 }} />}
        {(rooms || []).map((candidate) => (
          <button key={candidate.communityId} className={`chat-room${selectedId === candidate.communityId ? " active" : ""}`} onClick={() => setSelectedId(candidate.communityId)}>
            <RoomLogo url={candidate.logoUrl} name={candidate.name} global={candidate.global} />
            <span>
              <strong>{candidate.name}{candidate.locked ? <Lock size={9} className="room-locked-mark" /> : null}</strong>
              <small>{candidate.global ? "Every Alley community" : candidate.lastMessage || candidate.groupId || "No messages yet"}</small>
            </span>
          </button>
        ))}
      </aside>

      <section className="conversation">
        <header className="conversation-header">
          <RoomLogo
            large
            url={roomLogo}
            name={room?.name || selectedRoom?.name || cfg.alleyCommunityName}
            global={isGlobal}
          />
          <div>
            <h2>{room?.name || selectedRoom?.name || cfg.alleyCommunityName || "Team chat"}</h2>
            <span><Users size={13} />{isGlobal ? "Open to every Alley community" : `${selectedRoom?.memberCount || "Community"} team members${room?.groupId ? ` | ${room.groupId}` : ""}`}</span>
          </div>
          {locked && <span className="pill amber"><Lock size={11} /> LOCKED</span>}
          <span className="peer-status right"><span className="service-dot online" />Peer sharing active</span>
          {canLock && (
            <button className="icon-button" title={locked ? "Unlock this room" : "Lock this room (members cannot post)"} onClick={toggleLock}>
              {locked ? <LockOpen size={16} /> : <Lock size={16} />}
            </button>
          )}
          <button className="icon-button" title="Refresh messages" onClick={() => loadMessages()} disabled={loading}>
            <RefreshCw size={16} className={loading ? "spin" : ""} />
          </button>
        </header>

        <div className="message-feed" ref={feedRef}>
          {messages.length === 0 && !loading && (
            <div className="chat-empty"><MessageCircle size={28} /><strong>Start the team conversation</strong><span>This room belongs to the whole community, whether or not a booth has been uploaded.</span></div>
          )}
          {messages.map((message, index) => {
            const own = String(message.authorId) === ownId;
            const previous = messages[index - 1];
            const grouped = previous?.authorId === message.authorId
              && Date.parse(message.createdAt) - Date.parse(previous.createdAt) < 5 * 60 * 1000;
            const avatarUrl = message.authorAvatarUrl || memberAvatars.get(String(message.authorId)) || "";
            const deletable = own || canModerate;
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
                    <Attachment key={attachment.id} attachment={attachment} transfer={transfers[attachment.id]} communityId={selectedId} own={String(attachment.authorId) === ownId} />
                  ))}
                </div>
                {deletable && (
                  <button
                    className="message-delete"
                    title="Hold Shift and click to delete"
                    onClick={(clickEvent) => {
                      if (!clickEvent.shiftKey) {
                        flashHint("Hold Shift and click the trash icon to delete a message.");
                        return;
                      }
                      removeMessage(message);
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {(error || hint) && <div className="chat-error">{error || hint}</div>}
        {locked && (
          <div className="chat-locked-banner">
            <Lock size={14} />
            <span>{composerBlocked
              ? "This room is locked. Only the community leadership and Alley staff can post right now."
              : "This room is locked for regular members. You can still post."}</span>
          </div>
        )}
        <div className="message-composer-wrap">
          {pendingFiles.length > 0 && (
            <div className="pending-files">
              {pendingFiles.map((item) => <span key={item.id}>{iconFor(item.kind)}<strong>{item.name}</strong><small>{api.formatBytes(item.size)}</small><button title="Remove attachment" onClick={() => setPendingFiles((current) => current.filter((entry) => entry.id !== item.id))}><X size={12} /></button></span>)}
            </div>
          )}
          <div className="message-composer">
            {mention && mentionCandidates.length > 0 && (
              <div className="mention-popup">
                {mentionCandidates.map((member, index) => (
                  <button
                    key={member.id}
                    className={index === mentionIndex ? "active" : ""}
                    onMouseDown={(mouseEvent) => { mouseEvent.preventDefault(); insertMention(member); }}
                    onMouseEnter={() => setMentionIndex(index)}
                  >
                    {member.avatarUrl
                      ? <img className="mention-avatar img" src={member.avatarUrl} alt="" />
                      : <span className="mention-avatar">{(member.name || "?")[0]?.toUpperCase()}</span>}
                    <strong>{member.name}</strong>
                    <small>{member.role}</small>
                  </button>
                ))}
              </div>
            )}
            <button className="icon-button" title="Attach local files" onClick={pickFiles} disabled={pendingFiles.length >= 5 || composerBlocked}><Paperclip size={17} /></button>
            {canShareFolders && (
              <button className="icon-button" title="Share a whole folder from this computer" onClick={pickFolderShare} disabled={pendingFiles.length >= 5 || composerBlocked}><FolderOpen size={17} /></button>
            )}
            <textarea
              ref={inputRef}
              maxLength={1200}
              rows={1}
              disabled={composerBlocked}
              placeholder={composerBlocked ? "This room is locked" : `Message ${room?.name || selectedRoom?.name || "your team"}`}
              value={text}
              onChange={(changeEvent) => {
                setText(changeEvent.target.value);
                updateMention(changeEvent.target.value, changeEvent.target.selectionStart ?? changeEvent.target.value.length);
              }}
              onKeyDown={(keyboardEvent) => {
                if (mention && mentionCandidates.length) {
                  if (keyboardEvent.key === "ArrowDown") {
                    keyboardEvent.preventDefault();
                    setMentionIndex((current) => (current + 1) % mentionCandidates.length);
                    return;
                  }
                  if (keyboardEvent.key === "ArrowUp") {
                    keyboardEvent.preventDefault();
                    setMentionIndex((current) => (current - 1 + mentionCandidates.length) % mentionCandidates.length);
                    return;
                  }
                  if (keyboardEvent.key === "Enter" || keyboardEvent.key === "Tab") {
                    keyboardEvent.preventDefault();
                    insertMention(mentionCandidates[mentionIndex] || mentionCandidates[0]);
                    return;
                  }
                  if (keyboardEvent.key === "Escape") {
                    setMention(null);
                    return;
                  }
                }
                if (keyboardEvent.key === "Enter" && !keyboardEvent.shiftKey) {
                  keyboardEvent.preventDefault();
                  send();
                }
              }}
            />
            <span>{text.length}/1200</span>
            <button className="primary icon-button" title="Send message" disabled={(!text.trim() && !pendingFiles.length) || sending || composerBlocked} onClick={send}><Send size={17} /></button>
          </div>
        </div>
      </section>
    </div>
  );
}

/** Room logo that falls back to the community initial when the image is
 * missing or fails to load (offline service, rate limit, deleted logo). */
function RoomLogo({ url, name, global, large }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  const sizeClass = `room-mark${large ? " large" : ""}`;
  if (global) return <span className={`${sizeClass} global`}><Globe size={large ? 18 : 13} /></span>;
  if (url && !failed) return <img className={`${sizeClass} img`} src={url} alt="" onError={() => setFailed(true)} />;
  return <span className={sizeClass}>{(name || "?")[0]?.toUpperCase()}</span>;
}

function MessageAvatar({ url, name }) {
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

function Attachment({ attachment, transfer, communityId, own }) {
  const request = () => peerFiles.request(attachment, communityId);
  const pending = ["requesting", "connecting", "transferring"].includes(transfer?.status);
  const ready = transfer?.status === "ready" && transfer.localUrl;
  const failed = transfer?.status === "error";
  // Own files never depend on the server availability flag: they either
  // resolve from disk or the local copy itself is gone.
  const missing = !ready && !pending && (own
    ? transfer?.status === "unavailable"
    : (!attachment.available || transfer?.status === "unavailable"));

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

function iconFor(kind) {
  if (kind === "image") return <Image size={13} />;
  if (kind === "video") return <Video size={13} />;
  if (kind === "audio") return <Music size={13} />;
  if (kind === "folder") return <Folder size={13} />;
  return <File size={13} />;
}

/* ---------- shared folders ---------- */

const RISKY_FILE_PATTERN = /\.(exe|msi|bat|cmd|ps1|psm1|vbs|vbe|js|jse|jar|scr|com|dll|apk|reg|lnk|hta|wsf|wsh|gadget)$/i;

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
    <div className="modal-scrim" onClick={onClose}>
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
    </div>
  );
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isPinged(body, selfName) {
  if (!body || !selfName) return false;
  return new RegExp(`@${escapeRegExp(selfName)}(?![\\w])`, "i").test(body);
}

/** Highlights @mentions of known members inside a message body. */
function renderBody(body, members, selfName) {
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