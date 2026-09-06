import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown, AtSign, BellOff, Check, ChevronRight, ExternalLink, Files, Globe,
  Lock, LockOpen, MessageCircle, PanelBottomClose, RefreshCw, Search,
  Settings2, ShieldCheck, Star, Users, X
} from "lucide-react";
import * as api from "../lib/api.js";
import * as audio from "../lib/audio.js";
import peerFiles from "../lib/peerFiles.js";
import { Attachment, MessageAvatar, MessageList } from "../components/chatThread.jsx";
import { DropOverlay, useFileDrop } from "../components/dropZone.jsx";
import ChatSettingsPanel from "../components/ChatSettingsPanel.jsx";
import ChatComposer from "../components/ChatComposer.jsx";
import ModalPortal, { usePortalDocument } from "../components/ModalPortal.jsx";
import { copyMarkdownText } from "../lib/markdownSupport.mjs";
import { chatProfileKey, notificationText, roomPreferences, shouldNotifyMessage, shouldSendOnKey } from "../lib/chatPreferences.mjs";
import { filterMessages, formatChatTime, quoteMessage } from "../lib/chatMessages.mjs";
import useChatPreferences from "../lib/useChatPreferences.js";
import useChatFeed, { useChatRooms } from "../lib/useChatFeed.js";
import "../chat-workspace.css";

export default function TeamChatPage(props) {
  return <ChatWorkspace key={`${chatProfileKey(props.cfg)}:${props.cfg.alleyToken || ""}`} {...props} />;
}

