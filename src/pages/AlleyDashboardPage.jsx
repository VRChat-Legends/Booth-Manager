import { useCallback, useEffect, useState } from "react";
import { Download } from "lucide-react";
import * as api from "../lib/api.js";
import * as audio from "../lib/audio.js";

export default function AlleyDashboardPage({ cfg, refreshConfig }) {
  const [me, setMe] = useState(null);
  const [tab, setTab] = useState("overview");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!cfg.alleyToken) return;
    const r = await api.alley("/api/auth/me");
    if (r.status === 200 && r.data) {
      setMe(r.data);
      setError("");
    } else if (r.status === 401 || r.status === 403) {
      setMe(null);
      await refreshConfig();
      setError("Your Alley session expired. Sign in again from the app entrance.");
    } else {
      setError(r.error || "Could not reach the Alley service.");
    }
  }, [cfg.alleyToken, refreshConfig]);

  useEffect(() => { load(); }, [load]);

  const community = me?.community || null;
  const role = me?.staff ? "staff" : (me?.role || "");

  return (
    <div className="page">
      <div className="pagehead row">
        <div className="grow">
          <h1>Community</h1>
          <div className="sub">
            {community ? `${community.name} | signed in as ${role}` : me?.staff ? "Alley staff account (no community)" : "No community linked"}
          </div>
        </div>
        <button className="ghost small" onClick={() => api.openExternal("https://vrchatlegends.com/alley/dashboard")}>Open on the website</button>
      </div>

      {error && <div className="errbox mb12">{error}</div>}

      {!me && !error && <div className="skeleton" style={{ height: 220 }} />}

      {me && !community && (
        <div className="card">
          <div className="sub">
            Your Discord account does not own or manage an approved Alley community.
            {me.staff ? " Staff tools live in the Alley Admin tab." : " Apply at vrchatlegends.com/alley/apply."}
          </div>
        </div>
      )}

      {me && community && (
        <>
          <div className="tabs">
            {["overview", "profile", "team", "booths"].map((t) => (
              <div key={t} className={`tab${tab === t ? " active" : ""}`} onClick={() => setTab(t)}>
                {t === "overview" ? "Overview" : t === "profile" ? "Profile" : t === "team" ? "Team" : "Booths"}
              </div>
            ))}
          </div>
          {tab === "overview" && <Overview me={me} />}
          {tab === "profile" && <Profile me={me} reload={load} />}
          {tab === "team" && <Team me={me} reload={load} />}
          {tab === "booths" && <MyBooths />}
        </>
      )}
    </div>
  );
}

/* ---------------- overview ---------------- */

