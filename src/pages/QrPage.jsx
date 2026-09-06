import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Building2, Download, Globe, MessageCircle, QrCode, RotateCcw, Wifi } from "lucide-react";
import * as api from "../lib/api.js";
import * as audio from "../lib/audio.js";
import { QR_BYTE_CAPACITY, QR_PRESETS, buildWifiPayload, createQrRequest, getPayloadStats, getQrReadiness, saveQrRequest, startQrPreview } from "../lib/qrUtils.mjs";
import "../tools-refinements.css";

const CHECK_LABELS = { pass: "Pass", fix: "Adjust", check: "Check placement", pending: "Waiting" };

export default function QrPage({ cfg = {} }) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState("content");
  const [wifi, setWifi] = useState({ ssid: "", password: "", security: "WPA", hidden: false });
  const [showPassword, setShowPassword] = useState(false);
  const [options, setOptions] = useState(QR_PRESETS.print);
  const [links, setLinks] = useState([]);
  const [linkNotice, setLinkNotice] = useState("");
  const [preview, setPreview] = useState(null);
  const [saving, setSaving] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const requestRef = useRef(null);
  const saveRef = useRef(null);
  const value = mode === "wifi" ? buildWifiPayload(wifi) : text.trim() ? text : "";
  const request = useMemo(() => createQrRequest(value, options), [value, options]);
  const counts = useMemo(() => getPayloadStats(value), [value]);
  const currentPreview = preview?.request === request ? preview : null;
  const phase = value ? currentPreview?.phase || "queued" : "empty";
  const ready = phase === "ready";
  const readiness = getQrReadiness(options, ready ? currentPreview.modules : 0);
  const currentFeedback = feedback?.request === request ? feedback : null;

  useLayoutEffect(() => {
    requestRef.current = request;
    return () => { requestRef.current = null; };
  }, [request]);

  useEffect(() => { setShowPassword(false); }, [mode, wifi.security]);

  useEffect(() => {
    let disposed = false;
    const quick = [];
    if (cfg.alleyGroupId) quick.push({ label: "VRChat group", Icon: Building2, url: `https://vrchat.com/home/group/${cfg.alleyGroupId}` });
    const alleyLink = { label: "Legends Alley", Icon: Globe, url: "https://vrchatlegends.com/alley" };
    setLinks([...quick, alleyLink]);
    setLinkNotice("");
    (async () => {
      if (!cfg.alleyCommunityId) return;
      try {
        const result = await api.alley("/api/auth/me");
        const community = result.status === 200 ? result.data?.community : null;
        if (!community) throw new Error("Community links are unavailable right now.");
        if (community?.inviteUrl) quick.push({ label: "Discord invite", Icon: MessageCircle, url: community.inviteUrl });
        for (const social of (community?.socials || []).slice(0, 3)) {
          if (typeof social === "string" && /^https?:\/\//i.test(social)) {
            let host = social;
            try { host = new URL(social).hostname.replace(/^www\./, ""); } catch { /* keep raw */ }
            quick.push({ label: host, Icon: Globe, url: social });
          }
        }
        if (!disposed) setLinks([...quick, alleyLink].filter((link, index, all) => all.findIndex((item) => item.url === link.url) === index));
      } catch {
        if (!disposed) setLinkNotice("Community links are unavailable. You can still enter content and generate locally.");
      }
    })();
    return () => { disposed = true; };
  }, [cfg.alleyGroupId, cfg.alleyCommunityId]);

  useEffect(() => {
    setFeedback(null);
    let job;
    if (!request.value) {
      job = startQrPreview(request, setPreview);
      return () => job.cancel();
    }
    setPreview({ request, phase: "queued", error: "" });
    const timer = window.setTimeout(() => { job = startQrPreview(request, setPreview); }, 150);
    return () => { window.clearTimeout(timer); job?.cancel(); };
  }, [request]);

  const save = async (format) => {
    if (!ready || saveRef.current || requestRef.current !== request) return;
    if (format === "png" ? !readiness.canExportPng : !readiness.canExportSvg) return;
    const operation = { phase: "preparing", canceled: false };
    saveRef.current = operation;
    setFeedback(null);
    const isOwned = () => saveRef.current === operation && requestRef.current === request;
    try {
      const result = await saveQrRequest(request, format, api, {
        isCurrent: () => isOwned() && !operation.canceled,
        onPhase: (nextPhase) => {
          operation.phase = nextPhase;
          if (isOwned()) setSaving({ format, phase: nextPhase });
        }
      });
      if (!isOwned()) return;
      setFeedback({ request, message: result.status === "saved" ? `Saved to ${result.path}` : "Save canceled. No file was written." });
      if (result.status === "saved") {
        try { audio.success(); } catch { /* sound is optional */ }
        Promise.resolve().then(() => api.showInFolder(result.path)).catch(() => {});
      }
    } catch (error) {
      if (isOwned()) setFeedback({ request, error: !operation.canceled, message: operation.canceled ? "Save canceled. No file was written." : String(error?.message || error) });
    } finally {
      if (saveRef.current === operation) {
        saveRef.current = null;
        if (requestRef.current) setSaving(null);
      }
    }
  };

  const cancelSave = () => {
    const operation = saveRef.current;
    if (!operation || operation.phase === "writing") return;
    operation.canceled = true;
    setSaving((current) => current && ({ ...current, phase: "canceling" }));
  };

  const previewStatus = phase === "empty" ? "Enter content to create a preview."
    : phase === "error" ? "Preview unavailable. Fix the content or settings and try again."
      : ready ? "Preview matches the current content and settings." : "Generating the current preview...";
  const exportNote = !ready ? "Exports unlock after the current payload has a valid preview."
    : !readiness.canExportSvg ? "Adjust the contrast or clear border before exporting."
      : !readiness.canExportPng ? "Choose a larger PNG size, or export SVG for a scalable image."
        : "Test the exported code on its final background and at its intended size.";

  return (
    <div className="page tools-refined qr-tool">
      <div className="pagehead">
        <h1>QR Codes</h1>
        <div className="sub">Links, text and WiFi details, generated on this computer</div>
      </div>

      <div className="qr-layout">
        <div className="card qr-form">
          <fieldset className="tools-fields" disabled={Boolean(saving)}>
            <legend className="tools-sr-only">QR content and output settings</legend>
            <div className="qr-mode-tabs" role="group" aria-label="QR content type">
              <button type="button" className={mode === "content" ? "active" : ""} aria-pressed={mode === "content"} onClick={() => setMode("content")}><Globe size={14} aria-hidden="true" />Link or text</button>
              <button type="button" className={mode === "wifi" ? "active" : ""} aria-pressed={mode === "wifi"} onClick={() => setMode("wifi")}><Wifi size={14} aria-hidden="true" />WiFi</button>
            </div>
            {mode === "content" && <label className="field"><span>URL or text</span>
              <textarea
                value={text}
                onChange={(changeEvent) => setText(changeEvent.target.value)}
                placeholder="https://vrchat.com/home/group/grp_..."
                aria-describedby="qr-payload-count qr-capacity-note"
                spellCheck={false}
                autoCapitalize="off"
              />
            </label>}
            {mode === "wifi" && (
              <div className="qr-wifi-fields">
                <label className="field"><span>Network name (SSID)</span><input type="text" maxLength={64} value={wifi.ssid} onChange={(event) => setWifi({ ...wifi, ssid: event.target.value })} placeholder="WiFi network" autoComplete="off" spellCheck={false} /></label>
                <label className="field"><span>Security</span><select value={wifi.security} onChange={(event) => setWifi({ ...wifi, security: event.target.value })}><option value="WPA">WPA / WPA2 personal</option><option value="WEP">WEP</option><option value="nopass">No password</option></select></label>
                {wifi.security !== "nopass" && <div className="field qr-password-field">
                  <label htmlFor="qr-wifi-password">Password</label>
                  <div className="qr-password-input">
                    <input id="qr-wifi-password" type={showPassword ? "text" : "password"} maxLength={128} value={wifi.password} onChange={(event) => setWifi({ ...wifi, password: event.target.value })} placeholder="Network password" autoComplete="off" spellCheck={false} />
                    <button type="button" aria-controls="qr-wifi-password" aria-label={showPassword ? "Hide WiFi password" : "Show WiFi password"} aria-pressed={showPassword} onClick={() => setShowPassword((current) => !current)}>{showPassword ? "Hide" : "Show"}</button>
                  </div>
                </div>}
                <label className="qr-check"><input type="checkbox" checked={wifi.hidden} onChange={(event) => setWifi({ ...wifi, hidden: event.target.checked })} /><span>Hidden network</span></label>
                <p className="field-note qr-wide">{wifi.security === "nopass" ? "The payload will not include a password field." : "Anyone who can scan this code can read the network password."}</p>
              </div>
            )}
            <div id="qr-payload-count" className="qr-payload-count">{counts.characters.toLocaleString()} characters <span>{counts.bytes.toLocaleString()} UTF8 bytes</span></div>
            <p id="qr-capacity-note" className="field-note">Byte mode reference: up to {QR_BYTE_CAPACITY[options.correction].toLocaleString()} bytes at {options.correction} correction. Numbers and capital letters can fit more. Capacity depends on the actual encoding.</p>
            {mode === "content" && links.length > 0 && <div className="qr-quick-links">
              <p className="field-note">Quick fill{cfg.alleyCommunityName ? ` for ${cfg.alleyCommunityName}` : ""}</p>
              <div className="tools-button-row">
                {links.map((link) => <button type="button" key={link.url} className="small" title={link.url} onClick={() => setText(link.url)}><link.Icon size={13} aria-hidden="true" />{link.label}</button>)}
              </div>
              {linkNotice && <p className="field-note" role="status">{linkNotice}</p>}
            </div>}
            <div className="qr-options-head mt16"><strong>Output options</strong><button type="button" className="ghost small" aria-label="Reset QR output options" onClick={() => setOptions(QR_PRESETS.print)}><RotateCcw size={14} aria-hidden="true" />Reset</button></div>
            <div className="qr-presets" role="group" aria-label="Safe output presets">
              <button type="button" className="small" onClick={() => setOptions(QR_PRESETS.screen)}>Screen</button>
              <button type="button" className="small" onClick={() => setOptions(QR_PRESETS.print)}>Print</button>
              <button type="button" className="small" onClick={() => setOptions(QR_PRESETS.poster)}>Large poster</button>
            </div>
            <p className="field-note">Presets restore black on solid white and at least four border modules.</p>
            <div className="qr-option-grid">
              <label className="field"><span>PNG size</span><select value={options.size} onChange={(event) => setOptions({ ...options, size: Number(event.target.value) })}><option value={256}>256 px</option><option value={512}>512 px</option><option value={1024}>1024 px</option><option value={2048}>2048 px</option></select></label>
              <label className="field"><span>Quiet zone</span><select value={options.margin} onChange={(event) => setOptions({ ...options, margin: Number(event.target.value) })}><option value={1}>1 module</option><option value={2}>2 modules</option><option value={4}>4 modules</option><option value={6}>6 modules</option><option value={8}>8 modules</option></select></label>
              <label className="field"><span>Error correction</span><select value={options.correction} onChange={(event) => setOptions({ ...options, correction: event.target.value })}><option value="L">Low, about 7%</option><option value="M">Medium, about 15%</option><option value="Q">Quartile, about 25%</option><option value="H">High, about 30%</option></select></label>
              <div className="qr-color-pair">
                <label><span>Code</span><input type="color" value={options.dark} onChange={(event) => setOptions({ ...options, dark: event.target.value })} /></label>
                <label><span>Background</span><input type="color" value={options.light} disabled={options.transparent} onChange={(event) => setOptions({ ...options, light: event.target.value })} /></label>
              </div>
            </div>
            <label className="qr-check"><input type="checkbox" checked={options.transparent} onChange={(event) => setOptions({ ...options, transparent: event.target.checked })} /><span>Transparent background for PNG and SVG</span></label>
            <p className="field-note">More correction uses more space. It does not replace good contrast, a clear border or testing the finished design.</p>
          </fieldset>
          {phase === "error" && <div className="errbox mt8" role="alert">{currentPreview.error}</div>}
        </div>

        <div className="card qr-preview">
          <div className="qr-preview-heading"><span>Live preview</span><small>{options.size} px · {options.correction} correction</small></div>
          <div className={`qr-canvas-wrap tools-checker${ready ? "" : " empty"}`} aria-busy={phase === "queued" || phase === "building"}>
            {ready ? <img src={currentPreview.dataUrl} alt={mode === "wifi" ? "QR code containing the current WiFi network details" : "QR code containing the current link or text"} width={options.size} height={options.size} />
              : <div className="qr-placeholder"><QrCode size={42} aria-hidden="true" /><span>{phase === "empty" ? "The code preview appears here" : phase === "error" ? "Could not encode this payload" : "Updating preview..."}</span></div>}
          </div>
          <p className="tool-status" role="status">{previewStatus}</p>
          {ready && <div className="qr-symbol-facts"><span>Version <strong>{currentPreview.version} of 40</strong></span><span><strong>{currentPreview.modules} x {currentPreview.modules}</strong> modules</span></div>}
          <section className="qr-readiness" aria-labelledby="qr-readiness-title">
            <h2 id="qr-readiness-title">Scan readiness checklist</h2>
            <ul>{readiness.checks.map((check) => <li key={check.id} data-state={check.state}>
              <div><strong>{check.label}</strong><span className="tool-check-label">{CHECK_LABELS[check.state]}</span></div>
              <p>{check.detail}</p>
            </li>)}</ul>
            <p className="field-note">These are conservative design checks, not a scan guarantee. Always test with a phone.</p>
          </section>
          <div className="tools-button-row qr-save-buttons" aria-busy={Boolean(saving)}>
            <button type="button" className="primary" disabled={!ready || !readiness.canExportPng || Boolean(saving)} aria-label="Save QR code as PNG" aria-describedby="qr-export-note" onClick={() => save("png")}><Download size={15} aria-hidden="true" />Save PNG</button>
            <button type="button" disabled={!ready || !readiness.canExportSvg || Boolean(saving)} aria-label="Save QR code as SVG" aria-describedby="qr-export-note" onClick={() => save("svg")}><Download size={15} aria-hidden="true" />Save SVG</button>
          </div>
          <p id="qr-export-note" className="field-note">{exportNote}</p>
          {saving && <div className="tool-save-state">
            <span role="status">{saving.phase === "preparing" ? `Preparing ${saving.format.toUpperCase()}...` : saving.phase === "choosing" ? "Choose a location, or cancel in the save dialog." : saving.phase === "canceling" ? "Cancel requested. Close the save dialog if it is open." : "Writing the file..."}</span>
            <button type="button" className="small" disabled={saving.phase === "writing" || saving.phase === "canceling"} onClick={cancelSave}>Cancel save</button>
          </div>}
          {currentFeedback && <div className={currentFeedback.error ? "errbox tool-feedback" : "tool-feedback"} role={currentFeedback.error ? "alert" : "status"}>{currentFeedback.message}</div>}
          <p className="field-note qr-local-note">QR content stays on this computer. Nothing is uploaded to generate or save a code.</p>
        </div>
      </div>
    </div>
  );
}