function ChatWorkspace({ cfg, refreshConfig, detached = false, onPopOut, onDock, windowError }) {
  const settings = useChatPreferences(cfg, refreshConfig);
  const { profile } = settings;
  const directory = useChatRooms(cfg.alleyCommunityId);
  const [selectedId, setSelectedId] = useState(String(cfg.alleyCommunityId || ""));
  const [roomQuery, setRoomQuery] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [inspector, setInspector] = useState("");
  const [drafts, setDrafts] = useState({});
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const changeDraft = useCallback((id, text) => { if (live.current) setDrafts((current) => ({ ...current, [id]: text })); }, []);
  const sentDraft = useCallback((id, submitted) => {
    if (live.current) setDrafts((current) => current[id] === submitted ? { ...current, [id]: "" } : current);
  }, []);

  useEffect(() => {
    if (directory.rooms === null) return;
    setSelectedId((id) => directory.rooms.some((room) => room.communityId === id) ? id
      : directory.rooms.find((room) => room.communityId === String(cfg.alleyCommunityId))?.communityId || directory.rooms[0]?.communityId || "");
  }, [directory.rooms, cfg.alleyCommunityId]);

  const rooms = useMemo(() => (directory.rooms || []).filter((room) => {
    const matches = `${room.name || ""} ${room.groupId || ""}`.toLocaleLowerCase().includes(roomQuery.trim().toLocaleLowerCase());
    return matches && (!favoritesOnly || roomPreferences(profile, room.communityId).favorite);
  }).sort((a, b) => Number(roomPreferences(profile, b.communityId).favorite) - Number(roomPreferences(profile, a.communityId).favorite)
    || Number(b.communityId === String(cfg.alleyCommunityId)) - Number(a.communityId === String(cfg.alleyCommunityId))
    || String(a.name || "").localeCompare(String(b.name || ""))), [directory.rooms, profile, roomQuery, favoritesOnly, cfg.alleyCommunityId]);
  const selectedRoom = directory.rooms?.find((room) => room.communityId === selectedId);
  const toggleInspector = (name) => setInspector((current) => current === name ? "" : name);

  return (
    <div className={`chat-workspace page${inspector ? " has-inspector" : ""}`} data-density={profile.preferences.density} data-font-size={profile.preferences.fontSize}>
      <header className="chat-workspace-heading">
        <div><span className="eyebrow">COMMUNITY WORKSPACE</span><h1>Team chat</h1><p>Keep the conversation, files, and people in one place.</p></div>
        <div className="chat-workspace-window-actions">
          <button type="button" className={inspector === "settings" ? "selected" : ""} onClick={() => toggleInspector("settings")} disabled={!selectedRoom} aria-label="Chat settings" aria-pressed={inspector === "settings"} aria-controls={inspector ? "chat-inspector" : undefined}><Settings2 size={16} />Chat settings</button>
          {detached ? <button type="button" onClick={onDock} aria-label="Dock chat"><PanelBottomClose size={16} />Dock chat</button>
            : onPopOut && <button type="button" onClick={onPopOut} aria-label="Pop out chat"><ExternalLink size={16} />Pop out</button>}
        </div>
      </header>
      {windowError && <div className="chat-inline-error" role="alert">{windowError}</div>}
      <div className="chat-shell">
        <aside className="chat-room-rail" aria-label="Chat rooms">
          <div className="chat-rail-heading"><strong>Your rooms</strong><span>{directory.rooms?.length ?? "..."}</span><button className="icon-button small" type="button" aria-label="Refresh rooms" title="Refresh rooms" onClick={directory.refresh} disabled={directory.loading}><RefreshCw size={13} className={directory.loading ? "spin" : ""} /></button></div>
          <label className="chat-search chat-room-search"><Search size={14} /><input type="search" aria-label="Search rooms" placeholder="Find a room..." value={roomQuery} onChange={(event) => setRoomQuery(event.target.value)} /></label>
          <div className="chat-room-filters" role="group" aria-label="Room list filter"><button type="button" aria-pressed={!favoritesOnly} onClick={() => setFavoritesOnly(false)}>All rooms</button><button type="button" aria-pressed={favoritesOnly} onClick={() => setFavoritesOnly(true)}><Star size={12} />Favorites</button></div>
          {directory.error && <div className="chat-inline-error" role="alert">{directory.error}<button type="button" className="small" onClick={directory.refresh}>Retry</button></div>}
          <nav className="chat-room-list" aria-label="Choose a room">
            {directory.loading && <div className="chat-list-placeholder" role="status">Loading rooms...</div>}
            {rooms.map((candidate) => {
              const pref = roomPreferences(profile, candidate.communityId);
              const draft = drafts[candidate.communityId]?.trim();
              return <button type="button" key={candidate.communityId} className={`chat-room-entry${selectedId === candidate.communityId ? " active" : ""}`} aria-current={selectedId === candidate.communityId ? "page" : undefined} aria-label={`Open ${candidate.name || "room"}`} onClick={() => setSelectedId(candidate.communityId)}>
                <RoomLogo url={candidate.logoUrl} name={candidate.name} global={candidate.global || candidate.communityId === "global"} />
                <span className="chat-room-text"><strong>{candidate.name || "Unnamed room"}</strong><small className={draft ? "has-draft" : ""}>{draft ? "Draft saved for this session" : candidate.global ? "Every Alley community" : typeof candidate.lastMessage === "string" ? candidate.lastMessage : "Community conversation"}</small></span>
                <span className="chat-room-marks">{pref.favorite && <Star size={11} aria-label="Favorite room" />}{pref.notifications === "muted" && <BellOff size={11} aria-label="Muted room" />}{candidate.locked && <Lock size={11} aria-label="Locked room" />}</span>
              </button>;
            })}
            {!directory.loading && !rooms.length && <div className="chat-list-placeholder">{favoritesOnly ? "No favorite rooms yet. Star a room to keep it here." : roomQuery ? "No matching rooms." : directory.error ? "Room list unavailable." : "No rooms are available for this account."}</div>}
          </nav>
          <div className="chat-rail-footer"><ShieldCheck size={15} /><span>Preferences are personal.<small>Drafts stay separate while this tab is open.</small></span></div>
        </aside>
        {selectedRoom ? <RoomConversation key={selectedId} cfg={cfg} selectedRoom={selectedRoom} settings={settings} inspector={inspector} onInspector={toggleInspector} onCloseInspector={() => setInspector("")} draftText={drafts[selectedId] || ""} onDraft={changeDraft} onSent={sentDraft} onRoomsRefresh={directory.refresh} />
          : <section className="chat-no-room"><MessageCircle size={34} /><h2>{directory.loading ? "Opening your workspace" : "Choose a room to get started"}</h2><p>{directory.error ? "Retry loading your rooms to reconnect." : "Your community conversations will appear here."}</p></section>}
      </div>
    </div>
  );
}