function Overview({ me }) {
  const [booths, setBooths] = useState(null);
  const [events, setEvents] = useState(null);
  const [logo, setLogo] = useState("");
  const c = me.community;

  useEffect(() => {
    api.alley("/api/booths/mine").then((r) => setBooths(r.data?.booths || []));
    api.alley("/api/events").then((r) => setEvents(r.data?.events || []));
    if (c?.logoUrl) api.alleyImageUrl(c.logoUrl).then(setLogo);
  }, [c?.logoUrl]);

  const active = (booths || []).find((b) => b.status === "active");
  const ev = (events || [])[0];
  const deadline = ev?.uploadDeadline ? Date.parse(ev.uploadDeadline) : 0;
  const daysLeft = deadline ? Math.max(0, Math.ceil((deadline - Date.now()) / 86400000)) : null;

  return (
    <div className="stagger" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="card row gap14">
        <div className="avatar square" style={{ width: 64, height: 64, fontSize: 24 }}>
          {logo ? <img src={logo} alt="" /> : (c.name || "?")[0]}
        </div>
        <div className="grow">
          <div style={{ fontSize: 18, fontWeight: 700 }}>{c.name}</div>
          <div className="muted small">
            owner {c.ownerUsername || c.ownerDiscordId || "?"}
            {c.managerUsername ? ` | booth manager ${c.managerUsername}` : ""}
            {c.groupId ? ` | ${c.groupId}` : ""}
          </div>
        </div>
        {c.limitsBypass && <span className="pill yellow">LIMITS BYPASS</span>}
      </div>

      <div className="stats">
        <div className="stat"><div className="v">{booths ? booths.length : "-"}</div><div className="l">Booth uploads</div></div>
        <div className="stat"><div className="v">{active ? `v${active.version}` : "-"}</div><div className="l">Active version</div></div>
        <div className="stat"><div className="v">{c.teamMembers?.length || 0}</div><div className="l">Team members</div></div>
        <div className="stat"><div className="v">{daysLeft === null ? "-" : daysLeft}</div><div className="l">Days until deadline</div></div>
      </div>

      {ev && (
        <div className="card">
          <div className="row">
            <h3 style={{ margin: 0 }}>{ev.name}</h3>
            <span className={`pill right ${ev.acceptingBooths ? "teal" : "gray"}`}>
              {ev.acceptingBooths ? "ACCEPTING BOOTHS" : "CLOSED"}
            </span>
          </div>
          <div className="muted small mt8">
            {ev.uploadDeadline ? `Upload deadline ${api.formatDate(ev.uploadDeadline)}` : "No deadline announced"}
            {daysLeft !== null && daysLeft > 0 ? ` (${daysLeft} day${daysLeft === 1 ? "" : "s"} left)` : ""}
          </div>
          {ev.limits && (
            <div className="muted tiny mt8">
              Limits: {ev.limits.maxTriangles?.toLocaleString()} tris | {ev.limits.maxBuildSizeMB} MB build |
              {" "}{ev.limits.maxMaterialSlots} materials | {ev.limits.maxUniqueTextures} textures
            </div>
          )}
        </div>
      )}

      <div className="card">
        <h3>Getting your booth in</h3>
        <div className="help">
          1. Install the Legends Alley SDK from the VCC (vrchatlegends.com/vpm/index.json).<br />
          2. Build your booth on the prefab inside the event limits.<br />
          3. Sign in inside Unity and upload; your latest active version shows up here and on the website dashboard.
        </div>
      </div>
    </div>
  );
}

/* ---------------- profile ---------------- */

function Profile({ me, reload }) {
  const c = me.community;
  const canEdit = me.role === "owner" || me.staff;
  const [desc, setDesc] = useState(c.description || "");
  const [invite, setInvite] = useState(c.inviteUrl || "");
  const [socials, setSocials] = useState((c.socials || []).join("\n"));
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    const r = await api.alley("/api/communities/mine", {
      method: "PATCH",
      json: {
        description: desc.trim(),
        inviteUrl: invite.trim(),
        socials: socials.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).slice(0, 5)
      }
    });
    setBusy(false);
    setMsg(r.status === 200 ? { ok: true, t: "Profile saved." } : { ok: false, t: r.error || "Save failed" });
    if (r.status === 200) { audio.success(); reload(); }
  };

  const uploadLogo = async () => {
    const pick = await api.openImageDialog({});
    if (!pick.ok) return;
    const f = pick.files[0];
    if (f.dataBase64.length * 0.75 > 2 * 1024 * 1024) {
      setMsg({ ok: false, t: "Logo must be 2 MB or smaller." });
      return;
    }
    const ext = f.name.toLowerCase().split(".").pop();
    const ct = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    setBusy(true);
    const r = await api.alley("/api/communities/mine/logo", {
      method: "PUT", bufferBase64: f.dataBase64, contentType: ct
    });
    setBusy(false);
    setMsg(r.status === 200 ? { ok: true, t: "Logo updated." } : { ok: false, t: r.error || "Upload failed" });
    if (r.status === 200) { audio.success(); reload(); }
  };

  return (
    <div className="card" style={{ maxWidth: 640 }}>
      {!canEdit && <div className="warnbox mb12">Only the community owner can edit the profile. Your {me.role || "team"} role has read-only access here.</div>}
      <label className="field"><span>Description (max 500)</span>
        <textarea maxLength={500} value={desc} disabled={!canEdit} onChange={(e) => setDesc(e.target.value)} />
      </label>
      <label className="field"><span>Discord invite URL</span>
        <input type="url" placeholder="https://discord.gg/..." value={invite} disabled={!canEdit} onChange={(e) => setInvite(e.target.value)} />
      </label>
      <label className="field"><span>Social links (one per line, max 5)</span>
        <textarea value={socials} disabled={!canEdit} onChange={(e) => setSocials(e.target.value)} />
      </label>
      <div className="row">
        <button className="primary" onClick={save} disabled={busy || !canEdit}>Save profile</button>
        <button onClick={uploadLogo} disabled={busy || !canEdit}>Upload logo...</button>
        {msg && <span className={msg.ok ? "teal small" : "danger-text small"}>{msg.t}</span>}
      </div>
    </div>
  );
}

