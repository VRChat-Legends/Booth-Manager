function readArray(response, field, label) {
  if (response?.status !== 200) throw new Error(response?.error || `${label} could not be loaded${response?.status ? ` (HTTP ${response.status})` : ""}.`);
  if (!Array.isArray(response.data?.[field])) throw new Error(`The server returned an invalid ${label.toLowerCase()} response.`);
  return response.data[field].filter((item) => item && typeof item === "object" && !Array.isArray(item));
}

export async function loadBoothSnapshot(request, { scope = "mine", isStaff = false, communityId = "" } = {}) {
  if (scope !== "mine" && scope !== "all") throw new Error("Unknown analytics scope.");
  if (scope === "all" && !isStaff) throw new Error("Staff access is required for all-community analytics.");
  if (scope === "mine" && !communityId) return { booths: [], events: [], communities: [], warnings: [], fetchedAt: Date.now() };
  const tasks = [
    request(scope === "all" ? "/api/admin/booths" : "/api/booths/mine"),
    request("/api/events"),
    scope === "all" ? request("/api/admin/communities") : Promise.resolve({ status: 200, data: { communities: [] } })
  ];
  const [uploads, events, communities] = await Promise.allSettled(tasks);
  if (uploads.status === "rejected") throw uploads.reason;
  const booths = readArray(uploads.value, "booths", "Booth uploads");
  const warnings = [];
  const optional = (result, field, label) => {
    try {
      if (result.status === "rejected") throw result.reason;
      return readArray(result.value, field, label);
    } catch {
      warnings.push(`${label} are unavailable. Upload data is still shown.`);
      return [];
    }
  };
  const payload = uploads.value.data;
  if (payload.hasMore || payload.nextCursor || (Number.isFinite(Number(payload.total)) && Number(payload.total) > booths.length)) warnings.push("The service returned a partial upload list. Charts and exports cover the returned records only.");
  return { booths, events: optional(events, "events", "Event details"), communities: optional(communities, "communities", "Community names"), warnings, fetchedAt: Date.now() };
}