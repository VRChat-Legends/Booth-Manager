import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeBooths, boothsCsv, createWindow, csvCell, formatStorage, metricBudgets, normalizeBooths, numberOrNull } from "../src/lib/analytics.mjs";
import { loadBoothSnapshot } from "../src/lib/boothData.mjs";

const now = Date.parse("2026-09-05T16:00:00Z");
const booth = (overrides = {}) => ({ id: "upload-1", prefabName: "Booth", communityId: "community-1", eventId: "event-1", version: 1, uploadedAt: "2026-09-05T12:00:00Z", status: "active", fileSize: 1024, stats: { triangles: 12000, buildSizeMB: 8 }, ...overrides });

test("daily charts zero-fill all UTC dates in the chosen range", () => {
  const result = analyzeBooths([booth()], { range: "7", now });
  assert.equal(result.series.length, 7);
  assert.equal(result.series[0].date, "2026-08-30");
  assert.equal(result.series[0].uploads, 0);
  assert.equal(result.series.at(-1).uploads, 1);
  assert.equal(result.series.at(-1).bytes, 1024);
});

test("UTC bucketing honors timezone offsets and exclusive range edges", () => {
  const result = analyzeBooths([booth({ uploadedAt: "2026-08-29T22:30:00-03:00" }), booth({ uploadedAt: "2026-08-30T00:00:00+02:00" }), booth({ uploadedAt: "2026-09-06T00:00:00Z" })], { range: "7", now });
  assert.equal(result.totals.uploads, 1);
  assert.equal(result.series[0].uploads, 1);
  assert.equal(result.futureDates, 1);
});

test("all retained includes undated rows in snapshots but not time charts", () => {
  const result = analyzeBooths([booth(), booth({ uploadedAt: null, fileSize: null })], { range: "all", now });
  assert.equal(result.totals.uploads, 2);
  assert.equal(result.missingDates, 1);
  assert.equal(result.series.reduce((sum, row) => sum + row.uploads, 0), 1);
  assert.equal(result.totals.sizeSamples, 1);
  assert.equal(result.totals.averageBytes, 1024);
});

test("missing numbers stay missing while reported zero is preserved", () => {
  for (const value of [null, undefined, "", " ", false, true, NaN, Infinity, -1, "oops", [], {}]) assert.equal(numberOrNull(value), null);
  assert.equal(numberOrNull("0"), 0);
  const result = analyzeBooths([booth({ stats: { triangles: 0 } }), booth({ stats: { triangles: null } }), booth({ stats: {} })], { now });
  assert.deepEqual(result.metrics.triangles, { samples: 1, average: 0, maximum: 0 });
  assert.equal(result.metrics.vramMB.average, null);
});

test("community and event filters apply to every aggregate", () => {
  const result = analyzeBooths([booth(), booth({ communityId: "other" }), booth({ eventId: "other" })], { communityId: "community-1", eventId: "event-1", now });
  assert.equal(result.retainedCount, 3);
  assert.equal(result.totals.uploads, 1);
  assert.equal(result.statuses[0].value, 1);
  assert.equal(result.storage[0].bytes, 1024);
});

test("legacy duplicate IDs remain independent records", () => {
  const rows = normalizeBooths([booth(), booth()]);
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0].key, rows[1].key);
});

test("custom windows validate dates and include the entire end day", () => {
  assert.ok(createWindow({ range: "custom", from: "2026-02-30", to: "2026-09-05", now }).error);
  assert.ok(createWindow({ range: "custom", from: "2026-09-05", to: "2026-09-01", now }).error);
  assert.ok(createWindow({ range: "custom", from: "2026-09-01", to: "2026-09-06", now }).error);
  const result = analyzeBooths([booth()], { range: "custom", from: "2026-09-05", to: "2026-09-05", now });
  assert.equal(result.series.length, 1);
  assert.equal(result.totals.uploads, 1);
});