/* ---------------- team ---------------- */

function Team({ me, reload }) {
  const c = me.community;
  const canEdit = me.role === "owner" || me.staff;
  const [managerId, setManagerId] = useState("");
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const setManager = async () => {
    if (!managerId.trim()) return;
    setBusy(true);
    const r = await api.alley("/api/communities/mine/manager", { method: "PUT", json: { discordId: managerId.trim() } });
    setBusy(false);
    setMsg(r.status === 200 ? { ok: true, t: "Booth manager set." } : { ok: false, t: r.error || "Failed" });
    if (r.status === 200) { setManagerId(""); audio.success(); reload(); }
  };

  const removeManager = async () => {
    setBusy(true);
    const r = await api.alley("/api/communities/mine/manager", { method: "DELETE" });
    setBusy(false);
    setMsg(r.status === 200 ? { ok: true, t: "Booth manager removed." } : { ok: false, t: r.error || "Failed" });
    if (r.status === 200) reload();
  };

  const syncRoles = async () => {
    setBusy(true);
    const r = await api.alley("/api/communities/mine/sync-roles", { method: "POST" });
    setBusy(false);
    setMsg(r.status === 200 ? { ok: true, t: "Discord roles synced." } : { ok: false, t: r.error || "Sync failed (10 minute cooldown applies)" });
  };

  return (
    <div className="stagger" style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 640 }}>
      <div className="card">
        <h3>Owner</h3>
        <div className="listrow">
          <div className="avatar">{(c.ownerUsername || "?")[0]?.toUpperCase()}</div>
          <div className="grow">
            <div className="title">{c.ownerUsername || "Unknown"}</div>
            <div className="meta">{c.ownerDiscordId}</div>
          </div>
          <span className="pill teal">OWNER</span>
        </div>
      </div>

      <div className="card">
        <h3>Booth manager</h3>
        {c.managerDiscordId ? (
          <div className="listrow">
            <div className="avatar">{(c.managerUsername || "?")[0]?.toUpperCase()}</div>
            <div className="grow">
              <div className="title">{c.managerUsername || c.managerDiscordId}</div>
              <div className="meta">{c.managerDiscordId}</div>
            </div>
            {canEdit && <button className="danger small" onClick={removeManager} disabled={busy}>Remove</button>}
          </div>
        ) : (
          <div className="muted small mb8">No booth manager set. They can upload booths and view the dashboard, but not edit the profile.</div>
        )}
        {canEdit && (
          <div className="row mt8">
            <input type="text" placeholder="Discord user ID" value={managerId} onChange={(e) => setManagerId(e.target.value)} />
            <button onClick={setManager} disabled={busy || !managerId.trim()}>Set manager</button>
          </div>
        )}
      </div>

      <div className="card">
        <div className="row mb8">
          <h3 style={{ margin: 0 }}>Team members</h3>
          <span className="muted tiny right">{c.teamMembers?.length || 0} / 8</span>
        </div>
        {(c.teamMembers || []).length === 0 && <div className="muted small">No team members listed.</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {(c.teamMembers || []).map((m, i) => (
            <div className="listrow" key={`${m.discordId}${i}`}>
              <div className="avatar" style={{ width: 32, height: 32, fontSize: 13 }}>{(m.name || "?")[0]?.toUpperCase()}</div>
              <div className="grow">
                <div className="title" style={{ fontSize: 12.5 }}>{m.name || "Unnamed"}</div>
                <div className="meta">{m.discordId}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="row mt12">
          <button onClick={syncRoles} disabled={busy}>Sync Discord roles</button>
          {msg && <span className={msg.ok ? "teal small" : "danger-text small"}>{msg.t}</span>}
        </div>
      </div>
    </div>
  );
}

/* ---------------- booths ---------------- */

function MyBooths() {
  const [booths, setBooths] = useState(null);
  useEffect(() => {
    api.alley("/api/booths/mine").then((r) => setBooths(r.data?.booths || []));
  }, []);

  return (
    <div className="stagger" style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 760 }}>
      {!booths && <div className="skeleton" style={{ height: 160 }} />}
      {booths && booths.length === 0 && (
        <div className="card sub">No booth uploads yet. Upload from Unity with the Legends Alley SDK.</div>
      )}
      {(booths || []).slice().sort((a, b) => b.version - a.version).map((b) => <AlleyBoothRow key={b.id} b={b} />)}
    </div>
  );
}

