import { useMemo, useState } from "react";
import { Archive, ArrowRight, BarChart3, Boxes, Building2, CalendarClock, CheckCircle2, Combine, HardDrive, MessageSquareText, Package, RefreshCw, ShieldCheck, Sparkles, QrCode } from "lucide-react";
import * as api from "../lib/api.js";
import useBoothData from "../lib/useBoothData.js";
import { analyzeBooths, formatStorage } from "../lib/analytics.mjs";
import { ChartCard, ChartEmpty, UploadActivityChart } from "../components/AnalyticsCharts.jsx";

const TOOLS = [
  { id: "standee", title: "Standee Studio", description: "Turn your artwork into a ready-to-export 3D cutout.", Icon: Sparkles, color: "pink", tag: "3D CREATION" },
  { id: "qr", title: "QR Codes", description: "Create sharp, scan-ready codes for your community.", Icon: QrCode, color: "teal", tag: "LINKS & PRINT" },
  { id: "atlas", title: "Texture Atlas", description: "Pack textures, merge meshes, and export a lighter model.", Icon: Combine, color: "purple", tag: "OPTIMIZATION" }
];

export default function DashboardPage({ cfg, isAdmin, goTo, event }) {
  const scope = !cfg.alleyCommunityId && isAdmin ? "all" : "mine";
  const [period, setPeriod] = useState("30");
  const { data, loading, error, refresh } = useBoothData({ cfg, scope });
  const now = data?.fetchedAt || Date.now();
  const snapshot = useMemo(() => analyzeBooths(data?.booths, { range: "all", now }), [data?.booths, now]);
  const activity = useMemo(() => analyzeBooths(data?.booths, { range: period, now }), [data?.booths, period, now]);
  const latest = snapshot.rows.slice(0, 4);
  const active = snapshot.totals.active;
  const startsAt = Date.parse(event?.startsAt || "");
  const endsAt = Date.parse(event?.endsAt || "");
  const remaining = Math.max(0, startsAt - now);
  const eventEnded = Number.isFinite(endsAt) && now > endsAt;
  const eventLive = Number.isFinite(startsAt) && Number.isFinite(endsAt) && startsAt <= now && now <= endsAt;
  const backupTarget = scope === "all" ? "alleyAdmin" : "booths";
  const statValue = (value) => data ? value : loading ? "..." : "Unavailable";

  return (
    <div className="page dashboard-page dashboard-refined">
      <div className="workspace-heading">
        <div><span className="eyebrow">{cfg.alleyCommunityName || "ALLEY OPERATIONS"}</span><h1>Your workspace, at a glance.</h1><p>Keep your booth on track. Everything you need, in one place.</p></div>
        <div className="workspace-heading-actions"><button className="icon-button" aria-label="Refresh dashboard" title="Refresh dashboard" disabled={loading} onClick={refresh}><RefreshCw size={16} className={loading ? "spin" : ""} /></button><button className="primary" onClick={() => goTo("analytics")}><BarChart3 size={16} />Open analytics<ArrowRight size={14} /></button></div>
      </div>
      {error && <div className="errbox mb16" role="alert">{error}{data ? " Showing the last successful snapshot." : " Upload totals are unavailable."}</div>}
      {data?.warnings.map((warning) => <div className="warnbox mb16" key={warning}>{warning}</div>)}
      <div className="dashboard-stack">
        <section className="hero event-hero dashboard-event">
          <img className="event-hero-media" src="./booth-model/legends-banner.webp" alt="" aria-hidden="true" />
          <div className="grow"><span className="eyebrow">{eventEnded ? "RECENT EVENT" : eventLive ? "HAPPENING NOW" : "ON THE CALENDAR"}</span><h2>{event?.name || "Legends Alley"}</h2><div className="date">{event?.startsAt ? api.formatDate(event.startsAt) : "Event schedule pending"}</div><div className="event-state-line"><span className={`service-dot${event?.acceptingBooths ? " online" : ""}`} />{event ? event.acceptingBooths ? "Booth uploads are open" : "Booth uploads are closed" : "Waiting for event details"}</div></div>
          {Number.isFinite(startsAt) && <div className="cd">{eventEnded || eventLive || !remaining ? <div className="unit"><div className="num event-phase">{eventEnded ? "ENDED" : eventLive ? "LIVE" : "STARTED"}</div><div className="lab">EVENT STATUS</div></div> : <><div className="unit"><div className="num">{Math.floor(remaining / 86_400_000)}</div><div className="lab">DAYS</div></div><div className="unit"><div className="num">{Math.floor(remaining % 86_400_000 / 3_600_000)}</div><div className="lab">HOURS</div></div><div className="unit"><div className="num">{Math.floor(remaining % 3_600_000 / 60_000)}</div><div className="lab">MINS</div></div></>}</div>}
        </section>

        <div className="analytics-stats dashboard-metrics">
          <DashboardMetric label="Retained uploads" value={statValue(snapshot.totals.uploads.toLocaleString())} detail={scope === "all" ? "Across all communities" : "Your community's server backups"} Icon={Archive} />
          <DashboardMetric label="Active versions" value={statValue(active.toLocaleString())} detail="Current server status" Icon={CheckCircle2} color="teal" />
          <DashboardMetric label="Archive storage" value={statValue(formatStorage(snapshot.totals.sizeSamples ? snapshot.totals.bytes : snapshot.totals.uploads ? null : 0))} detail={data ? `${snapshot.totals.sizeSamples} archive sizes reported` : "Waiting for the Alley service"} Icon={HardDrive} color="purple" />
          <DashboardMetric label="Workspace access" value={String(cfg.alleyRole || (isAdmin ? "staff" : "team"))} detail={scope === "all" ? "Staff overview" : "Community workspace"} Icon={ShieldCheck} color="amber" />
        </div>

        <div className="dashboard-overview-grid">
          <ChartCard title="Upload activity" subtitle={`${activity.totals.uploads} retained uploads in the last ${period} days (UTC)`} exportable={false} actions={<div className="chart-switch" role="group" aria-label="Dashboard activity period"><button aria-pressed={period === "7"} onClick={() => setPeriod("7")}>7 days</button><button aria-pressed={period === "30"} onClick={() => setPeriod("30")}>30 days</button></div>}>
            {!data ? <ChartEmpty title={loading ? "Loading upload history" : "Upload history unavailable"} description={loading ? "Reading retained records from Legends Alley." : "Refresh to try again. No zero totals have been substituted."} /> : activity.totals.uploads ? <UploadActivityChart data={activity.series} /> : <ChartEmpty description="Your accepted SDK uploads will appear here. Open Analytics for a wider date range." />}
          </ChartCard>
          <section className="dashboard-next-step"><span className="eyebrow">STAY ON TRACK</span><h2>Ready for the Alley?</h2><div className="dashboard-check"><CheckCircle2 size={19} className={active ? "teal" : "muted"} /><div><strong>{!data ? "Checking booth backups" : active ? `${active} active version${active === 1 ? "" : "s"} on the server` : "No active version reported"}</strong><span>Inspect your latest ZIP and SDK report.</span></div></div><div className="dashboard-check"><CalendarClock size={19} /><div><strong>{event?.uploadDeadline ? "Upload deadline" : "No upload deadline published"}</strong><span>{event?.uploadDeadline ? api.formatDate(event.uploadDeadline) : "Check event details before submitting."}</span></div></div><button className="primary" onClick={() => goTo(backupTarget)}><Boxes size={15} />{scope === "all" ? "Open staff console" : "Review booth backups"}<ArrowRight size={14} /></button><button className="ghost" onClick={() => goTo("unitySdk")}><Package size={15} />Get the Unity SDK</button></section>
        </div>

        <section className="dashboard-tools"><div className="section-heading"><div><h2>Made for your workflow</h2><p>Create and optimize locally. Your source files stay untouched.</p></div></div><div className="dashboard-tool-grid">{TOOLS.map(({ id, title, description, Icon, color, tag }) => <button key={id} className={`dashboard-tool ${color}`} onClick={() => goTo(id)}><div className="dashboard-tool-top"><span className="tool-tile-icon"><Icon size={22} /></span><span>{tag}</span><ArrowRight size={16} /></div><strong>{title}</strong><p>{description}</p></button>)}</div></section>

        <div className="dashboard-bottom-grid">
          <section className="dashboard-section"><div className="section-heading"><div><h2>Recent uploads</h2><p>Real server versions, newest first.</p></div><button className="ghost small right" onClick={() => goTo(backupTarget)}>View all<ArrowRight size={14} /></button></div>{!data && loading && <div className="skeleton" style={{ height: 120 }} />}{data && !latest.length && <div className="dashboard-empty"><Boxes size={24} /><span>No retained uploads yet. Submit a booth through the Unity SDK to get started.</span></div>}<div className="recent-upload-list">{latest.map((row) => <button key={row.key} className="upload-summary" onClick={() => goTo(backupTarget)}><span className="version-mark">v{row.version}</span><span className="grow"><strong>{row.communityName ? `${row.communityName} / ` : ""}{row.name}</strong><small>{row.timestamp === null ? "Date not reported" : api.formatDate(row.booth.uploadedAt)} / {formatStorage(row.fileSize)}</small></span><span className={`pill ${row.status === "active" ? "teal" : "gray"}`}>{row.status}</span><ArrowRight size={14} /></button>)}</div></section>
          <section className="dashboard-connect"><span className="eyebrow">BETTER TOGETHER</span><h2>Your community hub</h2><p>Keep feedback, people, and booth decisions in sync.</p><button onClick={() => goTo("chat")}><MessageSquareText size={18} /><span><strong>Team chat</strong><small>Conversations and shared files</small></span><ArrowRight size={15} /></button>{cfg.alleyCommunityId && <button onClick={() => goTo("alleyDashboard")}><Building2 size={18} /><span><strong>Community profile</strong><small>Branding, links, and your team</small></span><ArrowRight size={15} /></button>}{isAdmin && <button onClick={() => goTo("alleyAdmin")}><ShieldCheck size={18} /><span><strong>Alley Admin</strong><small>Manage the wider event</small></span><ArrowRight size={15} /></button>}</section>
        </div>
        <p className="dashboard-provenance">{data ? `Last synced ${new Date(data.fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. ` : ""}Totals cover retained SDK uploads, not deleted history or visitor activity.</p>
      </div>
    </div>
  );
}

function DashboardMetric({ label, value, detail, Icon, color = "pink" }) {
  return <div className={`analytics-stat ${color}`}><div className="analytics-stat-top"><span>{label}</span><Icon size={17} /></div><strong>{value}</strong><small>{detail}</small></div>;
}