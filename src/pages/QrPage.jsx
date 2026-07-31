// QR code generator: fully client-side (no backend round-trip), with
// quick-fill buttons for the active community's known links and PNG/SVG
// export through the regular save dialogs.
import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Building2, Download, Globe, MessageCircle, QrCode, RotateCcw, Wifi } from "lucide-react";
import * as api from "../lib/api.js";
import * as audio from "../lib/audio.js";

const DEFAULTS = { size: 1024, margin: 4, correction: "Q", dark: "#000000", light: "#ffffff", transparent: false };

function wifiEscape(value) {
  return String(value || "").replace(/([\\;,:"])/g, "\\$1");
}

export default function QrPage({ cfg }) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState("content");
  const [wifi, setWifi] = useState({ ssid: "", password: "", security: "WPA", hidden: false });
  const [options, setOptions] = useState(DEFAULTS);
  const [links, setLinks] = useState([]);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const canvasRef = useRef(null);
  const value = mode === "wifi"
    ? (wifi.ssid.trim()
      ? `WIFI:T:${wifi.security};S:${wifiEscape(wifi.ssid.trim())};P:${wifiEscape(wifi.password)};H:${wifi.hidden ? "true" : "false"};;`
      : "")
    : text.trim();
  const qrOptions = {
    errorCorrectionLevel: options.correction,
    margin: options.margin,
    width: options.size,
    color: {
      dark: `${options.dark}ff`,
      light: `${options.light}${options.transparent ? "00" : "ff"}`
    }
  };

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
      await QRCode.toCanvas(canvas, value, qrOptions);
      setError("");
    } catch (renderError) {
      setError(String(renderError.message || renderError));
    }
  }, [value, options]);

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
      svg = await QRCode.toString(value, { ...qrOptions, type: "svg" });
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
          <div className="qr-mode-tabs" role="tablist" aria-label="QR content type">
            <button className={mode === "content" ? "active" : ""} onClick={() => setMode("content")}><Globe size={14} />Link or text</button>
            <button className={mode === "wifi" ? "active" : ""} onClick={() => setMode("wifi")}><Wifi size={14} />Wi-Fi</button>
          </div>
          {mode === "content" && <label className="field"><span>URL or text</span>
              <textarea
                value={text}
                maxLength={1000}
                onChange={(changeEvent) => setText(changeEvent.target.value)}
                placeholder="https://vrchat.com/home/group/grp_..."
                style={{ minHeight: 82 }}
              />
            </label>}
          {mode === "wifi" && (
            <div className="qr-wifi-fields">
              <label className="field"><span>Network name (SSID)</span><input type="text" maxLength={64} value={wifi.ssid} onChange={(event) => setWifi({ ...wifi, ssid: event.target.value })} placeholder="Wi-Fi network" /></label>
              <label className="field"><span>Password</span><input type="text" maxLength={128} value={wifi.password} onChange={(event) => setWifi({ ...wifi, password: event.target.value })} placeholder="Network password" /></label>
              <label className="field"><span>Security</span><select value={wifi.security} onChange={(event) => setWifi({ ...wifi, security: event.target.value })}><option value="WPA">WPA / WPA2 / WPA3</option><option value="WEP">WEP</option><option value="nopass">No password</option></select></label>
              <label className="qr-check"><input type="checkbox" checked={wifi.hidden} onChange={(event) => setWifi({ ...wifi, hidden: event.target.checked })} /><span>Hidden network</span></label>
            </div>
          )}
          {mode === "content" && links.length > 0 && (
            <>
              <div className="muted tiny mb8">Quick fill{cfg.alleyCommunityName ? ` for ${cfg.alleyCommunityName}` : ""}:</div>
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                {links.map((link) => (
                  <button key={link.url} className="small" title={link.url} onClick={() => { setMode("content"); setText(link.url); }}>
                    <link.Icon size={13} /> {link.label}
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="qr-options-head mt16"><strong>Output options</strong><button className="ghost small" onClick={() => setOptions(DEFAULTS)}><RotateCcw size={12} />Reset</button></div>
          <div className="qr-presets">
            <button className="small" onClick={() => setOptions({ ...options, size: 512, margin: 2, correction: "M" })}>Screen</button>
            <button className="small" onClick={() => setOptions({ ...options, size: 1024, margin: 4, correction: "Q" })}>Print</button>
            <button className="small" onClick={() => setOptions({ ...options, size: 2048, margin: 6, correction: "H" })}>Large poster</button>
          </div>
          <div className="qr-option-grid">
            <label className="field"><span>PNG size</span><select value={options.size} onChange={(event) => setOptions({ ...options, size: Number(event.target.value) })}><option value={256}>256 px</option><option value={512}>512 px</option><option value={1024}>1024 px</option><option value={2048}>2048 px</option></select></label>
            <label className="field"><span>Quiet zone</span><select value={options.margin} onChange={(event) => setOptions({ ...options, margin: Number(event.target.value) })}><option value={1}>1 module</option><option value={2}>2 modules</option><option value={4}>4 modules</option><option value={6}>6 modules</option><option value={8}>8 modules</option></select></label>
            <label className="field"><span>Error correction</span><select value={options.correction} onChange={(event) => setOptions({ ...options, correction: event.target.value })}><option value="L">Low, 7%</option><option value="M">Medium, 15%</option><option value="Q">Quartile, 25%</option><option value="H">High, 30%</option></select></label>
            <div className="qr-color-pair">
              <label><span>Code</span><input type="color" value={options.dark} onChange={(event) => setOptions({ ...options, dark: event.target.value })} /></label>
              <label><span>Background</span><input type="color" value={options.light} disabled={options.transparent} onChange={(event) => setOptions({ ...options, light: event.target.value })} /></label>
            </div>
          </div>
          <label className="qr-check"><input type="checkbox" checked={options.transparent} onChange={(event) => setOptions({ ...options, transparent: event.target.checked })} /><span>Transparent PNG background</span></label>
          <div className="muted tiny mt12">Use at least four quiet-zone modules for print. High correction is best for large posters that may be viewed at an angle or partly covered.</div>
          {error && <div className="errbox mt8">{error}</div>}
          {saved && <div className="muted tiny mt8">{saved}</div>}
        </div>

        <div className="card qr-preview">
          <div className="qr-preview-heading"><span>Live preview</span>{value && <small>{options.size} px · {options.correction} correction</small>}</div>
          <div className={`qr-canvas-wrap${value ? "" : " empty"}`}>
            <canvas ref={canvasRef} width={options.size} height={options.size} />
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
