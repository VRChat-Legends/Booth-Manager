import { useId, useRef, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartNoAxesCombined, Download } from "lucide-react";
import * as api from "../lib/api.js";
import { formatMetric, formatStorage, METRICS } from "../lib/analytics.mjs";

const axis = { fill: "#a6a4b1", fontSize: 11 };
const grid = "#2a2932";
const shortNumber = (value) => Number(value).toLocaleString(undefined, { notation: "compact", maximumFractionDigits: 1 });
const dayLabel = (value) => new Date(`${value}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

export function ChartCard({ title, subtitle, children, actions, className = "", exportable = true, notes = [] }) {
  const plotRef = useRef(null);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");
  const exportChart = async () => {
    if (saving) return;
    const source = plotRef.current?.querySelector(".recharts-wrapper > svg.recharts-surface");
    if (!source) return;
    setSaving(true);
    setFeedback("");
    try {
      const { width, height } = source.getBoundingClientRect();
      const namespace = "http://www.w3.org/2000/svg";
      const root = document.createElementNS(namespace, "svg");
      root.setAttribute("xmlns", namespace);
      root.setAttribute("width", String(width));
      root.setAttribute("height", String(height + 80 + notes.length * 20));
      const background = document.createElementNS(namespace, "rect");
      for (const [key, value] of Object.entries({ width: "100%", height: "100%", fill: "#121217" })) background.setAttribute(key, value);
      root.append(background);
      const addText = (text, y, fill = "#aaa8b5", size = 11) => {
        const node = document.createElementNS(namespace, "text");
        for (const [key, value] of Object.entries({ x: "16", y: String(y), fill, "font-family": "Segoe UI, sans-serif", "font-size": String(size) })) node.setAttribute(key, value);
        node.textContent = text;
        root.append(node);
      };
      addText(title, 27, "#f4f3f6", 16);
      const copy = source.cloneNode(true);
      copy.setAttribute("y", "42");
      copy.setAttribute("width", String(width));
      copy.setAttribute("height", String(height));
      copy.setAttribute("font-family", "Segoe UI, sans-serif");
      root.append(copy);
      notes.forEach((note, index) => addText(note, height + 64 + index * 20));
      const svg = new XMLSerializer().serializeToString(root);
      const picked = await api.saveFileDialog({ defaultName: `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.svg`, filters: [{ name: "SVG chart", extensions: ["svg"] }] });
      if (!picked?.ok) { if (picked?.error) throw new Error(picked.error); return; }
      const result = await api.writeText(picked.path, svg);
      if (!result?.ok) throw new Error(result?.error || "The chart could not be saved.");
      setFeedback("Chart saved.");
    } catch (exception) {
      setFeedback(String(exception?.message || "The chart could not be exported."));
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className={`chart-card ${className}`} aria-label={title}>
      <div className="chart-card-head">
        <div><h2>{title}</h2><p>{subtitle}</p></div>
        <div className="chart-card-actions">{actions}{exportable && <button type="button" className="icon-button ghost" title={`Export ${title} as SVG`} aria-label={`Export ${title} as SVG`} disabled={saving} onClick={exportChart}><Download size={15} /></button>}</div>
      </div>
      <div ref={plotRef} className="chart-plot">{children}</div>
      {feedback && <div className="chart-feedback" role="status">{feedback}</div>}
    </section>
  );
}

export function ChartEmpty({ title = "No uploads in this period", description = "Choose a wider date range or another event." }) {
  return <div className="chart-empty"><ChartNoAxesCombined size={28} /><strong>{title}</strong><span>{description}</span></div>;
}

function ActivityTooltip({ active, payload, bytes }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return <div className="analytics-tooltip"><strong>{row.date}{row.endDate !== row.date ? ` to ${row.endDate}` : ""} (UTC)</strong><span>{row.uploads.toLocaleString()} retained upload{row.uploads === 1 ? "" : "s"}</span>{bytes && <span>{formatStorage(row.sizeSamples || !row.uploads ? row.bytes : null)}{row.sizeSamples < row.uploads ? ` (${row.sizeSamples}/${row.uploads} sizes reported)` : ""}</span>}</div>;
}

export function UploadActivityChart({ data, bytes = false }) {
  const gradient = `uploads-${useId().replace(/:/g, "")}`;
  const chartData = data.map((row) => ({ ...row, reportedBytes: row.uploads && !row.sizeSamples ? null : row.bytes }));
  return (
    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
      <AreaChart accessibilityLayer data={chartData} margin={{ top: 14, right: 14, bottom: 6, left: 6 }}>
        <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#f4a7e8" stopOpacity={0.28} /><stop offset="100%" stopColor="#f4a7e8" stopOpacity={0.015} /></linearGradient></defs>
        <CartesianGrid stroke={grid} strokeDasharray="3 5" vertical={false} />
        <XAxis dataKey="date" tick={axis} tickLine={false} axisLine={false} tickFormatter={dayLabel} minTickGap={38} dy={8} />
        <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} tickFormatter={bytes ? (value) => formatStorage(value) : shortNumber} width={bytes ? 72 : 38} domain={[0, (maximum) => Math.max(1, maximum)]} />
        <Tooltip content={<ActivityTooltip bytes={bytes} />} cursor={{ stroke: "#797282", strokeDasharray: "4 4" }} />
        <Area name={bytes ? "Reported archive size" : "Retained uploads"} type="linear" dataKey={bytes ? "reportedBytes" : "uploads"} stroke="#f4a7e8" strokeWidth={2.5} fill={`url(#${gradient})`} activeDot={{ r: 5, stroke: "#121217", strokeWidth: 3 }} dot={data.length === 1 ? { r: 4 } : false} isAnimationActive={false} connectNulls={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function StatusChart({ data }) {
  const total = data.reduce((sum, row) => sum + row.value, 0);
  return (
    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
      <PieChart accessibilityLayer>
        <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="43%" innerRadius={61} outerRadius={83} paddingAngle={data.length > 1 ? 4 : 0} stroke="none" isAnimationActive={false}>
          {data.map((row) => <Cell key={row.name} fill={row.color} />)}
        </Pie>
        <text x="50%" y="40%" fill="#f4f3f6" fontSize="30" fontWeight="650" textAnchor="middle">{total.toLocaleString()}</text>
        <text x="50%" y="48%" fill="#a6a4b1" fontSize="11" textAnchor="middle">retained uploads</text>
        <Tooltip content={({ active, payload }) => active && payload?.length ? <div className="analytics-tooltip"><strong>{payload[0].name}</strong><span>{payload[0].value} uploads ({Math.round(payload[0].value / total * 100)}%)</span></div> : null} />
        <Legend verticalAlign="bottom" iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingBottom: 4 }} formatter={(name, entry) => <span style={{ color: "#b9b6c3", marginRight: 8 }}>{name} <strong style={{ color: "#f4f3f6" }}>{entry.payload.value}</strong></span>} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function PerformanceChart({ rows, metric, limit = null }) {
  const data = rows.slice(0, 12).reverse().map((row) => ({ name: `v${row.version}`, title: row.name, community: row.communityName, value: row.stats[metric], date: row.timestamp === null ? "Date not reported" : new Date(row.timestamp).toLocaleDateString(undefined, { timeZone: "UTC" }) }));
  return (
    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
      <BarChart accessibilityLayer data={data} margin={{ top: 24, right: 14, bottom: 6, left: 6 }}>
        <CartesianGrid stroke={grid} strokeDasharray="3 5" vertical={false} />
        <XAxis dataKey="name" tick={axis} tickLine={false} axisLine={false} minTickGap={12} dy={7} />
        <YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={shortNumber} width={48} domain={[0, (max) => Math.max(1, max)]} />
        <Tooltip cursor={{ fill: "#ffffff08" }} content={({ active, payload }) => active && payload?.length ? <div className="analytics-tooltip"><strong>{payload[0].payload.title} ({payload[0].payload.name})</strong><span>{payload[0].payload.community}</span><span>{payload[0].payload.date} (UTC)</span><b>{formatMetric(payload[0].value, metric)}</b></div> : null} />
        {limit !== null && <ReferenceLine y={limit} stroke="#efc36f" strokeDasharray="4 4" ifOverflow="extendDomain" label={{ value: "Event limit", position: "insideTopRight", fill: "#efc36f", fontSize: 10 }} />}
        <Bar dataKey="value" name={METRICS[metric].label} fill={METRICS[metric].color} radius={[4, 4, 0, 0]} maxBarSize={38} isAnimationActive={false}>
          {data.map((row, index) => <Cell key={index} fill={limit !== null && row.value > limit ? "#ff7189" : METRICS[metric].color} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function StorageChart({ data }) {
  return (
    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
      <BarChart accessibilityLayer layout="vertical" data={data.slice(0, 6)} margin={{ top: 8, right: 20, bottom: 6, left: 8 }}>
        <CartesianGrid stroke={grid} strokeDasharray="3 5" horizontal={false} />
        <XAxis type="number" tick={axis} tickLine={false} axisLine={false} tickFormatter={(value) => formatStorage(value)} minTickGap={32} />
        <YAxis type="category" dataKey="name" width={118} tick={{ ...axis, fontSize: 10 }} tickFormatter={(name) => name.length > 17 ? `${name.slice(0, 16)}...` : name} tickLine={false} axisLine={false} />
        <Tooltip cursor={{ fill: "#ffffff08" }} content={({ active, payload }) => active && payload?.length ? <div className="analytics-tooltip"><strong>{payload[0].payload.name}</strong><span>{formatStorage(payload[0].value)} from {payload[0].payload.sizeSamples} reported sizes</span></div> : null} />
        <Bar dataKey="bytes" name="Reported archive size" fill="#62d8b4" radius={[0, 4, 4, 0]} maxBarSize={21} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}