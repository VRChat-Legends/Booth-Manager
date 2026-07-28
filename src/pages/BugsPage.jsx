import { useEffect, useMemo, useState } from "react";
import { Bug, CircleCheck, CircleDot, ExternalLink } from "lucide-react";
import * as api from "../lib/api.js";

const NEW_ISSUE_URL = "https://github.com/VRChat-Legends/Booth-Manager/issues/new";

export default function BugsPage() {
  const [issues, setIssues] = useState(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("open");

  useEffect(() => {
    api.githubIssues().then((r) => {
      // the issues endpoint also returns pull requests; drop them
      if (r.status === 200 && Array.isArray(r.data)) setIssues(r.data.filter((issue) => !issue.pull_request));
      else setError(r.error || "Could not load issues from GitHub.");
    });
  }, []);

  const shown = useMemo(() => {
    const list = issues || [];
    return filter === "all" ? list : list.filter((issue) => issue.state === filter);
  }, [issues, filter]);

  const openCount = (issues || []).filter((issue) => issue.state === "open").length;

  return (
    <div className="page">
      <div className="pagehead row">
        <div className="grow">
          <h1>Bug Tracker</h1>
          <div className="sub">Known issues and fixes, synced from GitHub</div>
        </div>
        <button className="primary small" onClick={() => api.openExternal(NEW_ISSUE_URL)}>
          <Bug size={14} /> Report a bug
        </button>
      </div>

      <div className="tabs">
        {[["open", `Open${issues ? ` (${openCount})` : ""}`], ["closed", "Fixed"], ["all", "All"]].map(([id, label]) => (
          <div key={id} className={`tab${filter === id ? " active" : ""}`} onClick={() => setFilter(id)}>{label}</div>
        ))}
      </div>

      {error && <div className="errbox mb12">{error}</div>}
      {!issues && !error && <div className="skeleton" style={{ height: 200 }} />}
      {issues && shown.length === 0 && (
        <div className="card sub">{filter === "open" ? "No open bugs. Nice." : "Nothing here yet."}</div>
      )}

      <div className="stagger" style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 760 }}>
        {shown.map((issue) => (
          <div className="listrow issue-row" key={issue.id}>
            {issue.state === "open"
              ? <CircleDot size={16} style={{ color: "var(--teal)", flexShrink: 0 }} />
              : <CircleCheck size={16} style={{ color: "var(--violet, #a78bfa)", flexShrink: 0 }} />}
            <div className="grow">
              <div className="title">
                {issue.title} <span className="muted tiny">#{issue.number}</span>
              </div>
              <div className="meta">
                {issue.state === "open" ? `opened ${api.timeAgo(issue.created_at)}` : `closed ${api.timeAgo(issue.closed_at)}`}
                {issue.user?.login ? ` | by ${issue.user.login}` : ""}
                {issue.comments ? ` | ${issue.comments} comment${issue.comments === 1 ? "" : "s"}` : ""}
              </div>
              {(issue.labels || []).length > 0 && (
                <div className="row mt8" style={{ gap: 6, flexWrap: "wrap" }}>
                  {issue.labels.map((label) => (
                    <span key={label.id} className="pill gray" style={label.color ? { borderColor: `#${label.color}55`, color: `#${label.color}` } : undefined}>
                      {String(label.name || "").toUpperCase()}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <button className="ghost small" onClick={() => api.openExternal(issue.html_url)} title="Open on GitHub">
              <ExternalLink size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
