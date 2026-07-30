// Staff ticket dashboard: cross-community inbox with claim/reassign/close
// controls and a context side panel (community, current booth, opener
// history). Rendered as a tab inside the Alley Admin page.
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Building2, ExternalLink, Hand, UserPlus, XCircle, RotateCcw } from "lucide-react";
import * as api from "../lib/api.js";
import * as audio from "../lib/audio.js";
import { TicketThread, TypePill, statusMeta } from "../components/tickets.jsx";
import { AlleyBoothRow } from "./AlleyDashboardPage.jsx";

const FILTERS = [
  ["all", "All", ""],
  ["open", "Open", "active"],
  ["awaiting", "Awaiting Response", "awaiting_staff"],
  ["closed", "Closed", "closed"]
];

export default function AdminTickets({ cfg, onCounts, onOpenBooths }) {
  const [filter, setFilter] = useState("awaiting");
  const [tickets, setTickets] = useState(null);
  const [counts, setCounts] = useState(null);
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState("");

  const query = FILTERS.find(([id]) => id === filter)?.[2] || "";

  const load = useCallback(async () => {
    const result = await api.alley(`/api/tickets${query ? `?status=${encodeURIComponent(query)}` : ""}`);
    if (result.status === 200) {
      setTickets(result.data?.tickets || []);
      setCounts(result.data?.counts || null);
      onCounts?.(result.data?.counts || null);
      setError("");
    } else {
      setTickets((current) => current || []);
      setError(result.error || "Could not load the ticket inbox.");
    }
  }, [query, onCounts]);

  useEffect(() => {
    setTickets(null);
    load();
    const timer = window.setInterval(load, 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  if (selectedId) {
    return (
      <StaffTicketDetail
        cfg={cfg}
        ticketId={selectedId}
        onBack={() => { setSelectedId(""); load(); }}
        onOpenBooths={onOpenBooths}
      />
    );
  }

  return (
    <div>
      <div className="tabs">
        {FILTERS.map(([id, label]) => (
          <div key={id} className={`tab${filter === id ? " active" : ""}`} onClick={() => setFilter(id)}>
            {label}
            {id === "awaiting" && (counts?.awaitingStaff || 0) > 0 && <span className="count">{counts.awaitingStaff}</span>}
          </div>
        ))}
      </div>

      {error && <div className="errbox mb12">{error}</div>}
      {!tickets && <div className="skeleton" style={{ height: 180 }} />}
      {tickets && tickets.length === 0 && (
        <div className="card sub">{filter === "awaiting" ? "Nothing is waiting on staff. Nice." : "No tickets here."}</div>
      )}

      <div className="stagger" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {(tickets || []).map((ticket) => {
          const meta = statusMeta(ticket.status, true);
          const needsAttention = ticket.status === "awaiting_staff" || ticket.status === "open";
          return (
            <button key={ticket.id} className={`listrow ticket-row clickable${needsAttention ? " attention" : ""}`} onClick={() => setSelectedId(ticket.id)}>
              {needsAttention && <span className="attention-dot" title="Waiting on staff" />}
              <div className="grow">
                <div className="title">{ticket.subject}</div>
                <div className="meta">
                  {ticket.communityName || "No community"} | {ticket.openerName}
                  {ticket.appVersion ? ` | v${ticket.appVersion}` : ""}
                  {` | updated ${api.timeAgo(ticket.lastMessageAt || ticket.updatedAt)}`}
                </div>
              </div>
              {ticket.assignedStaffId && (
                <span className="claimed-chip compact" title={`Claimed by ${ticket.assignedStaffName}`}>
                  {ticket.assignedStaffAvatarUrl
                    ? <img src={ticket.assignedStaffAvatarUrl} alt="" />
                    : <span className="claimed-initial">{(ticket.assignedStaffName || "?")[0]?.toUpperCase()}</span>}
                  <strong>{ticket.assignedStaffName}</strong>
                </span>
              )}
              <TypePill type={ticket.type} />
              <span className={`pill ${meta.cls}`}>{meta.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StaffTicketDetail({ cfg, ticketId, onBack, onOpenBooths }) {
  const [ticket, setTicket] = useState(null);
  const [context, setContext] = useState(null);
  const [reassigning, setReassigning] = useState(false);
  const [staffId, setStaffId] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const selfId = String(cfg.alleyDiscordId || "");

  useEffect(() => {
    api.alley(`/api/tickets/${encodeURIComponent(ticketId)}/context`).then((result) => {
      if (result.status === 200) setContext(result.data);
    });
  }, [ticketId]);

  const action = async (path, json) => {
    setBusy(true);
    setActionError("");
    const result = await api.alley(`/api/tickets/${encodeURIComponent(ticketId)}/${path}`, { method: "POST", json });
    setBusy(false);
    if (result.status === 200) {
      audio.success();
      if (result.data?.ticket) setTicket(result.data.ticket);
      return true;
    }
    setActionError(result.error || "The action failed.");
    return false;
  };

  const claim = () => action("claim");
  const closeTicket = () => action("close");
  const reopenTicket = () => action("reopen");
  const reassign = async () => {
    if (await action("assign", { staffDiscordId: staffId.trim() })) {
      setReassigning(false);
      setStaffId("");
    }
  };

  const claimedBySelf = ticket?.assignedStaffId === selfId;

  return (
    <div className="ticket-detail">
      <div className="row mb12">
        <button className="ghost small" onClick={onBack}><ArrowLeft size={14} />Ticket inbox</button>
        {actionError && <span className="danger-text small">{actionError}</span>}
      </div>
      <div className="ticket-detail-layout">
        <TicketThread
          cfg={cfg}
          ticketId={ticketId}
          staffView
          onTicket={setTicket}
          headerActions={ticket && (
            <span className="row" style={{ gap: 6 }}>
              {!ticket.assignedStaffId && ticket.status !== "closed" && (
                <button className="small" disabled={busy} onClick={claim} title="Take ownership of this ticket"><Hand size={13} />Claim</button>
              )}
              {ticket.assignedStaffId && !claimedBySelf && (
                <button className="small" disabled={busy} onClick={() => setReassigning(true)} title="Reassign to another staff member"><UserPlus size={13} />Reassign</button>
              )}
              {ticket.assignedStaffId && claimedBySelf && (
                <button className="small" disabled={busy} onClick={() => setReassigning(true)} title="Hand this ticket to someone else"><UserPlus size={13} />Hand off</button>
              )}
              {ticket.status !== "closed" && (
                <button className="danger small" disabled={busy} onClick={closeTicket}><XCircle size={13} />Close</button>
              )}
              {ticket.status === "closed" && (
                <button className="small" disabled={busy} onClick={reopenTicket}><RotateCcw size={13} />Reopen</button>
              )}
            </span>
          )}
        />
        <TicketContextPanel context={context} ticket={ticket} onOpenBooths={onOpenBooths} />
      </div>

      {reassigning && (
        <div className="modal-scrim" onClick={() => setReassigning(false)}>
          <div className="modal" onClick={(clickEvent) => clickEvent.stopPropagation()}>
            <h2>Reassign ticket</h2>
            <p className="muted small">Hands the ticket to another staff member, for example when the current owner is offline. This is deliberate, not automatic.</p>
            <label className="field"><span>Staff Discord user ID</span>
              <input type="text" value={staffId} onChange={(changeEvent) => setStaffId(changeEvent.target.value)} placeholder="123456789012345678" autoFocus />
            </label>
            {actionError && <div className="errbox mb8">{actionError}</div>}
            <div className="actions">
              <button onClick={() => setReassigning(false)}>Cancel</button>
              <button className="primary" disabled={busy || !staffId.trim()} onClick={reassign}>Reassign</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* Community, current booth, and opener history pulled in one lookup. */
function TicketContextPanel({ context, ticket, onOpenBooths }) {
  const [logo, setLogo] = useState("");
  useEffect(() => {
    if (context?.community?.logoUrl) api.alleyImageUrl(context.community.logoUrl).then(setLogo);
  }, [context?.community?.logoUrl]);

  if (!context) return <aside className="ticket-context"><div className="skeleton" style={{ height: 220 }} /></aside>;

  const { community, booth, opener } = context;
  return (
    <aside className="ticket-context">
      <div className="card">
        <h3>Community</h3>
        {!community && <div className="muted small">This ticket is not linked to a community{ticket?.openerRole === "staff" ? " (opened by staff)" : ""}.</div>}
        {community && (
          <>
            <div className="row gap14 mb8">
              <div className="avatar square">{logo ? <img src={logo} alt="" /> : (community.name || "?")[0]?.toUpperCase()}</div>
              <div className="grow">
                <div className="title">{community.name}</div>
                <div className="meta">{community.groupId || "No group ID"}{community.active ? "" : " | INACTIVE"}</div>
              </div>
            </div>
            <div className="muted tiny">
              Opener's role here: <strong>{community.openerRole ? community.openerRole.toUpperCase() : "NOT ON THE TEAM ANYMORE"}</strong>
            </div>
          </>
        )}
      </div>

      <div className="card">
        <h3>Current booth</h3>
        {!community && <div className="muted small">No community, so no booth to show.</div>}
        {community && !booth && (
          <div className="muted small">
            <Building2 size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
            This community has not uploaded a booth yet.
          </div>
        )}
        {booth && (
          <>
            <AlleyBoothRow b={booth} right={<span />} />
            <div className="muted tiny mt8" style={{ wordBreak: "break-all" }}>
              {booth.sdkVersion ? `SDK ${booth.sdkVersion} | ` : ""}
              {booth.limitsBypassed ? "LIMITS BYPASS | " : ""}
              SHA-256 {booth.sha256 || "?"}
            </div>
            {(booth.shaders || []).length > 0 && (
              <div className="muted tiny mt8">Shaders: {booth.shaders.join(", ")}</div>
            )}
            {onOpenBooths && (
              <button className="ghost small mt8" onClick={() => onOpenBooths(booth.communityId)} title="Jump to the full booth list">
                <ExternalLink size={13} />Open in Booths
              </button>
            )}
          </>
        )}
      </div>

      <div className="card">
        <h3>Opener</h3>
        <div className="row gap14">
          <div className="avatar">
            {opener.avatarUrl ? <img src={opener.avatarUrl} alt="" /> : (opener.name || "?")[0]?.toUpperCase()}
          </div>
          <div className="grow">
            <div className="title">{opener.name}</div>
            <div className="meta">{opener.id} | {String(opener.role || "team").toUpperCase()}</div>
          </div>
        </div>
        <div className="muted tiny mt8">
          {opener.ticketCount} ticket{opener.ticketCount === 1 ? "" : "s"} opened in total
          {opener.ticketCount > 3 ? " (frequent reporter)" : ""}
        </div>
      </div>
    </aside>
  );
}