function RoomConversation({ cfg, selectedRoom, settings, inspector, onInspector, onCloseInspector, draftText, onDraft, onSent, onRoomsRefresh }) {
  const ownerDocument = usePortalDocument();
  const roomId = selectedRoom.communityId;
  const ownId = String(cfg.alleyDiscordId || "");
  const selfName = String(cfg.alleyUsername || "");
  const prefs = settings.profile.preferences;
  const roomPrefs = roomPreferences(settings.profile, roomId);
  const isGlobal = roomId === "global";
  const canModerate = cfg.alleyStaff === true || (roomId === String(cfg.alleyCommunityId) && ["owner", "manager"].includes(cfg.alleyRole));
  const canShareFolders = cfg.alleyStaff === true || ["owner", "manager"].includes(cfg.alleyRole);
  const text = draftText;
  const [pendingFiles, setPendingFiles] = useState([]);
  const [transfers, setTransfers] = useState({});
  const [mention, setMention] = useState(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [newCount, setNewCount] = useState(0);
  const [error, setError] = useState("");
  const [hint, setHint] = useState("");
  const [sending, setSending] = useState(false);
  const [picking, setPicking] = useState(false);
  const [confirmation, setConfirmation] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState("");
  const [lockOverride, setLockOverride] = useState(null);
  const [memberQuery, setMemberQuery] = useState("");
  const inputRef = useRef(null);
  const searchRef = useRef(null);
  const feedRef = useRef(null);
  const nearBottom = useRef(true);
  const initialLoad = useRef(true);
  const forceScroll = useRef(false);
  const sendingRef = useRef(false);
  const pickingRef = useRef(false);
  const live = useRef(true);
  const hintTimer = useRef(0);
  const lastSend = useRef(0);

  useEffect(() => { live.current = true; return () => { live.current = false; window.clearTimeout(hintTimer.current); }; }, []);
  useEffect(() => peerFiles.subscribe(setTransfers), []);

  const onIncoming = (incoming) => {
    if (!live.current) return;
    const remote = incoming.filter((message) => String(message.authorId) !== ownId && message.authorRole !== "system");
    if (!nearBottom.current || !prefs.autoScroll || query || filter !== "all") setNewCount((count) => count + remote.length);
    const notification = remote.findLast((message) => shouldNotifyMessage(message, { preferences: prefs, room: roomPrefs, ownId, selfName }));
    if (!notification) return;
    if (prefs.notificationSound && cfg.pingSoundEnabled !== false) audio.ping();
    if (prefs.desktopNotifications && cfg.nativeNotificationsEnabled !== false && (ownerDocument.hidden || !ownerDocument.hasFocus())) {
      Promise.resolve(api.notifyNative({ title: `Team chat: ${selectedRoom.name || "Community"}`, body: notificationText(notification, prefs.notificationPreview), silent: true })).catch(() => {});
    }
  };
  const feed = useChatFeed(roomId, onIncoming);
  const roomName = feed.room?.name || selectedRoom.name || "Team chat";
  const serverLocked = feed.room ? feed.room.locked === true : selectedRoom.locked === true;
  const locked = lockOverride ?? serverLocked;
  const blocked = !feed.hasLoaded || (locked && !canModerate);
  useEffect(() => { if (lockOverride !== null && lockOverride === serverLocked) setLockOverride(null); }, [lockOverride, serverLocked]);

  const visibleMessages = useMemo(() => filterMessages(feed.messages, { query, filter, selfName, ownId }), [feed.messages, query, filter, selfName, ownId]);
  const counts = useMemo(() => Object.fromEntries(["all", "mentions", "files", "mine"].map((key) => [key, filterMessages(feed.messages, { filter: key, ownId, selfName }).length])), [feed.messages, ownId, selfName]);
  const attachments = useMemo(() => feed.messages.flatMap((message) => message.attachments.map((attachment) => ({ message, attachment }))).reverse(), [feed.messages]);
  const memberAvatars = useMemo(() => new Map(feed.members.filter((member) => member.avatarUrl).map((member) => [String(member.id), member.avatarUrl])), [feed.members]);
  const members = useMemo(() => feed.members.filter((member) => String(member.name || "").toLocaleLowerCase().includes(memberQuery.toLocaleLowerCase())).sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""))), [feed.members, memberQuery]);
  const mentionCandidates = mention ? feed.members.filter((member) => typeof member.name === "string" && member.name.toLocaleLowerCase().startsWith(mention.query.toLocaleLowerCase())).slice(0, 6) : [];
  const notificationMode = roomPrefs.notifications === "inherit" ? prefs.notificationMode : roomPrefs.notifications;

  const scrollBottom = useCallback(() => {
    const node = feedRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: "instant" });
    nearBottom.current = true;
    setNewCount(0);
  }, []);
  useLayoutEffect(() => {
    if (!feed.hasLoaded || query || filter !== "all") return;
    if (initialLoad.current || forceScroll.current || (prefs.autoScroll && nearBottom.current)) scrollBottom();
    initialLoad.current = false;
    forceScroll.current = false;
  }, [feed.messages, feed.hasLoaded, prefs.autoScroll, query, filter, scrollBottom]);
  const jumpToLatest = () => { setQuery(""); setFilter("all"); forceScroll.current = true; scrollBottom(); };

  useEffect(() => {
    if (!isGlobal && prefs.showMediaPreviews) {
      for (const message of feed.messages) {
        for (const attachment of message.attachments) {
          if (transfers[attachment.id]) continue;
          const own = String(attachment.authorId) === ownId;
          if (own || (prefs.autoLoadImages && attachment.kind === "image" && attachment.available)) peerFiles.request(attachment, roomId).catch(() => {});
        }
      }
    }
  }, [feed.messages, transfers, ownId, roomId, isGlobal, prefs.showMediaPreviews, prefs.autoLoadImages]);

  const changeText = (value) => onDraft(roomId, value);
  const flashHint = (value) => {
    if (!live.current) return;
    setHint(value);
    window.clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => setHint(""), 4000);
  };
  const addFiles = (result, foldersAllowed) => {
    if (!live.current || !result) return;
    const added = [...(result.files || []), ...(foldersAllowed ? result.folders || [] : [])];
    if (result.ok && result.folder && foldersAllowed) added.push({ ...result.folder, entries: result.entries });
    setPendingFiles((current) => [...new Map([...current, ...added].map((file) => [file.id, file])).values()].slice(0, 5));
    if (!foldersAllowed && result.folders?.length) setError("Only community owners, managers, and staff can share folders.");
    else if (result.rejected?.length) setError(result.rejected.map((item) => `${item.name}: ${item.error}`).join(" "));
    else if (!result.ok && !result.canceled && result.error) setError(result.error);
    else if (pendingFiles.length + added.length > 5) flashHint("Only the first five attachments fit in one message.");
  };
  const chooseFiles = async (kind, paths) => {
    if (isGlobal || blocked || sendingRef.current || pickingRef.current || pendingFiles.length >= 5) return;
    pickingRef.current = true;
    setPicking(true);
    try {
      const result = paths ? await api.addSharedPaths(paths) : kind === "folder" ? await api.openSharedFolder() : await api.openSharedFiles();
      addFiles(result, canShareFolders);
    } catch (failure) { if (live.current) setError(failure.message || "Could not attach these files."); }
    finally { pickingRef.current = false; if (live.current) setPicking(false); }
  };
  const drop = useFileDrop({ disabled: isGlobal || blocked || sending || picking || pendingFiles.length >= 5, onPaths: (paths) => chooseFiles("file", paths) });

  const updateMention = (value, caret) => {
    const match = /(^|\s)@([^\n@]{0,64})$/u.exec(value.slice(0, caret));
    setMention(match && feed.members.length ? { query: match[2], start: caret - match[2].length - 1, end: caret } : null);
    setMentionIndex(0);
  };
  const insertMention = (member, fromPopup = false) => {
    if (blocked || sending || typeof member.name !== "string") return;
    const start = fromPopup && mention ? mention.start : text.length;
    const end = fromPopup && mention ? mention.end : text.length;
    const prefix = start === text.length && text && !/\s$/.test(text) ? " " : "";
    const value = `${text.slice(0, start)}${prefix}@${member.name} ${text.slice(end)}`;
    if (value.length > 1200) { flashHint("There is not enough room to insert this mention."); return; }
    changeText(value);
    setMention(null);
    inputRef.current?.ownerDocument.defaultView.requestAnimationFrame(() => {
      if (!live.current) return;
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(start + prefix.length + member.name.length + 2, start + prefix.length + member.name.length + 2);
    });
  };

  const send = async () => {
    const body = text.trim();
    if (blocked || sendingRef.current || pickingRef.current || (!body && !pendingFiles.length) || body.length > 1200 || Date.now() - lastSend.current < 800) return;
    sendingRef.current = true;
    lastSend.current = Date.now();
    setSending(true);
    setMention(null);
    setError("");
    try {
      const result = await api.alley("/api/chat/messages", { method: "POST", json: {
        communityId: roomId, body,
        attachments: isGlobal ? [] : pendingFiles.map(({ id, name, size, mime, entries }) => entries
          ? { id, name, size, mime, entries: entries.map((entry) => ({ id: entry.id, relPath: entry.relPath, size: entry.size, mime: entry.mime })) }
          : { id, name, size, mime })
      } });
      if (result?.status !== 201) throw new Error(result?.error || "Message was not sent. Your draft and attachments have been kept.");
      onSent(roomId, text);
      if (!live.current) return;
      setPendingFiles([]);
      forceScroll.current = true;
      setQuery("");
      setFilter("all");
      if (result.data?.message) feed.append(result.data.message);
      else feed.refresh();
      if (prefs.sendSound && cfg.sfxEnabled !== false) audio.success();
      inputRef.current?.ownerDocument.defaultView.requestAnimationFrame(() => live.current && inputRef.current?.focus());
    } catch (failure) { if (live.current) setError(failure.message || "Message was not sent."); }
    finally { sendingRef.current = false; if (live.current) setSending(false); }
  };

  const copyMessage = async (message) => {
    try {
      const copied = await copyMarkdownText(inputRef.current, message.body || message.attachments.map((item) => item.name).join("\n"));
      if (!copied) throw new Error("Clipboard unavailable");
      flashHint("Message copied.");
    }
    catch { flashHint("The clipboard is unavailable. Select and copy the message text instead."); }
  };
  const quote = (message) => {
    if (blocked || sending) return;
    const value = `${text ? `${text}\n\n` : ""}${quoteMessage(message)}\n`;
    if (value.length > 1200) { flashHint("Your draft is too long to add this quote."); return; }
    changeText(value);
    setMention(null);
    inputRef.current?.focus();
  };
  const requestDelete = (message) => {
    if (!(canModerate || (ownId && String(message.authorId) === ownId))) return;
    setConfirmError(""); setConfirmation({ type: "delete", message });
  };
  const confirm = async () => {
    if (!confirmation || confirmBusy) return;
    setConfirmBusy(true); setConfirmError("");
    try {
      if (confirmation.type === "delete") {
        const result = await api.alley(`/api/chat/messages/${encodeURIComponent(confirmation.message.id)}?communityId=${encodeURIComponent(roomId)}`, { method: "DELETE" });
        if (!live.current) return;
        if (result?.status !== 200) throw new Error(result?.error || "Could not delete the message.");
        feed.remove(confirmation.message.id);
        flashHint("Message deleted.");
      } else {
        if (!canModerate) return;
        const result = await api.alley("/api/chat/lock", { method: "POST", json: { communityId: roomId, locked: confirmation.locked } });
        if (!live.current) return;
        if (result?.status !== 200) throw new Error(result?.error || "Could not change the room lock.");
        setLockOverride(confirmation.locked);
        feed.refresh(); onRoomsRefresh();
      }
      setConfirmation(null);
    } catch (failure) { if (live.current) setConfirmError(failure.message || "This action failed."); }
    finally { if (live.current) setConfirmBusy(false); }
  };

  const inspectorTitle = inspector === "settings" ? "Personal settings" : inspector === "members" ? "Room members" : "Shared files";
  return <>
    <section className="conversation chat-conversation drop-zone" aria-label={`${roomName} conversation`} {...drop.bind} onKeyDown={(event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") { event.preventDefault(); searchRef.current?.focus(); }
    }}>
      <DropOverlay active={drop.dragOver} label={`Drop to attach in ${roomName}`} />
      <header className="conversation-header">
        <RoomLogo large url={feed.room?.logoUrl || selectedRoom.logoUrl} name={roomName} global={isGlobal} />
        <div className="chat-conversation-title"><h2>{roomName}</h2><span>{isGlobal ? <Globe size={12} /> : <Users size={12} />}{isGlobal ? "Every Alley community" : "Community room"}{locked && <span className="chat-lock-state"><Lock size={11} />Locked</span>}</span></div>
        <div className="chat-header-actions">
          <button className="icon-button" type="button" disabled={settings.disabled} aria-label={roomPrefs.favorite ? "Remove room from favorites" : "Favorite room"} title={roomPrefs.favorite ? "Remove room from favorites" : "Favorite room"} aria-pressed={roomPrefs.favorite} onClick={() => settings.update({ favorite: !roomPrefs.favorite }, roomId)}><Star size={16} fill={roomPrefs.favorite ? "currentColor" : "none"} /></button>
          <button className="icon-button" type="button" title="Room members" aria-label="Room members" aria-pressed={inspector === "members"} onClick={() => onInspector("members")}><Users size={16} /></button>
          <button className="icon-button" type="button" title="Shared files" aria-label="Shared files" aria-pressed={inspector === "files"} onClick={() => onInspector("files")}><Files size={16} /></button>
          {canModerate && <button type="button" className="icon-button" title={locked ? "Unlock room" : "Lock room"} aria-label={locked ? "Unlock room" : "Lock room"} disabled={!feed.hasLoaded} onClick={() => { setConfirmError(""); setConfirmation({ type: "lock", locked: !locked }); }}>{locked ? <LockOpen size={16} /> : <Lock size={16} />}</button>}
          <button type="button" className="icon-button" title="Refresh messages" aria-label="Refresh messages" disabled={feed.loading || feed.refreshing} onClick={feed.refresh}><RefreshCw size={16} className={feed.loading || feed.refreshing ? "spin" : ""} /></button>
        </div>
      </header>
      <div className="chat-message-toolbar">
        <label className="chat-search"><Search size={14} /><input ref={searchRef} type="search" aria-label="Search messages" placeholder="Search messages, people, or files" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <div className="chat-message-filters" role="group" aria-label="Message filter">{[["all", "All"], ["mentions", "Mentions"], ["files", "Files"], ["mine", "Mine"]].map(([value, label]) => <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}<span>{counts[value]}</span></button>)}</div>
      </div>
      <div className="chat-feed-status"><span className={`service-dot${feed.error ? "" : feed.hasLoaded ? " online" : ""}`} /><span>{feed.error ? feed.hasLoaded ? "Offline snapshot" : "Not connected" : feed.loading ? "Connecting..." : feed.refreshing ? "Refreshing..." : `Synced ${formatChatTime(feed.updatedAt, prefs.timeFormat)}`}</span><span className="chat-retention-label">{query || filter !== "all" ? `${visibleMessages.length} matches in ` : ""}latest {feed.messages.length} messages{feed.messages.length >= 300 ? " (300 limit)" : ""}</span><button type="button" className="chat-notification-state" title="Change chat notifications" aria-label="Change chat notifications" onClick={() => onInspector("settings")}>{notificationMode === "muted" ? <BellOff size={11} /> : <AtSign size={11} />}{notificationMode === "muted" ? "Muted" : notificationMode === "mentions" ? "Mentions" : "All activity"}</button></div>
      <div className="chat-feed-wrap">
        <div className="message-feed" ref={feedRef} role="region" aria-label="Conversation messages" tabIndex={0} onScroll={() => {
          const node = feedRef.current;
          nearBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 90;
          if (nearBottom.current && !query && filter === "all") setNewCount(0);
        }} onLoadCapture={() => { if (prefs.autoScroll && nearBottom.current && !query && filter === "all") scrollBottom(); }} onLoadedMetadataCapture={() => { if (prefs.autoScroll && nearBottom.current && !query && filter === "all") scrollBottom(); }}>
          {feed.loading && <div className="chat-empty" role="status"><RefreshCw size={24} className="spin" /><strong>Loading conversation...</strong></div>}
          {!feed.loading && !visibleMessages.length && <div className="chat-empty"><MessageCircle size={32} /><strong>{!feed.hasLoaded ? "Messages unavailable" : query || filter !== "all" ? "No matching messages" : "Make room for a conversation"}</strong><span>{!feed.hasLoaded ? "Reconnect before sending. Any draft stays here." : query || filter !== "all" ? "Search covers the latest messages loaded from this room, not deleted history." : isGlobal ? "Say hello to the Alley community. This room is text only." : "Share an update, ask a question, or get your team on the same page."}</span>{query || filter !== "all" ? <button type="button" onClick={() => { setQuery(""); setFilter("all"); }}>Clear filters</button> : null}</div>}
          <MessageList messages={visibleMessages} ownId={ownId} selfName={selfName} members={feed.members} memberAvatars={memberAvatars} transfers={transfers} roomId={roomId} peerDisabled={isGlobal} textOnly={isGlobal} preferences={prefs} searchQuery={query} canDelete={(message) => Boolean(canModerate || (ownId && String(message.authorId) === ownId))} onRequestDelete={requestDelete} onQuote={blocked || sending ? undefined : quote} onCopy={copyMessage} onHint={flashHint} />
        </div>
        {newCount > 0 && <button type="button" className="chat-jump-latest" onClick={jumpToLatest}><ArrowDown size={14} />{newCount} new {newCount === 1 ? "message" : "messages"}<span>Jump to latest</span></button>}
      </div>
      {(feed.error || error) && <div className="chat-inline-error chat-conversation-error" role="alert"><span>{error || feed.error}{!error && feed.hasLoaded ? " Showing the last successful snapshot." : ""}</span><button type="button" className="small" disabled={feed.loading || feed.refreshing} onClick={() => { setError(""); feed.refresh(); }}>Retry</button></div>}
      {hint && <div className="chat-feedback" role="status"><Check size={13} />{hint}</div>}
      {locked && <div className="chat-locked-banner"><Lock size={13} /><span>{canModerate ? "Members cannot post while this room is locked. You can still post as a moderator." : "This room is locked. Only community leadership and staff can post."}</span></div>}
      <ChatComposer inputRef={inputRef} text={text} onChange={(value, caret) => { changeText(value); updateMention(value, caret); }} onSend={send}
        pendingFiles={pendingFiles} onRemoveFile={(id) => setPendingFiles((current) => current.filter((item) => item.id !== id))}
        onAttachFiles={() => chooseFiles("file")} onAttachFolder={() => chooseFiles("folder")} canShareFolders={canShareFolders}
        isGlobal={isGlobal} blocked={blocked} sending={sending} picking={picking} roomName={roomName} hasLoaded={feed.hasLoaded}
        preferences={prefs} members={feed.members} selfName={selfName} onHint={flashHint}
        mentionSuggestions={mention && mentionCandidates.length > 0 && <div className="mention-popup" id="chat-mention-suggestions" role="listbox" aria-label="Mention suggestions">{mentionCandidates.map((member, index) => <button type="button" key={member.id} id={`chat-mention-${index}`} role="option" aria-selected={index === mentionIndex} tabIndex={-1} className={index === mentionIndex ? "active" : ""} onMouseDown={(event) => { event.preventDefault(); insertMention(member, true); }} onMouseEnter={() => setMentionIndex(index)}><MessageAvatar url={member.avatarUrl} name={member.name} /><strong>{member.name}</strong><small>{member.role}</small></button>)}</div>}
        onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (mention && mentionCandidates.length) {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setMentionIndex((index) => (index + (event.key === "ArrowDown" ? 1 : -1) + mentionCandidates.length) % mentionCandidates.length); return; }
              if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey)) { event.preventDefault(); insertMention(mentionCandidates[mentionIndex] || mentionCandidates[0], true); return; }
              if (event.key === "Escape") { setMention(null); return; }
            }
            if (shouldSendOnKey(event.nativeEvent, prefs.sendShortcut)) { event.preventDefault(); send(); }
        }} />
    </section>
    {inspector && <aside className="chat-inspector" id="chat-inspector" aria-label={inspectorTitle}>
      <header className="chat-inspector-head"><strong>{inspectorTitle}</strong><button type="button" className="icon-button" aria-label="Close chat panel" title="Close chat panel" onClick={onCloseInspector}><X size={16} /></button></header>
      <div className="chat-inspector-scroll">
        {inspector === "settings" && <ChatSettingsPanel preferences={prefs} roomPreferences={roomPrefs} roomName={roomName} isGlobal={isGlobal} disabled={settings.disabled} saving={settings.saving} saveError={settings.saveError} cfg={cfg} onChange={(patch) => settings.update(patch)} onRoomChange={(patch) => settings.update(patch, roomId)} onReset={settings.reset} />}
        {inspector === "members" && <div className="chat-members-panel"><p>People in this room. This is a member list, not an online status.</p><label className="chat-search"><Search size={14} /><input type="search" aria-label="Search members" placeholder="Find a member..." value={memberQuery} onChange={(event) => setMemberQuery(event.target.value)} /></label>{feed.membersError && <div className="chat-inline-error" role="alert">{feed.membersError}<button type="button" className="small" onClick={feed.refreshMembers}>Retry members</button></div>}<div className="chat-member-count">{members.length} members</div>{members.map((member) => <div className="chat-member-row" key={member.id}><MessageAvatar url={member.avatarUrl} name={member.name} /><span><strong>{member.name || "Unnamed member"}{String(member.id) === ownId ? " (you)" : ""}</strong><small>{member.role || "member"}</small></span><button type="button" className="icon-button small" title={`Mention ${member.name}`} aria-label={`Mention ${member.name}`} disabled={blocked || sending} onClick={() => insertMention(member)}><AtSign size={14} /></button></div>)}{!members.length && !feed.membersError && <div className="chat-list-placeholder">{memberQuery ? "No matching members." : "No member information is available."}</div>}</div>}
        {inspector === "files" && <div className="chat-files-panel"><p>Attachments from the latest {feed.messages.length} loaded messages. Files stream from the uploader, not the Alley server.</p>{isGlobal && <div className="chat-privacy-note"><ShieldCheck size={16} />Peer transfers are disabled in the global lounge.</div>}<strong className="chat-member-count">{attachments.length} attachments</strong>{attachments.map(({ message, attachment }) => <div className="chat-shared-file" key={`${message.id}:${attachment.id}`}><span>{message.authorName} / {formatChatTime(message.createdAt, prefs.timeFormat)}</span><Attachment attachment={attachment} transfer={transfers[attachment.id]} communityId={roomId} own={String(attachment.authorId) === ownId} peerDisabled={isGlobal} showMediaPreviews={false} /><button type="button" className="chat-file-source" onClick={() => { setQuery(attachment.name || ""); setFilter("files"); }}>Find in conversation<ChevronRight size={12} /></button></div>)}{!attachments.length && <div className="chat-list-placeholder">No attachments in the loaded messages.</div>}</div>}
      </div>
    </aside>}
    {confirmation && <ChatConfirmation title={confirmation.type === "delete" ? "Delete this message?" : confirmation.locked ? "Lock this room?" : "Unlock this room?"} action={confirmation.type === "delete" ? "Delete message" : confirmation.locked ? "Lock room" : "Unlock room"} busy={confirmBusy} error={confirmError} onCancel={() => !confirmBusy && setConfirmation(null)} onConfirm={confirm}><p>{confirmation.type === "delete" ? "This removes the message for everyone in the room. This cannot be undone." : confirmation.locked ? "Regular members will not be able to post. Community leadership and staff can still send messages." : "Regular members will be able to post again."}</p>{confirmation.message && <blockquote>{(confirmation.message.body || "Attachment message").slice(0, 240)}</blockquote>}</ChatConfirmation>}
  </>;
}

