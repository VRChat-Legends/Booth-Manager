// Shared support ticket UI: the thread view (used by both the user-facing
// Support page and the staff dashboard) and the new-ticket modal. Threads
// render through the same MessageList + peer attachment pipeline as chat.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bug,
  LifeBuoy,
  Lock,
  Paperclip,
  RefreshCw,
  RotateCcw,
  Send,
  X
} from "lucide-react";
import * as api from "../lib/api.js";
import * as audio from "../lib/audio.js";
import peerFiles from "../lib/peerFiles.js";
import { MessageList, iconFor } from "./chatThread.jsx";
import { DropOverlay, useFileDrop } from "./dropZone.jsx";

export function statusMeta(status, staffView = false) {
  switch (status) {
    case "open":
      return { label: staffView ? "NEW" : "OPEN", cls: "teal" };
    case "awaiting_staff":
      return { label: staffView ? "NEEDS REPLY" : "WAITING FOR STAFF", cls: "amber" };
    case "awaiting_user":
      return { label: staffView ? "WAITING ON USER" : "STAFF REPLIED", cls: "violet" };
    case "closed":
      return { label: "CLOSED", cls: "gray" };
    default:
      return { label: String(status || "?").toUpperCase(), cls: "gray" };
  }
}

export function TypePill({ type }) {
  return type === "bug"
    ? <span className="pill amber ticket-type"><Bug size={10} /> BUG</span>
    : <span className="pill gray ticket-type"><LifeBuoy size={10} /> GENERAL</span>;
}

/** Full ticket conversation: polling thread, peer attachments, composer.
 * `headerActions` lets the staff dashboard inject claim/close controls. */
