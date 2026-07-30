import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, LifeBuoy, Plus } from "lucide-react";
import * as api from "../lib/api.js";
import { NewTicketModal, TicketThread, TypePill, statusMeta } from "../components/tickets.jsx";

/** Reads and clears a compose request stashed by other pages (Bug Tracker's
 * "Report a bug" button, error states). */
export function takeSupportCompose() {
  try {
    const raw = window.sessionStorage.getItem("supportCompose");
    if (!raw) return null;
    window.sessionStorage.removeItem("supportCompose");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function requestSupportCompose(payload) {
  try {
    window.sessionStorage.setItem("supportCompose", JSON.stringify(payload || {}));
  } catch { /* ignore */ }
}

export default function SupportPage({ cfg }) {
  const [tickets, setTickets] = useState(null);
  const [selectedId, setSelectedId] = useState("");
  const [composing, setComposing] = useState(null); // null | {type?, subject?, description?, context?}
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const result = await api.alley("/api/tickets/mine");
    if (result.status === 200) {
      setTickets(result.data?.tickets || []);
      setError("");
    } else {
      setTickets((current) => current || []);
      setError(result.error || "Could not load your tickets.");
    }
  }, []);

  useEffect(() => {
    const compose = takeSupportCompose();
    if (compose) setComposing(compose);
    load();
    const timer = window.setInterval(load, 20_000);
    return () => window.clearInterval(timer);
  }, [load]);

  if (selectedId) {
    return (
      <div className="page ticket-page">
        <div className="row mb12">
          <button className="ghost small" onClick={() => { setSelectedId(""); load(); }}><ArrowLeft size={14} />All tickets</button>
        </div>
        <TicketThread cfg={cfg} ticketId={selectedId} />
      </div>
    );
  }

  return (
    <div className="page">
      <div className="pagehead row">
        <div className="grow">
          <h1>Support</h1>
          <div className="sub">Questions and bug reports go straight to the Alley staff</div>
        </div>
        <button className="primary small" onClick={() => setComposing({})}><Plus size={14} />New ticket</button>
      </div>

      {error && <div className="errbox mb12">{error}</div>}
      {!tickets && <div className="skeleton" style={{ height: 180 }} />}
      {tickets && tickets.length === 0 && (
        <div className="card ticket-empty">
          <LifeBuoy size={26} />
          <strong>No tickets yet</strong>
          <span>Open a ticket for help with your community, booth uploads, or the app itself. Bug reports can include screenshots and logs.</span>
        </div>
      )}

      <div className="stagger" style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 860 }}>
        {(tickets || []).map((ticket) => {
          const meta = statusMeta(ticket.status);
          const needsAttention = ticket.status === "awaiting_user";
          return (
            <button key={ticket.id} className={`listrow ticket-row clickable${needsAttention ? " attention" : ""}`} onClick={() => setSelectedId(ticket.id)}>
              {needsAttention && <span className="attention-dot" title="The staff replied" />}
              <div className="grow">
                <div className="title">{ticket.subject}</div>
                <div className="meta">
                  {ticket.messageCount} message{ticket.messageCount === 1 ? "" : "s"}
                  {ticket.assignedStaffName ? ` | handled by ${ticket.assignedStaffName}` : ""}
                  {` | updated ${api.timeAgo(ticket.lastMessageAt || ticket.updatedAt)}`}
                </div>
              </div>
              <TypePill type={ticket.type} />
              <span className={`pill ${meta.cls}`}>{meta.label}</span>
            </button>
          );
        })}
      </div>

      {composing !== null && (
        <NewTicketModal
          initial={composing}
          onClose={() => setComposing(null)}
          onCreated={(ticket) => {
            load();
            if (ticket?.id) setSelectedId(ticket.id);
          }}
        />
      )}
    </div>
  );
}
