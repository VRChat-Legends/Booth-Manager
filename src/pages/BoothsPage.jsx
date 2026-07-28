import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, Box, Check, ChevronDown, Copy, Download, HardDrive, RefreshCw, Search, ShieldCheck } from "lucide-react";
import * as api from "../lib/api.js";
import * as audio from "../lib/audio.js";

const STAT_LABELS = {
  triangles: "Triangles",
  buildSizeMB: "Build size (MB)",
  vramMB: "Texture + mesh memory (MB)",
  materialSlots: "Material slots",
  uniqueTextures: "Unique textures",
  maxTextureResolution: "Largest texture",
  staticMeshes: "Static meshes",
  skinnedMeshes: "Skinned meshes",
  particleSystems: "Particle systems",
  totalParticles: "Total particles",
  animators: "Animators",
  animationClips: "Animation clips",
  udonScripts: "Udon scripts",
  pickups: "Pickups",
  avatarPedestals: "Avatar pedestals",
  portals: "Portals",
  textComponents: "Text components",
  audioSources: "Audio sources",
  videoPlayers: "Video players",
  groupButtons: "Group buttons",
  estimatedDrawCalls: "Est. draw calls",
  estimatedSetPasses: "Est. set passes",
  nonBoxColliders: "Non-box colliders",
  audioRangeMeters: "Audio range (m)"
};

