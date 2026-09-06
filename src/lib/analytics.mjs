export const DAY_MS = 86_400_000;

export const METRICS = {
  triangles: { label: "Triangles", unit: "", limit: "maxTriangles", color: "#f4a7e8" },
  buildSizeMB: { label: "Build size", unit: "MB", limit: "maxBuildSizeMB", color: "#62d8b4" },
  vramMB: { label: "Texture + mesh memory", unit: "MB", color: "#a99bff" },
  materialSlots: { label: "Material slots", unit: "", limit: "maxMaterialSlots", color: "#efc36f" },
  uniqueTextures: { label: "Unique textures", unit: "", limit: "maxUniqueTextures", color: "#79bfff" },
  estimatedDrawCalls: { label: "Estimated draw calls", unit: "", color: "#ff9b87" }
};

const STATUS_COLORS = { active: "#62d8b4", archived: "#a99bff", superseded: "#a99bff", pending: "#efc36f", rejected: "#ff7189", unknown: "#9796a0" };
const validObject = (value) => value && typeof value === "object" && !Array.isArray(value);

export function numberOrNull(value) {
  if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= Number.MAX_SAFE_INTEGER ? number : null;
}

export function normalizeBooths(booths) {
  return (Array.isArray(booths) ? booths : []).filter(validObject).map((booth, index) => {
    const parsed = typeof booth.uploadedAt === "string" ? Date.parse(booth.uploadedAt) : NaN;
    const status = String(booth.status || "unknown").trim().toLowerCase() || "unknown";
    return {
      key: [booth.id, booth.version, booth.uploadedAt, booth.sha256, index].join(":"),
      booth,
      name: String(booth.prefabName || "Unnamed booth"),
      version: booth.version == null ? "?" : String(booth.version),
      communityId: String(booth.communityId || ""),
      communityName: String(booth.communityName || ""),
      eventId: String(booth.eventId || ""),
      timestamp: Number.isFinite(parsed) ? parsed : null,
      status,
      fileSize: numberOrNull(booth.fileSize),
      stats: Object.fromEntries(Object.keys(METRICS).map((key) => [key, numberOrNull(booth.stats?.[key])]))
    };
  });
}

function parseDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return null;
  const date = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(date) && new Date(date).toISOString().slice(0, 10) === value ? date : null;
}

export function utcDay(timestamp) {
  return Math.floor(timestamp / DAY_MS) * DAY_MS;
}

