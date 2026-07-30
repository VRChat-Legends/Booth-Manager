// Unity SDK: the Legends Alley SDK already ships (VPM-installable, Discord
// sign-in, live booth validation, booth kit prefabs, optimizer, staff booth
// manager). This page links out to it and mirrors its requirements and
// latest release live from GitHub so nothing here silently goes stale.
import { useEffect, useState } from "react";
import { CheckCircle2, Copy, Download, ExternalLink, Github, Package } from "lucide-react";
import * as api from "../lib/api.js";
import { MarkdownView } from "../lib/markdown.jsx";

const VPM_INDEX_URL = "https://vrchatlegends.com/vpm/index.json";
// real Creator Companion deep link: one click registers our VPM listing
const VCC_ADD_URL = `vcc://vpm/addRepo?url=${encodeURIComponent(VPM_INDEX_URL)}`;
const VPM_URL = "https://vrchatlegends.com/vpm";
const REPO_URL = "https://github.com/VRChat-Legends/LegendsAlleySDK";

// Shipping defaults, replaced by whatever the SDK README currently states.
const FALLBACK_REQUIREMENTS = ["Unity 2022.3", "VRChat Worlds SDK 3.7.0+"];

/** Pulls requirement strings out of the SDK README so version bumps upstream
 * show up here without an app update. Falls back to the known values. */
function parseRequirements(readme) {
  const text = String(readme || "");
  const found = [];
  const unity = /Unity\s+(20\d\d\.\d+(?:\.\d+[a-z]*\d*)?)/i.exec(text);
  if (unity) found.push(`Unity ${unity[1]}`);
  const worlds = /Worlds\s+SDK\s+([\d.]+\+?)/i.exec(text) || /VRChat\s+SDK\s*(?:-|:)?\s*Worlds\s*([\d.]+\+?)/i.exec(text);
  if (worlds) found.push(`VRChat Worlds SDK ${worlds[1]}${worlds[1].endsWith("+") ? "" : "+"}`);
  return found.length >= 2 ? found : FALLBACK_REQUIREMENTS;
}

const FEATURES = [
  ["Discord sign-in", "Authenticate with your community account right inside Unity."],
  ["Live booth validation", "Triangle, material, texture, and shader limits checked as you build."],
  ["Booth kit prefabs", "Drop-in booth base with poster, screen, and trigger slots."],
  ["Booth optimizer", "One-click cleanup pass before upload."],
  ["One-click upload", "Ships your booth straight to Legends Alley, no zip juggling."]
];

export default function UnitySdkPage() {
  const [requirements, setRequirements] = useState(null);
  const [release, setRelease] = useState(null);
  const [releaseError, setReleaseError] = useState("");
  const [copied, setCopied] = useState(false);

  const copyVpmUrl = async () => {
    try {
      await navigator.clipboard.writeText(VPM_INDEX_URL);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // clipboard denied: the listing page shows the same URL
      api.openExternal(VPM_URL);
    }
  };

  useEffect(() => {
    api.githubSdkReadme().then((result) => {
      setRequirements(parseRequirements(result.status === 200 ? result.data : ""));
    });
    api.githubSdkReleases().then((result) => {
      if (result.status === 200 && Array.isArray(result.data) && result.data.length) {
        setRelease(result.data.find((entry) => !entry.draft && !entry.prerelease) || result.data[0]);
      } else {
        setReleaseError(result.error || "Could not load the latest release from GitHub.");
      }
    });
  }, []);

  return (
    <div className="page stagger" style={{ maxWidth: 780, display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="card sdk-hero">
        <div className="row gap14">
          <span className="sdk-hero-icon"><Package size={26} /></span>
          <div className="grow">
            <h2 style={{ margin: 0 }}>Legends Alley SDK</h2>
            <div className="muted small mt8">
              The Unity toolkit for building and uploading your Legends Alley booth.
              Released and VPM-installable today, this is what puts your booth in the event world.
            </div>
          </div>
        </div>
        <div className="row mt12" style={{ gap: 8, flexWrap: "wrap" }}>
          <button className="primary" onClick={() => api.openExternal(VCC_ADD_URL)} title="Opens the VRChat Creator Companion and registers the Legends Alley listing">
            <Download size={15} /> Add to the Creator Companion
          </button>
          <button className="ghost" onClick={copyVpmUrl} title={VPM_INDEX_URL}>
            <Copy size={15} /> {copied ? "Copied!" : "Copy VPM listing URL"}
          </button>
          <button className="ghost" onClick={() => api.openExternal(REPO_URL)}>
            <Github size={15} /> View on GitHub
          </button>
        </div>
        <div className="muted tiny mt8">
          The Companion button needs the VRChat Creator Companion installed. No VCC? Add the listing URL manually under Settings, Packages.
        </div>
      </div>

      <div className="card">
        <h3>Requirements</h3>
        {!requirements && <div className="skeleton" style={{ height: 40 }} />}
        {requirements && (
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            {requirements.map((requirement) => (
              <span key={requirement} className="pill teal"><CheckCircle2 size={11} /> {requirement.toUpperCase()}</span>
            ))}
          </div>
        )}
        <div className="muted tiny mt8">Mirrored from the SDK README so this list stays current with the repo.</div>
      </div>

      <div className="card">
        <h3>What ships in the box</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {FEATURES.map(([title, description]) => (
            <div className="listrow" key={title}>
              <CheckCircle2 size={15} style={{ color: "var(--teal)", flexShrink: 0 }} />
              <div className="grow">
                <div className="title" style={{ fontSize: 12.5 }}>{title}</div>
                <div className="meta">{description}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="muted tiny mt8">Staff accounts also get the in-Unity booth manager for syncing placements into the event world.</div>
      </div>

      <div className="card">
        <div className="row">
          <h3 style={{ margin: 0 }}>Latest release</h3>
          {release && <span className="pill teal right">{release.tag_name || release.name}</span>}
        </div>
        {releaseError && <div className="muted small mt8">{releaseError}</div>}
        {!release && !releaseError && <div className="skeleton mt8" style={{ height: 80 }} />}
        {release && (
          <>
            <div className="muted tiny mt8">
              {release.name && release.name !== release.tag_name ? `${release.name} | ` : ""}
              published {api.timeAgo(release.published_at)}
            </div>
            {release.body && <div className="mt8"><MarkdownView text={release.body} /></div>}
            <div className="row mt8" style={{ gap: 8, flexWrap: "wrap" }}>
              {(release.assets || [])
                .filter((asset) => /\.(zip|unitypackage)$/i.test(String(asset.name || "")))
                .slice(0, 3)
                .map((asset) => (
                  <button key={asset.id || asset.name} className="small" onClick={() => api.openExternal(asset.browser_download_url)}>
                    <Download size={13} /> {asset.name}
                  </button>
                ))}
              <button className="ghost small" onClick={() => api.openExternal(release.html_url || REPO_URL)}>
                <ExternalLink size={13} /> Release notes on GitHub
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
