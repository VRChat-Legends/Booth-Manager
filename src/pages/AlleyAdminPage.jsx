import { useCallback, useEffect, useMemo, useState } from "react";
import * as api from "../lib/api.js";
import * as audio from "../lib/audio.js";
import { AlleyBoothRow } from "./AlleyDashboardPage.jsx";

export default function AlleyAdminPage({ cfg }) {
  const isStaff = cfg.alleyStaff === true;
  const [tab, setTab] = useState("applications");
  const [error, setError] = useState("");
  const [counts, setCounts] = useState({ pending: 0, communities: 0, booths: 0 });

  useEffect(() => {
    if (!isStaff) return;
    (async () => {
      const [apps, comms, booths] = await Promise.all([
        api.alley("/api/admin/applications?status=pending"),
        api.alley("/api/admin/communities"),
        api.alley("/api/admin/booths")
      ]);
      setCounts({
        pending: apps.data?.applications?.length || 0,
        communities: comms.data?.communities?.length || 0,
        booths: booths.data?.booths?.length || 0
      });
    })();
  }, [isStaff, tab]);

  if (!isStaff) {
    return (
      <div className="page">
        <div className="warnbox">The Alley Admin console requires a staff account.</div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="pagehead row">
        <div className="grow">
          <h1>Alley Admin</h1>
          <div className="sub">Staff console for the Legends Alley service</div>
        </div>
        <button className="ghost small" onClick={() => api.openExternal("https://vrchatlegends.com/alley/admin")}>Open on the website</button>
      </div>

      <div className="stats mb16" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <div className="stat"><div className="v">{counts.pending}</div><div className="l">Pending applications</div></div>
        <div className="stat"><div className="v">{counts.communities}</div><div className="l">Communities</div></div>
        <div className="stat"><div className="v">{counts.booths}</div><div className="l">Booth uploads</div></div>
      </div>

      <div className="tabs">
        {[["applications", "Applications"], ["communities", "Communities"], ["events", "Events"], ["booths", "Booths"]].map(([id, label]) => (
          <div key={id} className={`tab${tab === id ? " active" : ""}`} onClick={() => setTab(id)}>
            {label}{id === "applications" && counts.pending > 0 && <span className="count">{counts.pending}</span>}
          </div>
        ))}
      </div>

      {tab === "applications" && <Applications />}
      {tab === "communities" && <Communities />}
      {tab === "events" && <Events />}
      {tab === "booths" && <StaffBooths />}
    </div>
  );
}

/* ---------------- applications ---------------- */

function Applications() {
  const [status, setStatus] = useState("pending");
  const [apps, setApps] = useState(null);
  const [rejecting, setRejecting] = useState(null); // app object
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setApps(null);
    const r = await api.alley(`/api/admin/applications?status=${status}`);
    setApps(r.data?.applications || []);
  }, [status]);

  useEffect(() => { load(); }, [load]);

  const approve = async (id) => {
    setBusy(true);
    const r = await api.alley(`/api/admin/applications/${encodeURIComponent(id)}/approve`, { method: "POST" });
    setBusy(false);
    if (r.status === 200) { audio.success(); load(); }
  };

  const reject = async () => {
    if (!rejecting) return;
    setBusy(true);
    const r = await api.alley(`/api/admin/applications/${encodeURIComponent(rejecting.id)}/reject`, {
      method: "POST", json: { note: note.trim() }
    });
    setBusy(false);
    setRejecting(null);
    setNote("");
    if (r.status === 200) load();
  };

  return (
    <div>
      <div className="row mb12">
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 170 }}>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
        <button className="small" onClick={load}>Refresh</button>
      </div>

      {!apps && <div className="skeleton" style={{ height: 140 }} />}
      {apps && apps.length === 0 && <div className="card sub">No {status} applications.</div>}

      <div className="stagger" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {(apps || []).map((a) => (
          <div className="listrow" key={a.id} style={{ alignItems: "flex-start" }}>
            <div className="avatar">
              {a.discordAvatar ? <img src={a.discordAvatar} alt="" /> : (a.communityName || "?")[0]?.toUpperCase()}
            </div>
            <div className="grow">
              <div className="title">{a.communityName}</div>
              <div className="meta">
                {a.discordUsername} ({a.discordUserId}) | {api.timeAgo(a.createdAt)}
                {a.groupId ? ` | ${a.groupId}` : ""}
              </div>
              {a.description && <div className="small muted mt8" style={{ maxWidth: 640 }}>{a.description}</div>}
              {a.reason && <div className="tiny muted mt8">Why: {a.reason}</div>}
              {status !== "pending" && (a.reviewedBy || a.reviewNote) && (
                <div className="tiny mt8" style={{ color: status === "approved" ? "var(--teal)" : "var(--danger)" }}>
                  {status} by {a.reviewedBy || "?"}{a.reviewNote ? `: ${a.reviewNote}` : ""}
                </div>
              )}
            </div>
            {status === "pending" && (
              <div className="row">
                <button className="primary small" disabled={busy} onClick={() => approve(a.id)}>Approve</button>
                <button className="danger small" disabled={busy} onClick={() => setRejecting(a)}>Reject</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {rejecting && (
        <div className="modal-scrim" onClick={() => setRejecting(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Reject {rejecting.communityName}</h2>
            <label className="field"><span>Note (sent to the applicant)</span>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason for rejection..." />
            </label>
            <div className="actions">
              <button onClick={() => setRejecting(null)}>Cancel</button>
              <button className="danger" disabled={busy} onClick={reject}>Reject application</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- communities ---------------- */

function Communities() {
  const [comms, setComms] = useState(null);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState(null); // community object
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const r = await api.alley("/api/admin/communities");
    setComms(r.data?.communities || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const list = comms || [];
    const query = q.trim().toLowerCase();
    return query ? list.filter((c) => (c.name || "").toLowerCase().includes(query) || (c.ownerUsername || "").toLowerCase().includes(query)) : list;
  }, [comms, q]);

  const open = (c) => {
    setEditing(c);
    setMsg("");
    setDraft({
      name: c.name || "",
      description: c.description || "",
      inviteUrl: c.inviteUrl || "",
      groupId: c.groupId || "",
      socials: (c.socials || []).join("\n"),
      limitsBypass: !!c.limitsBypass,
      ownerDiscordId: c.ownerDiscordId || "",
      managerDiscordId: c.managerDiscordId || ""
    });
  };

  const save = async () => {
    setBusy(true);
    const r = await api.alley(`/api/admin/communities/${encodeURIComponent(editing.id)}`, {
      method: "PATCH",
      json: {
        name: draft.name.trim(),
        description: draft.description.trim(),
        inviteUrl: draft.inviteUrl.trim(),
        groupId: draft.groupId.trim(),
        socials: draft.socials.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).slice(0, 5),
        limitsBypass: draft.limitsBypass,
        ownerDiscordId: draft.ownerDiscordId.trim(),
        managerDiscordId: draft.managerDiscordId.trim()
      }
    });
    setBusy(false);
    if (r.status === 200) { audio.success(); setEditing(null); load(); }
    else setMsg(r.error || "Save failed");
  };

  const uploadLogo = async () => {
    const pick = await api.openImageDialog({});
    if (!pick.ok) return;
    const f = pick.files[0];
    const ext = f.name.toLowerCase().split(".").pop();
    const ct = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    setBusy(true);
    const r = await api.alley(`/api/admin/communities/${encodeURIComponent(editing.id)}/logo`, {
      method: "PUT", bufferBase64: f.dataBase64, contentType: ct
    });
    setBusy(false);
    setMsg(r.status === 200 ? "Logo updated." : (r.error || "Upload failed"));
    if (r.status === 200) load();
  };

  return (
    <div>
      <div className="row mb12">
        <input type="text" placeholder="Search communities..." value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 320 }} />
        <span className="muted tiny">{filtered.length} shown</span>
      </div>
      {!comms && <div className="skeleton" style={{ height: 140 }} />}
      <div className="stagger" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {filtered.map((c) => (
          <CommunityRow key={c.id} c={c} onEdit={() => open(c)} />
        ))}
      </div>

      {editing && draft && (
        <div className="modal-scrim" onClick={() => setEditing(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Edit {editing.name}</h2>
            <div className="grid2">
              <label className="field"><span>Name</span>
                <input type="text" maxLength={48} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </label>
              <label className="field"><span>VRChat group ID</span>
                <input type="text" value={draft.groupId} onChange={(e) => setDraft({ ...draft, groupId: e.target.value })} />
              </label>
            </div>
            <label className="field"><span>Description</span>
              <textarea maxLength={500} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
            </label>
            <div className="grid2">
              <label className="field"><span>Invite URL</span>
                <input type="url" value={draft.inviteUrl} onChange={(e) => setDraft({ ...draft, inviteUrl: e.target.value })} />
              </label>
              <label className="field"><span>Socials (one per line)</span>
                <textarea value={draft.socials} onChange={(e) => setDraft({ ...draft, socials: e.target.value })} style={{ minHeight: 40 }} />
              </label>
            </div>
            <div className="grid2">
              <label className="field"><span>Owner Discord ID</span>
                <input type="text" value={draft.ownerDiscordId} onChange={(e) => setDraft({ ...draft, ownerDiscordId: e.target.value })} />
              </label>
              <label className="field"><span>Manager Discord ID</span>
                <input type="text" value={draft.managerDiscordId} onChange={(e) => setDraft({ ...draft, managerDiscordId: e.target.value })} />
              </label>
            </div>
            <label className="row clickable mb8" style={{ userSelect: "none" }}>
              <input type="checkbox" style={{ width: "auto" }} checked={draft.limitsBypass}
                onChange={(e) => setDraft({ ...draft, limitsBypass: e.target.checked })} />
              <span className="small">Limits bypass (booth uploads skip event limit checks)</span>
            </label>
            {msg && <div className="warnbox mb8">{msg}</div>}
            <div className="actions">
              <button onClick={uploadLogo} disabled={busy}>Upload logo...</button>
              <span style={{ flex: 1 }} />
              <button onClick={() => setEditing(null)}>Cancel</button>
              <button className="primary" onClick={save} disabled={busy}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CommunityRow({ c, onEdit }) {
  const [logo, setLogo] = useState("");
  useEffect(() => {
    if (c.logoUrl) api.alleyImageUrl(c.logoUrl).then(setLogo);
  }, [c.logoUrl]);
  return (
    <div className="listrow">
      <div className="avatar square">{logo ? <img src={logo} alt="" /> : (c.name || "?")[0]?.toUpperCase()}</div>
      <div className="grow">
        <div className="title">{c.name} {c.limitsBypass && <span className="pill yellow" style={{ marginLeft: 6 }}>BYPASS</span>}</div>
        <div className="meta">
          owner {c.ownerUsername || c.ownerDiscordId || "?"}
          {c.managerUsername || c.managerDiscordId ? ` | manager ${c.managerUsername || c.managerDiscordId}` : ""}
          {c.active === false ? " | inactive" : ""}
        </div>
      </div>
      <button className="small" onClick={onEdit}>Edit</button>
    </div>
  );
}

/* ---------------- events ---------------- */

const EMPTY_EVENT = {
  name: "", slug: "", startsAt: "", endsAt: "", uploadDeadline: "",
  acceptingBooths: false, minSdkVersion: "", limitsJson: ""
};

function Events() {
  const [events, setEvents] = useState(null);
  const [editing, setEditing] = useState(null); // { id? } null=closed, {}=new
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = useCallback(async () => {
    const r = await api.alley("/api/events");
    setEvents(r.data?.events || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const toLocal = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const toIso = (local) => (local ? new Date(local).toISOString() : "");

  const open = (ev) => {
    setMsg("");
    setEditing(ev || {});
    setDraft(ev ? {
      name: ev.name || "", slug: ev.slug || "",
      startsAt: toLocal(ev.startsAt), endsAt: toLocal(ev.endsAt),
      uploadDeadline: toLocal(ev.uploadDeadline),
      acceptingBooths: !!ev.acceptingBooths,
      minSdkVersion: ev.minSdkVersion || "",
      limitsJson: ev.limits ? JSON.stringify(ev.limits, null, 2) : ""
    } : { ...EMPTY_EVENT });
  };

  const save = async () => {
    let limits;
    if (draft.limitsJson.trim()) {
      try { limits = JSON.parse(draft.limitsJson); } catch { setMsg("Limits JSON is invalid."); return; }
    }
    const body = {
      name: draft.name.trim(),
      slug: draft.slug.trim(),
      startsAt: toIso(draft.startsAt),
      endsAt: toIso(draft.endsAt),
      uploadDeadline: toIso(draft.uploadDeadline),
      acceptingBooths: draft.acceptingBooths,
      minSdkVersion: draft.minSdkVersion.trim()
    };
    if (limits) body.limits = limits;
    setBusy(true);
    const r = editing.id
      ? await api.alley(`/api/events/${encodeURIComponent(editing.id)}`, { method: "PATCH", json: body })
      : await api.alley("/api/events", { method: "POST", json: body });
    setBusy(false);
    if (r.status === 200 || r.status === 201) { audio.success(); setEditing(null); load(); }
    else setMsg(r.error || "Save failed");
  };

  const remove = async (ev, deleteBooths) => {
    setBusy(true);
    const r = await api.alley(`/api/events/${encodeURIComponent(ev.id)}?deleteBooths=${deleteBooths ? "true" : "false"}`, { method: "DELETE" });
    setBusy(false);
    setConfirmDelete(null);
    if (r.status === 200) load();
  };

  return (
    <div>
      <div className="row mb12">
        <button className="primary" onClick={() => open(null)}>New event</button>
        <button className="small" onClick={load}>Refresh</button>
      </div>
      {!events && <div className="skeleton" style={{ height: 120 }} />}
      {events && events.length === 0 && <div className="card sub">No events yet.</div>}
      <div className="stagger" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {(events || []).map((ev) => (
          <div className="listrow" key={ev.id}>
            <div className="grow">
              <div className="title">{ev.name} <span className="muted tiny">{ev.slug}</span></div>
              <div className="meta">
                {ev.uploadDeadline ? `deadline ${api.formatDate(ev.uploadDeadline)}` : "no deadline"}
                {ev.limits ? ` | ${Number(ev.limits.maxTriangles || 0).toLocaleString()} tris | ${ev.limits.maxBuildSizeMB} MB` : ""}
                {ev.minSdkVersion ? ` | SDK ${ev.minSdkVersion}+` : ""}
              </div>
            </div>
            <span className={`pill ${ev.acceptingBooths ? "teal" : "gray"}`}>{ev.acceptingBooths ? "ACCEPTING" : "CLOSED"}</span>
            <button className="small" onClick={() => open(ev)}>Edit</button>
            <button className="danger small" onClick={() => setConfirmDelete(ev)}>Delete</button>
          </div>
        ))}
      </div>

      {editing !== null && draft && (
        <div className="modal-scrim" onClick={() => setEditing(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editing.id ? `Edit ${editing.name}` : "New event"}</h2>
            <div className="grid2">
              <label className="field"><span>Name</span>
                <input type="text" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </label>
              <label className="field"><span>Slug</span>
                <input type="text" value={draft.slug} onChange={(e) => setDraft({ ...draft, slug: e.target.value })} />
              </label>
            </div>
            <div className="grid2">
              <label className="field"><span>Starts</span>
                <input type="datetime-local" value={draft.startsAt} onChange={(e) => setDraft({ ...draft, startsAt: e.target.value })} />
              </label>
              <label className="field"><span>Ends</span>
                <input type="datetime-local" value={draft.endsAt} onChange={(e) => setDraft({ ...draft, endsAt: e.target.value })} />
              </label>
            </div>
            <div className="grid2">
              <label className="field"><span>Upload deadline</span>
                <input type="datetime-local" value={draft.uploadDeadline} onChange={(e) => setDraft({ ...draft, uploadDeadline: e.target.value })} />
              </label>
              <label className="field"><span>Min SDK version</span>
                <input type="text" placeholder="1.1.0" value={draft.minSdkVersion} onChange={(e) => setDraft({ ...draft, minSdkVersion: e.target.value })} />
              </label>
            </div>
            <label className="row clickable mb8" style={{ userSelect: "none" }}>
              <input type="checkbox" style={{ width: "auto" }} checked={draft.acceptingBooths}
                onChange={(e) => setDraft({ ...draft, acceptingBooths: e.target.checked })} />
              <span className="small">Accepting booth uploads</span>
            </label>
            <label className="field"><span>Limits (JSON, optional)</span>
              <textarea style={{ fontFamily: "Consolas, monospace", fontSize: 12, minHeight: 120 }}
                placeholder='{ "maxTriangles": 30000, "maxBuildSizeMB": 25, ... }'
                value={draft.limitsJson} onChange={(e) => setDraft({ ...draft, limitsJson: e.target.value })} />
            </label>
            {msg && <div className="errbox mb8">{msg}</div>}
            <div className="actions">
              <button onClick={() => setEditing(null)}>Cancel</button>
              <button className="primary" onClick={save} disabled={busy}>{editing.id ? "Save" : "Create"}</button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="modal-scrim" onClick={() => setConfirmDelete(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Delete {confirmDelete.name}?</h2>
            <p className="muted small">Booth uploads tied to this event can be kept or deleted with it.</p>
            <div className="actions">
              <button onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button onClick={() => remove(confirmDelete, false)} disabled={busy}>Delete, keep booths</button>
              <button className="danger" onClick={() => remove(confirmDelete, true)} disabled={busy}>Delete + booths</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- staff booths ---------------- */

function StaffBooths() {
  const [booths, setBooths] = useState(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    api.alley("/api/admin/booths").then((r) => setBooths(r.data?.booths || []));
  }, []);

  const filtered = useMemo(() => {
    const list = booths || [];
    const query = q.trim().toLowerCase();
    return query ? list.filter((b) => (b.communityName || "").toLowerCase().includes(query)) : list;
  }, [booths, q]);

  const activeCount = (booths || []).filter((b) => b.status === "active").length;

  const download = async (b) => {
    const save = await api.saveFileDialog({
      defaultName: `${b.communitySlug || b.id}-v${b.version}.zip`,
      filters: [{ name: "Booth package", extensions: ["zip"] }]
    });
    if (!save.ok) return;
    const res = await window.boothApi.alleyImage(`/api/admin/booths/${encodeURIComponent(b.id)}/download`);
    if (!res?.dataBase64) return;
    await api.writeFile(save.path, res.dataBase64);
    audio.success();
    api.showInFolder(save.path);
  };

  return (
    <div>
      <div className="row mb12">
        <input type="text" placeholder="Search by community..." value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 320 }} />
        <span className="muted tiny">{activeCount} active of {(booths || []).length} uploads</span>
      </div>
      {!booths && <div className="skeleton" style={{ height: 140 }} />}
      {booths && filtered.length === 0 && <div className="card sub">No booth uploads.</div>}
      <div className="stagger" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {filtered.slice().sort((a, b) => String(b.uploadedAt).localeCompare(String(a.uploadedAt))).map((b) => (
          <AlleyBoothRow
            key={b.id}
            b={{ ...b, prefabName: b.communityName ? `${b.communityName}` : b.prefabName }}
            right={<button className="small" onClick={() => download(b)}>Download</button>}
          />
        ))}
      </div>
    </div>
  );
}