export function AlleyBoothRow({ b, right }) {
  const [preview, setPreview] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  useEffect(() => {
    if (b.previewUrl) api.alleyImageUrl(b.previewUrl).then(setPreview);
  }, [b.previewUrl]);

  const download = async () => {
    setDownloading(true);
    setDownloadError("");
    const result = await api.alley(b.downloadUrl || `/api/booths/${encodeURIComponent(b.id)}/download`, { binary: true });
    if (!result.dataBase64) {
      setDownloading(false);
      setDownloadError(result.error || "Download failed.");
      return;
    }
    const picked = await api.saveFileDialog({
      defaultName: `${String(b.prefabName || "booth").replace(/[^a-z0-9_-]+/gi, "-")}-v${b.version}.zip`,
      filters: [{ name: "Booth upload", extensions: ["zip"] }]
    });
    if (picked.ok) {
      await api.writeFile(picked.path, result.dataBase64);
      api.showInFolder(picked.path);
      audio.success();
    }
    setDownloading(false);
  };

  return (
    <div className="listrow alley-booth-row">
      <div className="avatar square" style={{ width: 62, height: 40, borderRadius: 6 }}>
        {preview ? <img src={preview} alt="" style={{ objectFit: "cover" }} /> : "\u25A6"}
      </div>
      <div className="grow">
        <div className="title">{b.prefabName || `Booth v${b.version}`} <span className="muted tiny">v{b.version}</span></div>
        <div className="meta">
          {b.status}{b.fileSize ? ` | ${api.formatBytes(b.fileSize)}` : ""}
          {b.stats ? ` | ${Number(b.stats.triangles || 0).toLocaleString()} tris | ${b.stats.materialSlots} materials` : ""}
          {b.uploadedAt ? ` | ${api.timeAgo(b.uploadedAt)}` : ""}
        </div>
      </div>
      <span className={`pill ${b.status === "active" ? "teal" : "gray"}`}>{(b.status || "?").toUpperCase()}</span>
      {right || (b.downloadUrl && (
        <button className="small" onClick={download} disabled={downloading} title="Download this booth upload version">
          <Download size={14} />{downloading ? "Saving..." : "Download"}
        </button>
      ))}
      {downloadError && <span className="danger-text tiny">{downloadError}</span>}
    </div>
  );
}
