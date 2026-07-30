import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FolderOpen,
  Globe,
  Lock,
  LockOpen,
  MessageCircle,
  Paperclip,
  RefreshCw,
  Send,
  ShieldCheck,
  Users,
  X
} from "lucide-react";
import * as api from "../lib/api.js";
import * as audio from "../lib/audio.js";
import peerFiles from "../lib/peerFiles.js";
import { MessageList, iconFor, isPinged } from "../components/chatThread.jsx";
import { DropOverlay, useFileDrop } from "../components/dropZone.jsx";

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
    setPendingFiles([]); // picked files never follow you across rooms (the lounge rejects them)
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
    // The lounge never brokers peer transfers, so skip the automatic image
    // requests there; other rooms preview images while the uploader is online.
    if (selectedId === "global") return;
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

  const addDroppedPaths = useCallback(async (paths) => {
    const result = await api.addSharedPaths(paths);
    const added = [
      ...(result.files || []),
      // folder drops arrive pre-flattened, same shape pickFolderShare builds
      ...(canShareFolders ? result.folders || [] : [])
    ];
    if (!canShareFolders && result.folders?.length) {
      setError("Only community owners, managers, and staff can share folders.");
    }
    if (added.length) setPendingFiles((current) => [...current, ...added].slice(0, 5));
    if (result.rejected?.length) setError(result.rejected.map((item) => `${item.name}: ${item.error}`).join(" "));
  }, [canShareFolders]);

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
  const drop = useFileDrop({
    disabled: isGlobal || composerBlocked || pendingFiles.length >= 5,
    onPaths: addDroppedPaths
  });

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

      <section className="conversation drop-zone" {...drop.bind}>
        <DropOverlay active={drop.dragOver} label={`Drop to attach in ${room?.name || selectedRoom?.name || "this room"}`} />
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
          <MessageList
            messages={messages}
            ownId={ownId}
            selfName={selfName}
            members={members}
            memberAvatars={memberAvatars}
            transfers={transfers}
            roomId={selectedId}
            peerDisabled={isGlobal}
            canDelete={(message) => String(message.authorId) === ownId || canModerate}
            onDelete={removeMessage}
            onHint={flashHint}
          />
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
            {!isGlobal && (
              <button className="icon-button" title="Attach local files" onClick={pickFiles} disabled={pendingFiles.length >= 5 || composerBlocked}><Paperclip size={17} /></button>
            )}
            {!isGlobal && canShareFolders && (
              <button className="icon-button" title="Share a whole folder from this computer" onClick={pickFolderShare} disabled={pendingFiles.length >= 5 || composerBlocked}><FolderOpen size={17} /></button>
            )}
            {isGlobal && (
              <span className="composer-note" title="Peer-to-peer file sharing exposes your IP address to the person on the other end. The lounge is open to every community, so transfers are text only here.">
                <ShieldCheck size={13} /> Text only
              </span>
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