test("large history uses bounded time buckets without dropping uploads", () => {
  const result = analyzeBooths([booth({ uploadedAt: "2010-01-01T00:00:00Z" }), booth()], { range: "all", now });
  assert.ok(result.series.length <= 90);
  assert.equal(result.series.reduce((sum, row) => sum + row.uploads, 0), 2);
  assert.ok(result.window.bucketDays > 1);
});

test("bad array entries and empty datasets are safe", () => {
  assert.equal(normalizeBooths([null, false, [], "value", booth()]).length, 1);
  const result = analyzeBooths(undefined, { now });
  assert.equal(result.totals.uploads, 0);
  assert.equal(result.totals.averageBytes, null);
  assert.equal(result.series.length, 30);
});

test("budget checks use the matching event and do not invent limits", () => {
  const row = normalizeBooths([booth()])[0];
  const budgets = metricBudgets(row, [{ id: "other", limits: { maxTriangles: 1 } }, { id: "event-1", limits: { maxTriangles: 10000, maxBuildSizeMB: 0 } }]);
  assert.equal(budgets[0].percent, 120);
  assert.equal(budgets[0].exceeded, true);
  assert.equal(budgets[1].percent, null);
  assert.equal(budgets[1].exceeded, true);
  assert.equal(budgets[2].limit, null);
});

test("CSV escapes quotes, newlines and spreadsheet formula injection", () => {
  assert.equal(csvCell('hello,"world"'), '"hello,""world"""');
  for (const value of ["=HYPERLINK(1)", "+cmd", "-cmd", "@SUM(1)", "  =1", "\tvalue", "\nvalue"]) assert.ok(csvCell(value).startsWith('"\''));
  const csv = boothsCsv(normalizeBooths([booth({ prefabName: "=1+1", stats: {} })]));
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes('"\'=1+1"'));
  assert.ok(csv.includes("2026-09-05T12:00:00.000Z"));
  assert.ok(csv.endsWith("\r\n"));
});

test("storage formatting handles missing values, zero and gigabytes", () => {
  assert.equal(formatStorage(null), "Not reported");
  assert.equal(formatStorage(0), "0 B");
  assert.equal(formatStorage(1024 ** 3), "1 GB");
  assert.ok(!formatStorage(0.5).includes("undefined"));
});

test("export metadata preserves the report scope without enabling formulas", () => {
  const csv = boothsCsv(normalizeBooths([booth()]), { "Report scope": "My community", "Record search": "=query" });
  assert.ok(csv.split("\r\n")[0].endsWith('"Report scope","Record search"'));
  assert.ok(csv.includes('"My community","\'=query"'));
});

test("nonstaff cannot request cross-community data", async () => {
  let calls = 0;
  await assert.rejects(loadBoothSnapshot(() => { calls += 1; }, { scope: "all", isStaff: false }), /Staff access/);
  assert.equal(calls, 0);
});

test("failed uploads and malformed responses are errors, not empty charts", async () => {
  await assert.rejects(loadBoothSnapshot(async () => ({ status: 503, error: "Unavailable" }), { communityId: "c" }), /Unavailable/);
  await assert.rejects(loadBoothSnapshot(async () => ({ status: 200, data: { booths: null } }), { communityId: "c" }), /invalid/);
});

test("optional failures preserve uploads with explicit warnings", async () => {
  const result = await loadBoothSnapshot(async (path) => path === "/api/booths/mine" ? { status: 200, data: { booths: [booth()] } } : { status: 503 }, { communityId: "c" });
  assert.equal(result.booths.length, 1);
  assert.equal(result.events.length, 0);
  assert.equal(result.warnings.length, 1);
});

test("partial lists are disclosed rather than presented as complete", async () => {
  const result = await loadBoothSnapshot(async (path) => path === "/api/admin/booths" ? { status: 200, data: { booths: [booth()], total: 10 } } : { status: 200, data: { events: [], communities: [] } }, { scope: "all", isStaff: true });
  assert.ok(result.warnings.some((warning) => warning.includes("partial")));
});