import { useMemo, useState } from "react";
import { Archive, ArrowDownToLine, ArrowRight, BarChart3, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Database, HardDrive, Info, RefreshCw, Search, ShieldCheck, SlidersHorizontal } from "lucide-react";
import * as api from "../lib/api.js";
import useBoothData from "../lib/useBoothData.js";
import { analyzeBooths, boothsCsv, dateKey, DAY_MS, formatMetric, formatStorage, METRICS, metricBudgets, numberOrNull } from "../lib/analytics.mjs";
import { ChartCard, ChartEmpty, PerformanceChart, StatusChart, StorageChart, UploadActivityChart } from "../components/AnalyticsCharts.jsx";

export default function AnalyticsPage({ cfg, isAdmin, goTo }) {
  const [scope, setScope] = useState(cfg.alleyCommunityId ? "mine" : isAdmin ? "all" : "mine");
  const [range, setRange] = useState("30");
  const [from, setFrom] = useState(() => dateKey(Date.now() - 29 * DAY_MS));
  const [to, setTo] = useState(() => dateKey(Date.now()));
  const [eventId, setEventId] = useState("");
  const [communityId, setCommunityId] = useState("");
  const [metric, setMetric] = useState("triangles");
  const [activityMetric, setActivityMetric] = useState("uploads");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("recent");
  const [page, setPage] = useState(1);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);
  const { data, loading, error, refresh } = useBoothData({ cfg, scope });
  const communities = useMemo(() => new Map((data?.communities || []).map((item) => [String(item.id), item.name || String(item.id)])), [data?.communities]);
  const events = useMemo(() => new Map((data?.events || []).map((item) => [String(item.id), item])), [data?.events]);
  const uploads = useMemo(() => (data?.booths || []).map((row) => ({ ...row, communityId: row.communityId || (scope === "mine" ? cfg.alleyCommunityId : ""), communityName: row.communityName || communities.get(String(row.communityId)) || (scope === "mine" ? cfg.alleyCommunityName : "") })), [data?.booths, communities, scope, cfg.alleyCommunityId, cfg.alleyCommunityName]);
  const report = useMemo(() => analyzeBooths(uploads, { range, from, to, eventId, communityId, now: data?.fetchedAt || Date.now() }), [uploads, range, from, to, eventId, communityId, data?.fetchedAt]);
  const eventOptions = useMemo(() => [...new Set([...events.keys(), ...uploads.map((row) => String(row.eventId || "")), eventId].filter(Boolean))].map((id) => ({ id, name: events.get(id)?.name || id })), [uploads, events, eventId]);
  const communityOptions = useMemo(() => {
    const names = new Map(communities);
    uploads.filter((row) => row.communityId).forEach((row) => names.set(String(row.communityId), row.communityName || String(row.communityId)));
    if (communityId && !names.has(communityId)) names.set(communityId, `${communityId} (no retained uploads)`);
    return [...names].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [uploads, communities, communityId]);
  const storage = useMemo(() => {
    if (scope === "all") return report.storage.filter((row) => row.sizeSamples > 0);
    const groups = new Map();
    for (const row of report.rows) {
      if (row.fileSize === null) continue;
      if (!groups.has(row.eventId)) groups.set(row.eventId, { name: events.get(row.eventId)?.name || row.eventId || "Event not reported", bytes: 0, sizeSamples: 0 });
      const group = groups.get(row.eventId);
      group.bytes += row.fileSize;
      group.sizeSamples += 1;
    }
    return [...groups.values()].sort((a, b) => b.bytes - a.bytes);
  }, [scope, report, events]);
  const tableRows = useMemo(() => {
    const search = query.trim().toLowerCase();
    const rows = report.rows.filter((row) => !search || [row.name, row.communityName, row.status, `v${row.version}`, events.get(row.eventId)?.name, row.eventId].some((value) => String(value || "").toLowerCase().includes(search)));
    return rows.sort((a, b) => sort === "size" ? (b.fileSize ?? -1) - (a.fileSize ?? -1) : sort === "triangles" ? (b.stats.triangles ?? -1) - (a.stats.triangles ?? -1) : sort === "oldest" ? (a.timestamp ?? Infinity) - (b.timestamp ?? Infinity) : (b.timestamp ?? -Infinity) - (a.timestamp ?? -Infinity));
  }, [report.rows, query, sort, events]);
  const pages = Math.max(1, Math.ceil(tableRows.length / 15));
  const currentPage = Math.min(page, pages);
  const selectedLatest = report.rows.find((row) => row.status === "active") || report.rows[0];
  const budgets = metricBudgets(selectedLatest, data?.events);
  const performanceRows = report.rows.slice(0, 12);
  const performanceEventIds = new Set(performanceRows.map((row) => row.eventId));
  const performanceLimit = performanceEventIds.size === 1 ? numberOrNull(events.get(performanceRows[0]?.eventId)?.limits?.[METRICS[metric].limit]) : null;
  const hasData = Boolean(data);
  const hasUploads = report.rows.length > 0;
  const subtitle = report.window.error || `${report.window.from} to ${report.window.to} (UTC)`;
  const notes = [subtitle, "Source: retained Legends Alley SDK uploads, not lifetime history."];

  const resetFilters = () => { setRange("30"); setEventId(""); setCommunityId(""); setQuery(""); setPage(1); };
  const exportCsv = async () => {
    if (saving || !tableRows.length) return;
    const content = boothsCsv(tableRows, {
      "Report scope": scope === "all" ? "All communities (staff)" : cfg.alleyCommunityName || "My community",
      "Report from (UTC)": report.window.from,
      "Report to (UTC)": report.window.to,
      "Event filter": eventId || "All events",
      "Community filter": communityId || "All in scope",
      "Record search": query.trim(),
      "Snapshot (UTC)": new Date(data.fetchedAt).toISOString(),
      "Coverage": "Retained server records only, not lifetime history"
    });
    const name = `booth-analytics-${report.window.from}-${report.window.to}${eventId || communityId || query.trim() ? "-filtered" : ""}.csv`;
    setSaving(true);
    setNotice(null);
    try {
      const picked = await api.saveFileDialog({ defaultName: name, filters: [{ name: "CSV spreadsheet", extensions: ["csv"] }] });
      if (!picked?.ok) { if (picked?.error) throw new Error(picked.error); return; }
      const result = await api.writeText(picked.path, content);
      if (!result?.ok) throw new Error(result?.error || "The report could not be saved.");
      setNotice({ text: `Exported ${tableRows.length} upload records. Missing measurements are left blank.`, error: false });
    } catch (exception) {
      setNotice({ text: String(exception?.message || "Export failed."), error: true });
    } finally {
      setSaving(false);
    }
  };

  if (!cfg.alleyCommunityId && !isAdmin) return <div className="page empty-state"><ShieldCheck size={30} /><h2>A community is needed for analytics</h2><p>Connect a community to see its retained booth uploads and SDK measurements.</p></div>;

  return (
    <div className="page analytics-page">
      <div className="workspace-heading">
        <div><span className="eyebrow">WORKSPACE INTELLIGENCE</span><h1>Analytics</h1><p>A clearer view of your booth uploads, storage, and build performance.</p></div>
        <div className="workspace-heading-actions"><button onClick={refresh} disabled={loading} aria-label="Refresh analytics"><RefreshCw size={15} className={loading ? "spin" : ""} />Refresh</button><button className="primary" onClick={exportCsv} disabled={saving || !hasData || !tableRows.length}><ArrowDownToLine size={15} />{saving ? "Exporting..." : "Export CSV"}</button></div>
      </div>

      <div className="analytics-filterbar">
        <span className="filterbar-label"><SlidersHorizontal size={15} />Filters</span>
        {isAdmin && <label className="filter-select"><span>Scope</span><select aria-label="Analytics scope" value={scope} onChange={(event) => { setScope(event.target.value); setCommunityId(""); setEventId(""); setPage(1); }}><option value="all">All communities</option>{cfg.alleyCommunityId && <option value="mine">My community</option>}</select></label>}
        <label className="filter-select"><span>Event</span><select aria-label="Filter by event" value={eventId} onChange={(event) => { setEventId(event.target.value); setPage(1); }}><option value="">All events</option>{eventOptions.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}</select></label>
        {scope === "all" && <label className="filter-select"><span>Community</span><select aria-label="Filter by community" value={communityId} onChange={(event) => { setCommunityId(event.target.value); setPage(1); }}><option value="">All communities</option>{communityOptions.map((community) => <option key={community.id} value={community.id}>{community.name}</option>)}</select></label>}
        <div className="period-switch" role="group" aria-label="Date range">{[["7", "7 days"], ["30", "30 days"], ["90", "90 days"], ["all", "All retained"], ["custom", "Custom"]].map(([id, label]) => <button key={id} aria-pressed={range === id} className={range === id ? "selected" : ""} onClick={() => { setRange(id); setPage(1); }}>{label}</button>)}</div>
      </div>
      {range === "custom" && <div className="analytics-custom-dates"><CalendarDays size={16} /><label>From (UTC)<input type="date" value={from} max={to || dateKey(Date.now())} onChange={(event) => { setFrom(event.target.value); setPage(1); }} /></label><label>To (UTC)<input type="date" value={to} min={from} max={dateKey(Date.now())} onChange={(event) => { setTo(event.target.value); setPage(1); }} /></label></div>}
      <div className="analytics-source-line"><span className={`service-dot${hasData && !error ? " online" : ""}`} /><span>{error ? hasData ? "Showing the last successful snapshot" : "Service unavailable" : loading ? "Syncing with Legends Alley..." : `Synced ${new Date(data?.fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}</span><span className="source-separator">/</span><span>{subtitle}</span><span className="right">{report.retainedCount.toLocaleString()} server records</span></div>
      {error && <div className="errbox analytics-alert" role="alert"><span>{error}{hasData ? " Existing charts have not been replaced with zeros." : " No analytics could be loaded."}</span><button className="small" onClick={refresh} disabled={loading}>Retry</button></div>}
      {report.window.error && <div className="warnbox" role="alert">{report.window.error}</div>}
      {data?.warnings.map((warning) => <div className="warnbox" key={warning}>{warning}</div>)}
      {notice && <div className={notice.error ? "errbox" : "okbox"} role="status">{notice.text}</div>}

      {!hasData && loading ? <div className="analytics-skeleton" role="status" aria-label="Loading analytics"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div> : hasData && !report.window.error && <>
        <div className="analytics-stats">
          <AnalyticsStat label="Retained uploads" value={report.totals.uploads.toLocaleString()} detail="Uploaded in the selected period" Icon={Archive} />
          <AnalyticsStat label="Active versions" value={report.totals.active.toLocaleString()} detail="Current status, within this selection" Icon={CheckCircle2} color="teal" />
          <AnalyticsStat label="Reported archive storage" value={formatStorage(report.totals.sizeSamples ? report.totals.bytes : hasUploads ? null : 0)} detail={`${report.totals.sizeSamples} of ${report.totals.uploads} archive sizes reported`} Icon={HardDrive} color="purple" />
          <AnalyticsStat label="Average archive size" value={formatStorage(report.totals.averageBytes)} detail="Calculated from reported sizes only" Icon={Database} color="amber" />
        </div>

        <div className="analytics-chart-grid">
          <ChartCard title="Upload activity" subtitle={`${report.window.bucketDays === 1 ? "Daily" : `${report.window.bucketDays}-day`} totals from retained versions`} className="chart-wide" exportable={hasUploads} notes={notes} actions={<div className="chart-switch" role="group" aria-label="Activity metric"><button aria-pressed={activityMetric === "uploads"} onClick={() => setActivityMetric("uploads")}>Uploads</button><button aria-pressed={activityMetric === "bytes"} onClick={() => setActivityMetric("bytes")}>Archive size</button></div>}>
            {hasUploads ? <UploadActivityChart data={report.series} bytes={activityMetric === "bytes"} /> : <ChartEmpty />}
          </ChartCard>
          <ChartCard title="Version status" subtitle="Current status of the selected uploads" exportable={hasUploads} notes={[...notes, ...report.statuses.map((row) => `${row.name}: ${row.value}`)]}>
            {hasUploads ? <StatusChart data={report.statuses} /> : <ChartEmpty title="No versions to summarize" description="Status comes directly from the Alley service." />}
          </ChartCard>
          <ChartCard title="Build performance" subtitle={`Latest ${performanceRows.length} selected uploads, oldest to newest`} className="chart-wide" exportable={performanceRows.some((row) => row.stats[metric] !== null)} notes={[...notes, `${METRICS[metric].label}${METRICS[metric].unit ? ` (${METRICS[metric].unit})` : ""}. Missing measurements are not zero.`]} actions={<select aria-label="Build performance metric" className="chart-metric-select" value={metric} onChange={(event) => setMetric(event.target.value)}>{Object.entries(METRICS).map(([key, info]) => <option key={key} value={key}>{info.label}{info.unit ? ` (${info.unit})` : ""}</option>)}</select>}>
            {performanceRows.some((row) => row.stats[metric] !== null) ? <PerformanceChart rows={performanceRows} metric={metric} limit={performanceLimit} /> : <ChartEmpty title="No measurements reported" description="This chart needs SDK measurements on the selected uploads. Missing values are never filled with zero." />}
          </ChartCard>
          <ChartCard title={`Storage by ${scope === "all" ? "community" : "event"}`} subtitle={`Largest ${Math.min(6, storage.length)} groups, reported archive sizes`} exportable={storage.length > 0} notes={notes}>
            {storage.length ? <StorageChart data={storage} /> : <ChartEmpty title="No archive sizes reported" description="Storage appears once the service supplies file sizes." />}
          </ChartCard>
        </div>

        {selectedLatest && <section className="budget-panel">
          <div className="section-heading"><div><span className="eyebrow">RESOURCE CHECK</span><h2>{selectedLatest.status === "active" ? "Latest selected active version" : "Latest selected upload"}</h2><p>{selectedLatest.communityName ? `${selectedLatest.communityName} / ` : ""}{selectedLatest.name} / v{selectedLatest.version} / {events.get(selectedLatest.eventId)?.name || selectedLatest.eventId || "Event not reported"}</p></div><button className="ghost small right" onClick={() => goTo("atlas")}>Texture Atlas<ArrowRight size={14} /></button></div>
          <div className="budget-grid">{budgets.map((budget) => <div key={budget.key} className={`budget-item${budget.exceeded ? " exceeded" : ""}`}><div><span>{budget.label}</span><strong>{formatMetric(budget.value, budget.key)}</strong></div><div className="budget-track" role={budget.percent !== null ? "meter" : undefined} aria-label={budget.label} aria-valuenow={budget.percent !== null ? Math.min(100, budget.percent) : undefined} aria-valuemin={budget.percent !== null ? 0 : undefined} aria-valuemax={budget.percent !== null ? 100 : undefined} aria-valuetext={budget.percent !== null ? `${Math.round(budget.percent)}% of event limit` : undefined}><span style={{ width: `${Math.min(100, budget.percent || 0)}%`, background: budget.exceeded ? "var(--danger)" : budget.color }} /></div><small>{budget.limit === null ? "No configured event limit" : budget.value === null ? `Limit: ${formatMetric(budget.limit, budget.key)}; measurement missing` : `${budget.percent === null ? "" : `${Math.round(budget.percent)}% of `}${formatMetric(budget.limit, budget.key)} limit${budget.exceeded ? " (exceeded)" : ""}`}</small></div>)}</div>
          <p className="budget-footnote">Reported SDK values compared with current event limits. This is not a full SDK validation.{selectedLatest.booth.limitsBypassed ? " Staff bypassed limits for this upload." : ""}</p>
        </section>}

        <section className="analytics-records">
          <div className="section-heading"><div><h2>Behind the numbers</h2><p>Inspect the actual upload records used by these charts.</p></div><button className="ghost small right" onClick={() => goTo(scope === "all" ? "alleyAdmin" : "booths")}>Open {scope === "all" ? "staff console" : "backups"}<ArrowRight size={14} /></button></div>
          <div className="analytics-table-toolbar"><div className="search-field"><Search size={15} /><input type="search" aria-label="Search analytics records" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Search booth, community, version..." /></div><select aria-label="Sort analytics records" value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }}><option value="recent">Newest first</option><option value="oldest">Oldest first</option><option value="size">Largest archive</option><option value="triangles">Most triangles</option></select><span>{tableRows.length} records{query && " (CSV follows this search)"}</span></div>
          <div className="analytics-table-scroll"><table className="analytics-table"><thead><tr><th scope="col">Booth / version</th><th scope="col">Uploaded (UTC)</th><th scope="col">Status</th><th scope="col">Archive</th><th scope="col">Triangles</th><th scope="col">Materials</th><th scope="col">Memory</th></tr></thead><tbody>{tableRows.slice((currentPage - 1) * 15, currentPage * 15).map((row) => <tr key={row.key}><th scope="row"><strong>{row.name} <span>v{row.version}</span></strong><small>{row.communityName || "Community"} / {events.get(row.eventId)?.name || row.eventId || "Event not reported"}</small></th><td>{row.timestamp === null ? "Not reported" : new Date(row.timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}</td><td><span className={`pill ${row.status === "active" ? "teal" : row.status === "rejected" ? "red" : "gray"}`}>{row.status}</span></td><td>{formatStorage(row.fileSize)}</td><td>{formatMetric(row.stats.triangles, "triangles")}</td><td>{formatMetric(row.stats.materialSlots, "materialSlots")}</td><td>{formatMetric(row.stats.vramMB, "vramMB")}</td></tr>)}</tbody></table></div>
          {!tableRows.length && <div className="analytics-table-empty"><BarChart3 size={24} /><strong>{query ? "No matching records" : "No retained uploads in this selection"}</strong><button className="ghost small" onClick={resetFilters}>Reset filters</button></div>}
          {tableRows.length > 0 && <div className="analytics-pagination"><span>Showing {(currentPage - 1) * 15 + 1} to {Math.min(currentPage * 15, tableRows.length)} of {tableRows.length}</span><div><button className="small" aria-label="Previous records page" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={15} /></button><span>{currentPage} / {pages}</span><button className="small" aria-label="Next records page" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}><ChevronRight size={15} /></button></div></div>}
        </section>
        <div className="analytics-data-note"><Info size={16} /><p><strong>Real records, clear limits.</strong> These charts use retained server uploads, not lifetime totals or visitor tracking. Deleted versions cannot be reconstructed. Status and event limits reflect the current snapshot; file sizes and SDK stats are recorded at upload. Missing measurements stay unavailable.{report.missingDates > 0 ? ` ${report.missingDates} undated records ${range === "all" ? "are included in summaries but excluded from the timeline" : "are excluded by the date filter"}.` : ""}{report.futureDates > 0 ? ` ${report.futureDates} future-dated records were excluded.` : ""} Dates are grouped in UTC. Auto-refresh runs once a minute while this window is visible.</p></div>
      </>}
    </div>
  );
}

export function AnalyticsStat({ label, value, detail, Icon, color = "pink" }) {
  return <div className={`analytics-stat ${color}`}><div className="analytics-stat-top"><span>{label}</span><Icon size={17} /></div><strong>{value}</strong><small>{detail}</small></div>;
}