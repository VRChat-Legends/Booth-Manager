import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Download,
  File,
  Image,
  LoaderCircle,
  MessageCircle,
  Paperclip,
  Play,
  RefreshCw,
  Send,
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
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const feedRef = useRef(null);
  const inputRef = useRef(null);
  const initialLoad = useRef(true);
  const ownId = String(cfg.alleyDiscordId || "");

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
      setMessages(next);
      setRoom(result.data?.community || null);
      setError("");
      peerFiles.setCommunity(selectedId);
      peerFiles.watchAttachments(next.flatMap((message) => message.attachments || []));
    } else {
      setError(result.error || "Team chat is unavailable.");
    }
    setLoading(false);
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      setRoom(null);
      setMembers([]);
      return undefined;
    }
    initialLoad.current = true;
    loadMessages();
    const timer = window.setInterval(() => loadMessages(true), 3000);
    api.alley(`/api/chat/members?communityId=${encodeURIComponent(selectedId)}`).then((result) => {
      setMembers(result.status === 200 ? result.data?.members || [] : []);
    });
    return () => window.clearInterval(timer);
  }, [selectedId, loadMessages]);

  useEffect(() => {
    const feed = feedRef.current;
    if (!feed) return;
    if (initialLoad.current || feed.scrollHeight - feed.scrollTop - feed.clientHeight < 160) {
      feed.scrollTop = feed.scrollHeight;
      initialLoad.current = false;
    }
  }, [messages]);

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
    setSending(true);
    const result = await api.alley("/api/chat/messages", {
      method: "POST",
      json: {
        communityId: selectedId,
        body,
        attachments: pendingFiles.map(({ id, name, size, mime }) => ({ id, name, size, mime }))
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

  const selectedRoom = (rooms || []).find((candidate) => candidate.communityId === selectedId);
  const roomLogo = room?.logoUrl || selectedRoom?.logoUrl || cfg.alleyLogoUrl || "";
  const selfName = String(cfg.alleyUsername || "");

  return (
    <div className={`chat-layout page${cfg.alleyStaff ? " staff-chat" : ""}`}>
      {cfg.alleyStaff && (
        <aside className="chat-rooms">
          <div className="panel-title"><span>Community rooms</span><small>{rooms?.length || 0}</small></div>
          {!rooms && <div className="skeleton" style={{ height: 180 }} />}
          {(rooms || []).map((candidate) => (
            <button key={candidate.communityId} className={`chat-room${selectedId === candidate.communityId ? " active" : ""}`} onClick={() => setSelectedId(candidate.communityId)}>
              {candidate.logoUrl
                ? <img className="room-mark img" src={candidate.logoUrl} alt="" />
                : <span className="room-mark">{(candidate.name || "?")[0]?.toUpperCase()}</span>}
              <span><strong>{candidate.name}</strong><small>{candidate.lastMessage || candidate.groupId || "No messages yet"}</small></span>
            </button>
          ))}
        </aside>
      )}

      <section className="conversation">
        <header className="conversation-header">
          {roomLogo
            ? <img className="room-mark large img" src={roomLogo} alt="" />
            : <div className="room-mark large">{(room?.name || selectedRoom?.name || cfg.alleyCommunityName || "?")[0]?.toUpperCase()}</div>}
          <div>
            <h2>{room?.name || selectedRoom?.name || cfg.alleyCommunityName || "Team chat"}</h2>
            <span><Users size={13} />{selectedRoom?.memberCount || "Community"} team members{room?.groupId ? ` | ${room.groupId}` : ""}</span>
          </div>
          <span className="peer-status right"><span className="service-dot online" />Peer sharing active</span>
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
            return (
              <div key={message.id} className={`message${own ? " own" : ""}${grouped ? " grouped" : ""}`}>
                {!grouped && (message.authorAvatarUrl
                  ? <img src={message.authorAvatarUrl} alt="" />
                  : <div className="message-avatar">{(message.authorName || "?")[0]?.toUpperCase()}</div>)}
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
              </div>
            );
          })}
        </div>

        {error && <div className="chat-error">{error}</div>}
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
                    <span className="mention-avatar">{(member.name || "?")[0]?.toUpperCase()}</span>
                    <strong>{member.name}</strong>
                    <small>{member.role}</small>
                  </button>
                ))}
              </div>
            )}
            <button className="icon-button" title="Attach local files" onClick={pickFiles} disabled={pendingFiles.length >= 5}><Paperclip size={17} /></button>
            <textarea
              ref={inputRef}
              maxLength={1200}
              rows={1}
              placeholder={`Message ${room?.name || selectedRoom?.name || "your team"}`}
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
            <button className="primary icon-button" title="Send message" disabled={(!text.trim() && !pendingFiles.length) || sending} onClick={send}><Send size={17} /></button>
          </div>
        </div>
      </section>
    </div>
  );
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

  if (attachment.kind === "image" && ready) {
    return <div className="attachment-media"><img src={transfer.localUrl} alt={attachment.name} /><AttachmentCaption attachment={attachment} transfer={transfer} own={own} /></div>;
  }

  if (attachment.kind === "video" && ready) {
    return <div className="attachment-media"><video src={transfer.localUrl} controls preload="metadata" /><AttachmentCaption attachment={attachment} transfer={transfer} own={own} /></div>;
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
      <span className="attachment-file-icon">{attachment.kind === "video" ? <Video size={19} /> : attachment.kind === "image" ? <Image size={19} /> : <File size={19} />}</span>
      <div className="grow"><strong>{attachment.name}</strong><span>{api.formatBytes(attachment.size)} | served from the uploader's computer</span>{failed && <small>{transfer.error}</small>}</div>
      {pending && <div className="transfer-progress"><LoaderCircle size={15} className="spin" /><span>{Math.round((transfer.progress || 0) * 100)}%</span></div>}
      {!pending && !ready && <button className="small" onClick={request}>{attachment.kind === "video" ? <Play size={14} /> : <Download size={14} />}Load from peer</button>}
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
  return <File size={13} />;
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