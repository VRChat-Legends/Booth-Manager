import { useEffect, useState } from "react";
import { ExternalLink, ScrollText } from "lucide-react";
import * as api from "../lib/api.js";

/* Renders GitHub release notes without a markdown dependency:
   headings, bullets, and plain lines only. */
function NotesBody({ text }) {
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  return (
    <div className="release-notes">
      {lines.map((line, i) => {
        const t = line.trim();
        if (!t) return <div key={i} className="notes-gap" />;
        if (/^#{1,4}\s/.test(t)) return <div key={i} className="notes-heading">{t.replace(/^#{1,4}\s/, "")}</div>;
        if (/^[-*]\s/.test(t)) return <div key={i} className="notes-bullet"><span>&bull;</span><span>{t.replace(/^[-*]\s/, "")}</span></div>;
        return <div key={i} className="notes-line">{t}</div>;
      })}
    </div>
  );
}

export default function ChangelogPage() {
  const [releases, setReleases] = useState(null);
  const [error, setError] = useState("");
  const [appVersion, setAppVersion] = useState("");

  useEffect(() => {
    api.getAppVersion().then(setAppVersion);
    api.githubReleases().then((r) => {
      if (r.status === 200 && Array.isArray(r.data)) setReleases(r.data.filter((rel) => !rel.draft));
      else setError(r.error || "Could not load releases from GitHub.");
    });
  }, []);

  return (
    <div className="page">
      <div className="pagehead row">
        <div className="grow">
          <h1>Change Log</h1>
          <div className="sub">Every Booth Manager release, straight from GitHub</div>
        </div>
        <button className="ghost small" onClick={() => api.openExternal("https://github.com/VRChat-Legends/Booth-Manager/releases")}>
          <ExternalLink size={14} /> View on GitHub
        </button>
      </div>

      {error && <div className="errbox mb12">{error}</div>}
      {!releases && !error && <div className="skeleton" style={{ height: 220 }} />}
      {releases && releases.length === 0 && <div className="card sub">No releases published yet.</div>}

      <div className="stagger" style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 760 }}>
        {(releases || []).map((rel) => {
          const version = String(rel.tag_name || "").replace(/^v/, "");
          const isCurrent = appVersion && version === appVersion;
          return (
            <div className="card release-card" key={rel.id}>
              <div className="row">
                <ScrollText size={16} className="muted" />
                <strong style={{ fontSize: 15 }}>{rel.name || rel.tag_name}</strong>
                {isCurrent && <span className="pill teal">INSTALLED</span>}
                {rel.prerelease && <span className="pill yellow">PRE-RELEASE</span>}
                <span className="muted tiny right">{api.formatDate(rel.published_at)}</span>
              </div>
              {rel.body
                ? <NotesBody text={rel.body} />
                : <div className="muted small mt8">No notes were written for this release.</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