export default function BoothsPage({ cfg, appLocked, event, newUploadIds, onAcknowledgeUploads }) {
  const [booths, setBooths] = useState(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [downloading, setDownloading] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [expandedId, setExpandedId] = useState("");

  const load = useCallback(async (quiet = false) => {
    if (!cfg.alleyCommunityId) {
      setBooths([]);
      return;
    }
    if (!quiet) setRefreshing(true);
    const result = await api.alley("/api/booths/mine");
    if (result.status === 200) {
      setBooths(result.data?.booths || []);
      setError("");
    } else {
      setBooths([]);
      setError(result.error || "Could not load booth backups.");
    }
    setRefreshing(false);
  }, [cfg.alleyCommunityId]);

  useEffect(() => {
    load();
    const timer = window.setInterval(() => load(true), 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (newUploadIds?.size) onAcknowledgeUploads?.();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    const sorted = (booths || []).slice().sort((left, right) => Date.parse(right.uploadedAt) - Date.parse(left.uploadedAt));
    if (!search) return sorted;
    return sorted.filter((booth) => [booth.prefabName, `v${booth.version}`, booth.status, booth.eventId]
      .some((value) => String(value || "").toLowerCase().includes(search)));
  }, [booths, query]);

  const download = async (booth) => {
    setDownloading(booth.id);
    setError("");
    const safeName = String(booth.prefabName || "booth").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "booth";
    const result = await api.alleyDownload(booth.downloadUrl || `/api/booths/${booth.id}/download`, `${safeName}-v${booth.version}-backup.zip`);
    setDownloading("");
    if (result.ok) audio.success();
    else if (!result.canceled) setError(result.error || "Backup download failed.");
  };

  if (!cfg.alleyCommunityId) {
    return (
      <div className="empty-state page">
        <div className="empty-state-icon"><ShieldCheck size={29} /></div>
        <h2>No community is attached to this staff account</h2>
        <p>Booth Backups only lists packages uploaded by the signed-in community. Staff can inspect every upload in Alley Admin.</p>
      </div>
    );
  }

  return (
    <div className="page uploads-page">
      <div className="uploads-head">
        <div>
          <span className="eyebrow">{cfg.alleyCommunityName}</span>
          <h1>Booth backups</h1>
          <p>Accepted packages retained on Legends Alley servers. Local drafts and manually entered records never appear here.</p>
        </div>
        <div className="uploads-head-actions">
          <div className="search-field uploads-search"><Search size={15} /><input value={query} onChange={(eventValue) => setQuery(eventValue.target.value)} placeholder="Search uploads" /></div>
          <button className="icon-button" title="Refresh backups" onClick={() => load()} disabled={refreshing}><RefreshCw size={16} className={refreshing ? "spin" : ""} /></button>
        </div>
      </div>

      {appLocked && (
        <div className="backup-mode-note"><Archive size={18} /><div><strong>Final event backup window</strong><span>{event?.name || "The event"} is within five days. These ZIP downloads are the only community action available until the event ends.</span></div></div>
      )}
      {error && <div className="errbox mb16">{error}</div>}
      {!booths && <div className="upload-card-grid"><div className="skeleton" style={{ height: 330 }} /><div className="skeleton" style={{ height: 330 }} /></div>}
      {booths && filtered.length === 0 && (
        <div className="empty-state compact">
          <Box size={28} />
          <h2>{booths.length ? "No matching uploads" : "No server uploads yet"}</h2>
          <p>{booths.length ? "Try a different version, status, or prefab name." : "An accepted upload from the Legends Alley Unity SDK will appear here automatically."}</p>
        </div>
      )}

      <div className="upload-card-grid">
        {filtered.map((booth) => (
          <article className={`upload-card${newUploadIds?.has(String(booth.id)) ? " new" : ""}`} key={booth.id}>
            <BoothPreview booth={booth} />
            <div className="upload-card-body">
              <div className="upload-title-row">
                <span className="version-mark">v{booth.version}</span>
                <div className="grow"><h2>{booth.prefabName || "Legends Alley Booth"}</h2><p>{api.formatDate(booth.uploadedAt)}</p></div>
                <span className={`pill ${booth.status === "active" ? "teal" : "gray"}`}>{booth.status}</span>
              </div>
              <div className="upload-metrics">
                <Metric label="Triangles" value={number(booth.stats?.triangles)} />
                <Metric label="Build size" value={booth.stats?.buildSizeMB != null ? `${booth.stats.buildSizeMB} MB` : "-"} />
                <Metric label="VRAM" value={booth.stats?.vramMB != null ? `${booth.stats.vramMB} MB` : "-"} />
                <Metric label="Materials" value={number(booth.stats?.materialSlots)} />
              </div>
              <div className="upload-footer">
                <span><HardDrive size={13} />{api.formatBytes(booth.fileSize)}</span>
                <span>{booth.shaders?.length || 0} shaders</span>
                {booth.limitsBypassed && <span className="pill amber" title="A staff member accepted this upload past normal limits">LIMITS BYPASSED</span>}
                {newUploadIds?.has(String(booth.id)) && <span className="pill new-pill">NEW</span>}
                <button className="ghost right" onClick={() => setExpandedId((current) => current === booth.id ? "" : booth.id)}>
                  <ChevronDown size={15} className={expandedId === booth.id ? "flip" : ""} />{expandedId === booth.id ? "Hide details" : "Details"}
                </button>
                <button className="primary" onClick={() => download(booth)} disabled={downloading === booth.id}>
                  <Download size={15} />{downloading === booth.id ? "Downloading" : "Download ZIP"}
                </button>
              </div>
              {expandedId === booth.id && <BoothDetails booth={booth} />}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function BoothPreview({ booth }) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let disposed = false;
    setUrl("");
    setFailed(false);
    api.alleyImageUrl(booth.previewUrl).then((next) => {
      if (!disposed) {
        setUrl(next);
        setFailed(!next);
      }
    });
    return () => { disposed = true; };
  }, [booth.previewUrl]);

  return (
    <div className="upload-preview">
      {!url && !failed && <div className="model-loader"><span /><span /><span /><small>Loading preview</small></div>}
      {url && !failed && <img src={url} alt={`${booth.prefabName || "Booth"} version ${booth.version}`} onError={() => setFailed(true)} />}
      {failed && <div className="preview-missing"><Box size={25} /><span>Preview unavailable</span></div>}
    </div>
  );
}

function BoothDetails({ booth }) {
  const stats = booth.stats || {};
  const bounds = stats.boundsMeters;
  const rows = Object.keys(STAT_LABELS)
    .filter((key) => stats[key] != null && Number.isFinite(Number(stats[key])))
    .map((key) => ({ key, label: STAT_LABELS[key], value: Number(stats[key]).toLocaleString() }));

  return (
    <div className="upload-details">
      <div className="upload-details-facts">
        <Fact label="Uploaded by" value={booth.uploadedByName || booth.uploadedBy || "Unknown"} />
        <Fact label="Uploaded" value={api.formatDate(booth.uploadedAt)} />
        <Fact label="Event" value={booth.eventId || "-"} />
        <Fact label="Version" value={`v${booth.version}`} />
        <Fact label="Status" value={booth.status} />
        <Fact label="SDK" value={booth.sdkVersion || "-"} />
        <Fact label="Archive" value={`${booth.fileName || "booth.zip"} (${api.formatBytes(booth.fileSize)})`} />
        {bounds && Number.isFinite(Number(bounds.x)) && (
          <Fact label="Bounds" value={`${round2(bounds.x)} x ${round2(bounds.y)} x ${round2(bounds.z)} m`} />
        )}
      </div>
      {booth.sha256 && <Sha256Row hash={booth.sha256} />}
      {rows.length > 0 && (
        <div className="upload-details-stats">
          {rows.map((row) => <div key={row.key}><span>{row.label}</span><strong>{row.value}</strong></div>)}
        </div>
      )}
      {(booth.shaders || []).length > 0 && (
        <div className="upload-details-shaders">
          <span>Shaders</span>
          <div>{booth.shaders.map((shader) => <code key={shader}>{shader}</code>)}</div>
        </div>
      )}
    </div>
  );
}

function Sha256Row({ hash }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(hash);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard unavailable */ }
  };
  return (
    <div className="upload-sha">
      <span>SHA-256</span>
      <code title={hash}>{hash}</code>
      <button className="icon-button small" title="Copy hash" onClick={copy}>{copied ? <Check size={13} /> : <Copy size={13} />}</button>
    </div>
  );
}

function Fact({ label, value }) {
  return <div className="fact"><span>{label}</span><strong>{value}</strong></div>;
}

function round2(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : "?";
}

function Metric({ label, value }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function number(value) {
  return Number.isFinite(Number(value)) ? Number(value).toLocaleString() : "-";
}