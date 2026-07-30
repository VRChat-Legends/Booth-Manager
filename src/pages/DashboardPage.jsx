import { useEffect, useMemo, useState } from "react";
import { Boxes, Building2, MessageSquareText, Package, QrCode, ShieldCheck, Sparkles } from "lucide-react";
import * as api from "../lib/api.js";

export default function DashboardPage({ cfg, isAdmin, goTo, event }) {
  const [booths, setBooths] = useState(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!cfg.alleyCommunityId) {
      setBooths([]);
      return undefined;
    }
    let disposed = false;
    const load = async () => {
      const result = await api.alley("/api/booths/mine");
      if (!disposed) setBooths(result.status === 200 ? result.data?.booths || [] : []);
    };
    load();
    const timer = window.setInterval(() => {
      setNow(Date.now());
      load();
    }, 60_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [cfg.alleyCommunityId]);

  const countdown = useMemo(() => {
    const startsAt = Date.parse(event?.startsAt || "");
    if (!Number.isFinite(startsAt)) return null;
    const remaining = Math.max(0, startsAt - now);
    return {
      live: remaining === 0 && now <= Date.parse(event?.endsAt || ""),
      days: Math.floor(remaining / 86_400_000),
      hours: Math.floor((remaining % 86_400_000) / 3_600_000),
      minutes: Math.floor((remaining % 3_600_000) / 60_000)
    };
  }, [event, now]);

  const uploads = booths || [];
  const active = uploads.filter((booth) => booth.status === "active");
  const totalBytes = uploads.reduce((sum, booth) => sum + (Number(booth.fileSize) || 0), 0);
  const latest = uploads.slice().sort((left, right) => Date.parse(right.uploadedAt) - Date.parse(left.uploadedAt)).slice(0, 5);

  return (
    <div className="page dashboard-page">
      <div className="pagehead">
        <h1>{cfg.alleyCommunityName || "Alley operations"}</h1>
        <div className="sub">
          {cfg.alleyCommunityId
            ? "Your community workspace, backed by the same uploads and team roster used by Legends Alley."
            : "Staff access is connected. Choose Alley Admin to work across communities."}
        </div>
      </div>

      <div className="stagger dashboard-stack">
        <section className="hero event-hero" style={{ "--event-image": "url('./booth-model/banner_1920.png')" }}>
          <div className="grow">
            <h2>{event?.name || "Legends Alley"}</h2>
            <div className="date">
              {event?.startsAt
                ? `${api.formatDate(event.startsAt)}${event.timezone ? ` (${event.timezone})` : ""}`
                : event ? "Event schedule pending" : "Syncing event details..."}
            </div>
            <div className="event-state-line">
              <span className={`service-dot${event?.acceptingBooths ? " online" : ""}`} />
              {event ? (event.acceptingBooths ? "Uploads are open" : "Uploads are closed") : "Checking upload status..."}
            </div>
          </div>
          {countdown && (
            <div className="cd">
              {countdown.live ? <div className="unit"><div className="num">LIVE</div><div className="lab">NOW</div></div> : (
                <>
                  <div className="unit"><div className="num">{countdown.days}</div><div className="lab">DAYS</div></div>
                  <div className="unit"><div className="num">{countdown.hours}</div><div className="lab">HOURS</div></div>
                  <div className="unit"><div className="num">{countdown.minutes}</div><div className="lab">MINS</div></div>
                </>
              )}
            </div>
          )}
        </section>

        <div className="stats">
          <div className="stat"><div className="v">{booths ? uploads.length : "-"}</div><div className="l">Retained uploads</div></div>
          <div className="stat"><div className="v">{booths ? active.length : "-"}</div><div className="l">Active versions</div></div>
          <div className="stat"><div className="v">{cfg.alleyCommunityId ? api.formatBytes(totalBytes) : "-"}</div><div className="l">Backup storage</div></div>
          <div className="stat"><div className="v">{String(cfg.alleyRole || (isAdmin ? "staff" : "team")).toUpperCase()}</div><div className="l">Community role</div></div>
        </div>

        <div className="dashboard-workspace">
          <section className="dashboard-section">
            <div className="section-heading"><div><h2>Recent server uploads</h2><p>Only booth packages uploaded through the Legends Alley SDK appear here.</p></div><button className="ghost small" onClick={() => goTo("booths")} disabled={!cfg.alleyCommunityId}>View all</button></div>
            {!booths && <div className="skeleton" style={{ height: 150 }} />}
            {booths && latest.length === 0 && (
              <div className="empty-state compact"><Boxes size={27} /><h2>No booth uploads yet</h2><p>Your first accepted SDK upload will appear here automatically.</p></div>
            )}
            <div className="recent-upload-list">
              {latest.map((booth) => (
                <button key={booth.id} className="upload-summary" onClick={() => goTo("booths")}>
                  <span className="version-mark">v{booth.version}</span>
                  <span className="grow"><strong>{booth.prefabName || `Booth version ${booth.version}`}</strong><small>{api.formatDate(booth.uploadedAt)} | {api.formatBytes(booth.fileSize)}</small></span>
                  <span className={`pill ${booth.status === "active" ? "teal" : "gray"}`}>{booth.status}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="dashboard-shortcuts">
            <div className="section-heading"><div><h2>Quick access</h2><p>Jump back into your Alley workspace.</p></div></div>
            <div className="dashboard-shortcut-grid">
              <button className="featured" onClick={() => goTo("booths")} disabled={!cfg.alleyCommunityId}><Boxes size={19} /><span>Booth backups</span></button>
              <button onClick={() => goTo("chat")}><MessageSquareText size={19} /><span>Team chat</span></button>
              {cfg.alleyCommunityId && <button onClick={() => goTo("alleyDashboard")}><Building2 size={19} /><span>Community</span></button>}
              <button onClick={() => goTo("standee")}><Sparkles size={19} /><span>Standee Studio</span></button>
              <button onClick={() => goTo("unitySdk")}><Package size={19} /><span>Unity SDK</span></button>
              <button onClick={() => goTo("qr")}><QrCode size={19} /><span>QR Codes</span></button>
              {isAdmin && <button onClick={() => goTo("alleyAdmin")}><ShieldCheck size={19} /><span>Alley Admin</span></button>}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}