export function TicketThread({ cfg, ticketId, staffView = false, onTicket, headerActions }) {
  const [ticket, setTicket] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [pendingFiles, setPendingFiles] = useState([]);
  const [transfers, setTransfers] = useState({});
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const feedRef = useRef(null);
  const initialLoad = useRef(true);
  const seenRef = useRef(new Set());
  const primedRef = useRef(false);
  const ownId = String(cfg.alleyDiscordId || "");
  const canShareFolders = cfg.alleyStaff === true || ["owner", "manager"].includes(String(cfg.alleyRole || ""));

  useEffect(() => peerFiles.subscribe(setTransfers), []);

  const load = useCallback(async () => {
    const result = await api.alley(`/api/tickets/${encodeURIComponent(ticketId)}`);
    if (result.status !== 200) {
      setError(result.error || "Could not load this ticket.");
      return;
    }
    const nextTicket = result.data?.ticket || null;
    const next = result.data?.messages || [];
    if (primedRef.current) {
      const incoming = next.find((message) => !seenRef.current.has(String(message.id)) && String(message.authorId) !== ownId);
      if (incoming) audio.ping();
    }
    for (const message of next) seenRef.current.add(String(message.id));
    primedRef.current = true;
    setTicket(nextTicket);
    setMessages(next);
    setError("");
    onTicket?.(nextTicket);
    if (nextTicket?.roomId) {
      peerFiles.setCommunity(nextTicket.roomId);
      peerFiles.watchAttachments(next.flatMap((message) => message.attachments || []), nextTicket.roomId);
    }
  }, [ticketId, ownId, onTicket]);

  useEffect(() => {
    initialLoad.current = true;
    seenRef.current = new Set();
    primedRef.current = false;
    setTicket(null);
    setMessages([]);
    setText("");
    setPendingFiles([]);
    setError("");
    load();
    const timer = window.setInterval(load, 4000);
    return () => window.clearInterval(timer);
  }, [ticketId, load]);

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

  // Auto-resolve own attachments and preview images while the peer is online.
  useEffect(() => {
    if (!ticket?.roomId) return;
    for (const message of messages) {
      for (const attachment of message.attachments || []) {
        if (transfers[attachment.id]) continue;
        const own = String(attachment.authorId) === ownId;
        if (own || (attachment.kind === "image" && attachment.available)) {
          peerFiles.request(attachment, ticket.roomId).catch(() => {});
        }
      }
    }
  }, [messages, ticket?.roomId, transfers, ownId]);

  const pickFiles = async () => {
    const result = await api.openSharedFiles();
    if (!result.ok) {
      if (result.rejected?.length) setError(result.rejected.map((item) => `${item.name}: ${item.error}`).join(" "));
      return;
    }
    setPendingFiles((current) => [...current, ...(result.files || [])].slice(0, 5));
    if (result.rejected?.length) setError(result.rejected.map((item) => `${item.name}: ${item.error}`).join(" "));
  };

  const addDroppedPaths = useCallback(async (paths) => {
    const result = await api.addSharedPaths(paths);
    if (result.folders?.length) setError("Tickets take individual files, not folders.");
    if (result.files?.length) setPendingFiles((current) => [...current, ...result.files].slice(0, 5));
    if (result.rejected?.length) setError(result.rejected.map((item) => `${item.name}: ${item.error}`).join(" "));
  }, []);

  const drop = useFileDrop({ onPaths: addDroppedPaths });

  const send = async () => {
    const body = text.trim();
    if ((!body && !pendingFiles.length) || sending || !ticket) return;
    setSending(true);
    const result = await api.alley(`/api/tickets/${encodeURIComponent(ticket.id)}/messages`, {
      method: "POST",
      json: {
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
        seenRef.current.add(String(message.id));
        setMessages((current) => current.concat(message));
        peerFiles.watchAttachments(message.attachments || [], ticket.roomId);
      }
      if (result.data?.status) {
        const updated = { ...ticket, status: result.data.status };
        setTicket(updated);
        onTicket?.(updated);
      }
      setError("");
      audio.success();
    } else {
      setError(result.error || "The reply was not sent.");
    }
  };

  const reopen = async () => {
    const result = await api.alley(`/api/tickets/${encodeURIComponent(ticketId)}/reopen`, { method: "POST" });
    if (result.status === 200) {
      audio.success();
      load();
    } else {
      setError(result.error || "Could not reopen the ticket.");
    }
  };

  if (!ticket && !error) return <div className="skeleton" style={{ height: 260 }} />;
  if (!ticket) return <div className="errbox">{error}</div>;

  const meta = statusMeta(ticket.status, staffView);
  const closed = ticket.status === "closed";

  return (
    <section className="conversation ticket-thread drop-zone" {...drop.bind}>
      <DropOverlay active={drop.dragOver} label="Drop to attach to this ticket" />
      <header className="conversation-header">
        <div className="grow">
          <h2><TypePill type={ticket.type} /> {ticket.subject}</h2>
          <span>
            Opened by {String(ticket.openerId) === ownId ? "you" : ticket.openerName}
            {ticket.communityName ? ` | ${ticket.communityName}` : ""}
            {ticket.appVersion ? ` | app v${ticket.appVersion}` : ""}
            {` | ${api.formatDate(ticket.createdAt)}`}
          </span>
        </div>
        {ticket.assignedStaffId && (
          <span className="claimed-chip" title={`Claimed ${api.timeAgo(ticket.claimedAt)}`}>
            {ticket.assignedStaffAvatarUrl
              ? <img src={ticket.assignedStaffAvatarUrl} alt="" />
              : <span className="claimed-initial">{(ticket.assignedStaffName || "?")[0]?.toUpperCase()}</span>}
            <span><small>Handled by</small><strong>{ticket.assignedStaffName}</strong></span>
          </span>
        )}
        <span className={`pill ${meta.cls}`}>{meta.label}</span>
        {headerActions}
        <button className="icon-button" title="Refresh" onClick={load}><RefreshCw size={16} /></button>
      </header>

      <div className="message-feed" ref={feedRef}>
        <MessageList
          messages={messages}
          ownId={ownId}
          selfName={String(cfg.alleyUsername || "")}
          transfers={transfers}
          roomId={ticket.roomId}
        />
      </div>

      {error && <div className="chat-error">{error}</div>}
      {closed && (
        <div className="chat-locked-banner">
          <Lock size={14} />
          <span>
            This ticket is closed.
            {staffView ? " Replying reopens it toward the user." : " Replying or reopening sends it back to the staff queue."}
          </span>
          {!staffView && String(ticket.openerId) === ownId && (
            <button className="small right" onClick={reopen}><RotateCcw size={13} />Reopen ticket</button>
          )}
        </div>
      )}
      <div className="message-composer-wrap">
        {pendingFiles.length > 0 && (
          <div className="pending-files">
            {pendingFiles.map((item) => <span key={item.id}>{iconFor(item.kind)}<strong>{item.name}</strong><small>{api.formatBytes(item.size)}</small><button title="Remove attachment" onClick={() => setPendingFiles((current) => current.filter((entry) => entry.id !== item.id))}><X size={12} /></button></span>)}
          </div>
        )}
        <div className="message-composer">
          <button className="icon-button" title="Attach files (screenshots, logs)" onClick={pickFiles} disabled={pendingFiles.length >= 5}><Paperclip size={17} /></button>
          <textarea
            maxLength={4000}
            rows={1}
            placeholder={closed ? "Reply to reopen this ticket" : "Write a reply"}
            value={text}
            onChange={(changeEvent) => setText(changeEvent.target.value)}
            onKeyDown={(keyboardEvent) => {
              if (keyboardEvent.key === "Enter" && !keyboardEvent.shiftKey) {
                keyboardEvent.preventDefault();
                send();
              }
            }}
          />
          <span>{text.length}/4000</span>
          <button className="primary icon-button" title="Send reply" disabled={(!text.trim() && !pendingFiles.length) || sending} onClick={send}><Send size={17} /></button>
        </div>
      </div>
    </section>
  );
}

const EMPTY_BUG = { what: "", expected: "", steps: "" };

/** New ticket modal. `initial` may carry {type, subject, context} from the
 * bug report entry points (Bug Tracker tab, error states). */
export function NewTicketModal({ initial, onClose, onCreated }) {
  const [type, setType] = useState(initial?.type === "bug" ? "bug" : "general");
  const [subject, setSubject] = useState(initial?.subject || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [bug, setBug] = useState({ ...EMPTY_BUG, what: initial?.description || "" });
  const [pendingFiles, setPendingFiles] = useState([]);
  const [appVersion, setAppVersion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.getAppVersion().then((version) => setAppVersion(String(version || "")));
  }, []);

  const pickFiles = async () => {
    const result = await api.openSharedFiles();
    if (!result.ok) {
      if (result.rejected?.length) setError(result.rejected.map((item) => `${item.name}: ${item.error}`).join(" "));
      return;
    }
    setPendingFiles((current) => [...current, ...(result.files || [])].slice(0, 5));
    if (result.rejected?.length) setError(result.rejected.map((item) => `${item.name}: ${item.error}`).join(" "));
  };

  const addDroppedPaths = useCallback(async (paths) => {
    const result = await api.addSharedPaths(paths);
    if (result.folders?.length) setError("Tickets take individual files, not folders.");
    if (result.files?.length) setPendingFiles((current) => [...current, ...result.files].slice(0, 5));
    if (result.rejected?.length) setError(result.rejected.map((item) => `${item.name}: ${item.error}`).join(" "));
  }, []);

  const drop = useFileDrop({ onPaths: addDroppedPaths });

  const composedBody = () => {
    if (type !== "bug") return description.trim();
    const parts = [];
    if (bug.what.trim()) parts.push(`What happened:\n${bug.what.trim()}`);
    if (bug.expected.trim()) parts.push(`Expected behavior:\n${bug.expected.trim()}`);
    if (bug.steps.trim()) parts.push(`Steps to reproduce:\n${bug.steps.trim()}`);
    if (initial?.context) parts.push(`Reported from: ${initial.context}`);
    return parts.join("\n\n");
  };

  const submit = async () => {
    const body = composedBody();
    if (!subject.trim()) { setError("Give the ticket a subject."); return; }
    if (!body) { setError(type === "bug" ? "Describe what happened." : "Describe what you need help with."); return; }
    setBusy(true);
    setError("");
    const result = await api.alley("/api/tickets", {
      method: "POST",
      json: {
        type,
        subject: subject.trim(),
        body,
        appVersion,
        attachments: pendingFiles.map(({ id, name, size, mime }) => ({ id, name, size, mime }))
      }
    });
    setBusy(false);
    if (result.status === 201) {
      audio.success();
      onCreated?.(result.data?.ticket);
      onClose();
    } else {
      setError(result.error || "The ticket was not created.");
    }
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal ticket-compose drop-zone" onClick={(clickEvent) => clickEvent.stopPropagation()} {...drop.bind}>
        <DropOverlay active={drop.dragOver} label="Drop to attach to the ticket" />
        <h2><LifeBuoy size={17} /> New support ticket</h2>
        <div className="ticket-type-picker">
          <button className={type === "general" ? "active" : ""} onClick={() => setType("general")}>
            <LifeBuoy size={14} /> General help
          </button>
          <button className={type === "bug" ? "active" : ""} onClick={() => setType("bug")}>
            <Bug size={14} /> Bug report
          </button>
        </div>
        <label className="field"><span>Subject</span>
          <input type="text" maxLength={120} value={subject} onChange={(changeEvent) => setSubject(changeEvent.target.value)} placeholder={type === "bug" ? "Short summary of the bug" : "What do you need help with?"} autoFocus />
        </label>
        {type === "general" && (
          <label className="field"><span>Description</span>
            <textarea maxLength={4000} value={description} onChange={(changeEvent) => setDescription(changeEvent.target.value)} placeholder="Describe the question or problem..." style={{ minHeight: 120 }} />
          </label>
        )}
        {type === "bug" && (
          <>
            <label className="field"><span>What happened</span>
              <textarea maxLength={1500} value={bug.what} onChange={(changeEvent) => setBug({ ...bug, what: changeEvent.target.value })} placeholder="What went wrong?" style={{ minHeight: 70 }} />
            </label>
            <label className="field"><span>Expected behavior</span>
              <textarea maxLength={1000} value={bug.expected} onChange={(changeEvent) => setBug({ ...bug, expected: changeEvent.target.value })} placeholder="What did you expect to happen instead?" style={{ minHeight: 54 }} />
            </label>
            <label className="field"><span>Steps to reproduce</span>
              <textarea maxLength={1000} value={bug.steps} onChange={(changeEvent) => setBug({ ...bug, steps: changeEvent.target.value })} placeholder={"1. Open ...\n2. Click ..."} style={{ minHeight: 54 }} />
            </label>
            <div className="muted tiny mb8">App version v{appVersion || "?"} is attached automatically.</div>
          </>
        )}
        {pendingFiles.length > 0 && (
          <div className="pending-files mb8">
            {pendingFiles.map((item) => <span key={item.id}>{iconFor(item.kind)}<strong>{item.name}</strong><small>{api.formatBytes(item.size)}</small><button title="Remove attachment" onClick={() => setPendingFiles((current) => current.filter((entry) => entry.id !== item.id))}><X size={12} /></button></span>)}
          </div>
        )}
        {error && <div className="errbox mb8">{error}</div>}
        <div className="actions">
          <button onClick={pickFiles} disabled={pendingFiles.length >= 5}><Paperclip size={14} />Attach files</button>
          <span style={{ flex: 1 }} />
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={submit} disabled={busy}>{busy ? "Creating..." : "Create ticket"}</button>
        </div>
      </div>
    </div>
  );
}