function ChatConfirmation({ title, action, busy, error, onCancel, onConfirm, children }) {
  const owner = usePortalDocument();
  const dialog = useRef(null);
  const cancel = useRef(null);
  useEffect(() => { const previous = owner.activeElement; cancel.current?.focus(); return () => previous?.isConnected && previous.focus?.(); }, [owner]);
  return <ModalPortal><div className="modal-scrim chat-confirm-scrim" onClick={onCancel}><div ref={dialog} className="modal chat-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="chat-confirm-title" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => {
    if (event.key === "Escape" && !busy) { event.stopPropagation(); onCancel(); }
    if (event.key === "Tab") { const items = Array.from(dialog.current.querySelectorAll("button:not(:disabled)")); const first = items[0]; const last = items.at(-1); if (!first) { event.preventDefault(); return; } if (event.shiftKey && owner.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && owner.activeElement === last) { event.preventDefault(); first.focus(); } }
  }}><h2 id="chat-confirm-title">{title}</h2>{children}{error && <div className="chat-inline-error" role="alert">{error}</div>}<div className="chat-confirm-actions"><button type="button" ref={cancel} disabled={busy} onClick={onCancel}>Cancel</button><button type="button" className="danger" disabled={busy} onClick={onConfirm}>{busy ? "Working..." : action}</button></div></div></div></ModalPortal>;
}

function RoomLogo({ url, name, global, large }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  const className = `room-mark${large ? " large" : ""}`;
  if (global) return <span className={`${className} global`}><Globe size={large ? 19 : 16} /></span>;
  if (url && !failed) return <img className={`${className} img`} src={url} alt="" onError={() => setFailed(true)} />;
  return <span className={className}>{(name || "?")[0]?.toUpperCase()}</span>;
}