export function dateKey(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function createWindow({ range = "30", from = "", to = "", now = Date.now(), rows = [] } = {}) {
  const today = utcDay(now);
  let start;
  let end = today + DAY_MS;
  if (range === "custom") {
    start = parseDay(from);
    const last = parseDay(to);
    if (start === null || last === null) return { error: "Choose a valid start and end date." };
    if (start > last) return { error: "The start date must be before the end date." };
    if (last > today) return { error: "Choose an end date no later than today (UTC)." };
    end = last + DAY_MS;
  } else if (range === "all") {
    start = rows.reduce((earliest, row) => row.timestamp !== null && row.timestamp <= now ? Math.min(earliest, utcDay(row.timestamp)) : earliest, today);
  } else {
    const days = [7, 30, 90].includes(Number(range)) ? Number(range) : 30;
    start = today - (days - 1) * DAY_MS;
  }
  const days = Math.round((end - start) / DAY_MS);
  const bucketDays = days <= 90 ? 1 : Math.ceil(days / 90 / 7) * 7;
  return { start, end, days, bucketDays, from: dateKey(start), to: dateKey(end - DAY_MS), error: "" };
}

export function analyzeBooths(booths, options = {}) {
  const now = options.now ?? Date.now();
  const allRows = normalizeBooths(booths);
  const scoped = allRows.filter((row) => (!options.eventId || row.eventId === options.eventId) && (!options.communityId || row.communityId === options.communityId));
  const window = createWindow({ ...options, now, rows: scoped });
  const inRange = (row) => row.timestamp !== null && row.timestamp >= window.start && row.timestamp < window.end && row.timestamp <= now;
  const rows = window.error ? [] : scoped.filter((row) => (options.range === "all" && row.timestamp === null) || inRange(row));
  rows.sort((a, b) => (b.timestamp ?? -Infinity) - (a.timestamp ?? -Infinity));
  const series = [];
  if (!window.error) {
    for (let timestamp = window.start; timestamp < window.end; timestamp += window.bucketDays * DAY_MS) {
      const last = Math.min(window.end, timestamp + window.bucketDays * DAY_MS) - DAY_MS;
      series.push({ date: dateKey(timestamp), endDate: dateKey(last), uploads: 0, bytes: 0, sizeSamples: 0 });
    }
    for (const row of rows) {
      if (!inRange(row)) continue;
      const bucket = series[Math.floor((row.timestamp - window.start) / (window.bucketDays * DAY_MS))];
      bucket.uploads += 1;
      if (row.fileSize !== null) { bucket.bytes += row.fileSize; bucket.sizeSamples += 1; }
    }
  }
  const statuses = new Map();
  const storage = new Map();
  for (const row of rows) {
    statuses.set(row.status, (statuses.get(row.status) || 0) + 1);
    const key = row.communityId || row.communityName || "unknown";
    if (!storage.has(key)) storage.set(key, { id: key, name: row.communityName || row.communityId || "Community", bytes: 0, uploads: 0, sizeSamples: 0 });
    const entry = storage.get(key);
    entry.uploads += 1;
    if (row.fileSize !== null) { entry.bytes += row.fileSize; entry.sizeSamples += 1; }
  }
  const sizes = rows.map((row) => row.fileSize).filter((value) => value !== null);
  const bytes = sizes.reduce((sum, value) => sum + value, 0);
  const metrics = Object.fromEntries(Object.keys(METRICS).map((key) => {
    const values = rows.map((row) => row.stats[key]).filter((value) => value !== null);
    return [key, { samples: values.length, average: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null, maximum: values.length ? values.reduce((max, value) => Math.max(max, value), 0) : null }];
  }));
  return {
    rows, window, series, metrics,
    retainedCount: allRows.length,
    scopedCount: scoped.length,
    missingDates: scoped.filter((row) => row.timestamp === null).length,
    futureDates: scoped.filter((row) => row.timestamp !== null && row.timestamp > now).length,
    statuses: [...statuses].map(([name, value]) => ({ name, value, color: STATUS_COLORS[name] || "#79bfff" })).sort((a, b) => b.value - a.value),
    storage: [...storage.values()].sort((a, b) => b.bytes - a.bytes),
    totals: { uploads: rows.length, active: rows.filter((row) => row.status === "active").length, bytes, sizeSamples: sizes.length, averageBytes: sizes.length ? bytes / sizes.length : null }
  };
}

export function metricBudgets(row, events) {
  if (!row) return [];
  const event = (Array.isArray(events) ? events : []).find((item) => item && String(item.id) === row.eventId);
  return Object.entries(METRICS).filter(([, metric]) => metric.limit).map(([key, metric]) => {
    const value = row.stats[key];
    const limit = numberOrNull(event?.limits?.[metric.limit]);
    return { key, ...metric, value, limit, percent: value !== null && limit !== null && limit > 0 ? value / limit * 100 : null, exceeded: value !== null && limit !== null && value > limit };
  });
}

export function formatStorage(value) {
  if (value === null || value === undefined) return "Not reported";
  const number = numberOrNull(value);
  if (number === null) return "Not reported";
  if (number === 0) return "0 B";
  const unit = Math.max(0, Math.min(4, Math.floor(Math.log(number) / Math.log(1024))));
  return `${(number / 1024 ** unit).toLocaleString(undefined, { maximumFractionDigits: unit > 1 ? 1 : 0 })} ${["B", "KB", "MB", "GB", "TB"][unit]}`;
}

export function formatMetric(value, key) {
  if (value === null || value === undefined) return "Not reported";
  return `${Number(value).toLocaleString(undefined, { maximumFractionDigits: METRICS[key]?.unit ? 1 : 0 })}${METRICS[key]?.unit ? ` ${METRICS[key].unit}` : ""}`;
}

export function csvCell(value) {
  let text = value == null ? "" : String(value);
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function boothsCsv(rows, context = {}) {
  const headers = ["Upload ID", "Booth", "Community", "Event ID", "Version", "Uploaded at (UTC)", "Current status", "Archive bytes", ...Object.values(METRICS).map((metric) => `${metric.label}${metric.unit ? ` (${metric.unit})` : ""}`), "SDK version", "Limits bypassed"];
  const values = rows.map((row) => [row.booth.id, row.name, row.communityName || row.communityId, row.eventId, row.version, row.timestamp === null ? "" : new Date(row.timestamp).toISOString(), row.status, row.fileSize, ...Object.keys(METRICS).map((key) => row.stats[key]), row.booth.sdkVersion, row.booth.limitsBypassed === true ? "Yes" : "No"]);
  const metadata = Object.entries(context);
  headers.push(...metadata.map(([label]) => label));
  values.forEach((cells) => cells.push(...metadata.map(([, value]) => value)));
  return `\uFEFF${[headers, ...values].map((cells) => cells.map(csvCell).join(",")).join("\r\n")}\r\n`;
}