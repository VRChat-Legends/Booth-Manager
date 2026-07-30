// QR code generator: fully client-side (no backend round-trip), with
// quick-fill buttons for the active community's known links and PNG/SVG
// export through the regular save dialogs.
import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Building2, Download, Globe, MessageCircle, QrCode } from "lucide-react";
import * as api from "../lib/api.js";
import * as audio from "../lib/audio.js";

const SIZE = 512;
const QR_OPTIONS = {
  errorCorrectionLevel: "Q",
  margin: 2,
  width: SIZE,
  color: { dark: "#000000ff", light: "#ffffffff" }
};

export default function QrPage({ cfg }) {
  const [text, setText] = useState("");
  const [links, setLinks] = useState([]);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const canvasRef = useRef(null);
  const value = text.trim();

  // Quick-fill links for the active community: VRChat group page, Discord
  // invite, socials, plus the public Alley page.
  useEffect(() => {
    let disposed = false;
    (async () => {
      const quick = [];
      if (cfg.alleyGroupId) {
        quick.push({ label: "VRChat group", Icon: Building2, url: `https://vrchat.com/home/group/${cfg.alleyGroupId}` });
      }
      if (cfg.alleyCommunityId) {
        const result = await api.alley("/api/auth/me");
        const community = result.status === 200 ? result.data?.community : null;
        if (community?.inviteUrl) quick.push({ label: "Discord invite", Icon: MessageCircle, url: community.inviteUrl });
        for (const social of (community?.socials || []).slice(0, 3)) {
          if (/^https?:\/\//i.test(social)) {
            let host = social;
            try { host = new URL(social).hostname.replace(/^www\./, ""); } catch { /* keep raw */ }
            quick.push({ label: host, Icon: Globe, url: social });
          }
        }
      }
      quick.push({ label: "Legends Alley", Icon: Globe, url: "https://vrchatlegends.com/alley" });
      if (!disposed) setLinks(quick);
    })();
    return () => { disposed = true; };
  }, [cfg.alleyGroupId, cfg.alleyCommunityId]);

  const render = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!value) {
      const context = canvas.getContext("2d");
      context.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    try {
      await QRCode.toCanvas(canvas, value, QR_OPTIONS);
      setError("");
    } catch (renderError) {
      setError(String(renderError.message || renderError));
    }
  }, [value]);

  useEffect(() => {
    setSaved("");
    const timer = window.setTimeout(render, 150); // debounce while typing
    return () => window.clearTimeout(timer);
  }, [render]);

  const fileStem = () => {
    let stem = "qr-code";
    if (/^https?:\/\//i.test(value)) {
      try { stem = `qr-${new URL(value).hostname.replace(/^www\./, "").replace(/[^a-z0-9.-]+/gi, "-")}`; } catch { /* keep default */ }
    }
    return stem;
  };

  const savePng = async () => {
    if (!value || !canvasRef.current) return;
    const picked = await api.saveFileDialog({
      defaultName: `${fileStem()}.png`,
      filters: [{ name: "PNG image", extensions: ["png"] }]
    });
    if (!picked.ok) return;
    const dataUrl = canvasRef.current.toDataURL("image/png");
    const result = await api.writeFile(picked.path, dataUrl.split(",")[1]);
    if (result.ok) {
      api.showInFolder(picked.path);
      audio.success();
      setSaved(`Saved ${picked.path}`);
    } else {
      setError(result.error || "Could not save the PNG.");
    }
  };

  const saveSvg = async () => {
    if (!value) return;
    let svg = "";
    try {
      svg = await QRCode.toString(value, { ...QR_OPTIONS, type: "svg" });
    } catch (svgError) {
      setError(String(svgError.message || svgError));
      return;
    }
    const picked = await api.saveFileDialog({
      defaultName: `${fileStem()}.svg`,
      filters: [{ name: "SVG vector image", extensions: ["svg"] }]
    });
    if (!picked.ok) return;
    const result = await api.writeText(picked.path, svg);
    if (result.ok) {
      api.showInFolder(picked.path);
      audio.success();
      setSaved(`Saved ${picked.path}`);
    } else {
      setError(result.error || "Could not save the SVG.");
    }
  };

  return (
    <div className="page">
      <div className="pagehead">
        <h1>QR Codes</h1>
        <div className="sub">Turn any link into a poster-ready code, generated on this computer</div>
      </div>

      <div className="qr-layout">
        <div className="card qr-form">
          <label className="field"><span>URL or text</span>
            <textarea
              value={text}
              maxLength={1000}
              onChange={(changeEvent) => setText(changeEvent.target.value)}
              placeholder="https://vrchat.com/home/group/grp_..."
              style={{ minHeight: 74 }}
            />
          </label>
          {links.length > 0 && (
            <>
              <div className="muted tiny mb8">Quick fill{cfg.alleyCommunityName ? ` for ${cfg.alleyCommunityName}` : ""}:</div>
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                {links.map((link) => (
                  <button key={link.url} className="small" title={link.url} onClick={() => setText(link.url)}>
                    <link.Icon size={13} /> {link.label}
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="muted tiny mt12">
            Good uses: booth and world links, VRChat group invites, community Discord invites,
            trustbadge verification links. Error correction level Q survives print wear and partial covers.
          </div>
          {error && <div className="errbox mt8">{error}</div>}
          {saved && <div className="muted tiny mt8">{saved}</div>}
        </div>

        <div className="card qr-preview">
          <div className={`qr-canvas-wrap${value ? "" : " empty"}`}>
            <canvas ref={canvasRef} width={SIZE} height={SIZE} />
            {!value && <div className="qr-placeholder"><QrCode size={42} /><span>The code preview appears here</span></div>}
          </div>
          <div className="row mt12" style={{ justifyContent: "center", gap: 8 }}>
            <button className="primary" disabled={!value} onClick={savePng}><Download size={15} /> PNG</button>
            <button disabled={!value} onClick={saveSvg}><Download size={15} /> SVG</button>
          </div>
        </div>
      </div>
    </div>
  );
}
