import { useEffect, useState } from "react";
import * as api from "../lib/api.js";
import * as audio from "../lib/audio.js";

export default function SettingsPage({ cfg, refreshConfig, onLogout }) {
  const [version, setVersion] = useState("");
  const [update, setUpdate] = useState(null);
  const [alleyBase, setAlleyBase] = useState(cfg.alleyApiBase || "");
  const [msg, setMsg] = useState("");
  const [confirmUninstall, setConfirmUninstall] = useState(false);

  useEffect(() => {
    api.getAppVersion().then(setVersion);
    api.getUpdateState().then(setUpdate);
    const off = api.onUpdateState(setUpdate);
    return () => off?.();
  }, []);

  const toggle = async (key, value) => {
    await api.saveConfig({ [key]: value });
    await refreshConfig();
    if (key === "sfxEnabled") audio.setSfxEnabled(value);
    if (key === "pingSoundEnabled") audio.setPingEnabled(value);
  };

  const saveBases = async () => {
    const okAlley = /^https?:\/\//i.test(alleyBase.trim());
    if (!okAlley) { setMsg("The service address must be an http(s) URL."); return; }
    await api.saveConfig({ alleyApiBase: alleyBase.trim().replace(/\/$/, "") });
    await refreshConfig();
    setMsg("Saved. New requests use this service address.");
  };

  const check = async () => {
    setUpdate(await api.checkForUpdates());
  };

  return (
    <div className="page stagger" style={{ maxWidth: 640, display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="card">
        <h3>Sound</h3>
        <ToggleRow
          label="UI sounds"
          desc="Clicks and success chimes"
          value={cfg.sfxEnabled !== false}
          onChange={(v) => toggle("sfxEnabled", v)}
        />
        <ToggleRow
          label="Ping sound"
          desc="Plays a chime when someone @mentions you in team chat or replies to your support ticket"
          value={cfg.pingSoundEnabled !== false}
          onChange={(v) => toggle("pingSoundEnabled", v)}
        />
      </div>

      <div className="card">
        <h3>Notifications</h3>
        <ToggleRow
          label="Native notifications"
          desc="Shows a Windows notification for staff popups when the app is in the tray, minimized, or unfocused. Clicking it brings the app back."
          value={cfg.nativeNotificationsEnabled !== false}
          onChange={(v) => toggle("nativeNotificationsEnabled", v)}
        />
      </div>

      <div className="card">
        <h3>Window</h3>
        <ToggleRow
          label="Run in tray"
          desc="Closing the window keeps Booth Manager in the system tray so peer file sharing stays online"
          value={cfg.runInTray !== false}
          onChange={(v) => toggle("runInTray", v)}
        />
        <ToggleRow
          label="Start with Windows"
          desc="Launches Booth Manager minimized to the tray when you sign in to Windows"
          value={cfg.startWithWindows === true}
          onChange={(v) => toggle("startWithWindows", v)}
        />
      </div>

      <div className="card">
        <h3>Updates</h3>
        <div className="row">
          <div className="grow">
            <div className="small" style={{ fontWeight: 600 }}>Booth Manager v{version}</div>
            <div className="muted tiny mt8">
              {update?.status === "available" && `Update ${update.latestVersion} is available.`}
              {update?.status === "downloading" && `Downloading... ${update.progress}%`}
              {update?.status === "downloaded" && "Update downloaded, restart to install."}
              {update?.status === "uptodate" && "You are up to date."}
              {update?.status === "checking" && "Checking..."}
              {update?.status === "error" && `Update check failed: ${update.error}`}
              {(!update || update.status === "idle") && "Checks automatically on launch and every 30 minutes."}
            </div>
          </div>
          {update?.status === "available" && <button className="primary" onClick={() => api.downloadUpdate()}>Download</button>}
          {update?.status === "downloaded" && <button className="primary" onClick={() => api.installUpdate()}>Restart now</button>}
          <button onClick={check}>Check now</button>
        </div>
      </div>

      <div className="card">
        <h3>Service</h3>
        <label className="field"><span>Legends Alley service address</span>
          <input type="url" value={alleyBase} onChange={(e) => setAlleyBase(e.target.value)} />
        </label>
        <div className="row">
          <button onClick={saveBases}>Save</button>
          {msg && <span className="muted small">{msg}</span>}
        </div>
      </div>

      <div className="card">
        <h3>Account</h3>
        <div className="row account-row">
          {cfg.alleyAvatarUrl && <img className="account-avatar" src={cfg.alleyAvatarUrl} alt="" />}
          <div className="grow">
            <div className="small" style={{ fontWeight: 600 }}>{cfg.alleyUsername || "Signed in with Discord"}</div>
            <div className="muted tiny mt8 account-details">
              <span>{cfg.alleyCommunityName || (cfg.alleyStaff ? "Alley staff account" : "No community linked")}</span>
              <span>{cfg.alleyGroupId || (cfg.alleyStaff ? "All communities" : "VRChat group ID pending")}</span>
              <span className="rolebadge">{String(cfg.alleyRole || (cfg.alleyStaff ? "staff" : "team")).toUpperCase()}</span>
            </div>
          </div>
          <button className="danger" onClick={onLogout}>Sign out</button>
        </div>
      </div>

      <div className="card danger-card">
        <h3>Uninstall</h3>
        <div className="row account-row">
          <div className="grow">
            <div className="small" style={{ fontWeight: 600 }}>Remove Booth Manager from this computer</div>
            <div className="muted tiny mt8">Launches the Windows uninstaller and closes the app. Your Legends Alley uploads stay on the server.</div>
          </div>
          {!confirmUninstall && <button className="danger" onClick={() => setConfirmUninstall(true)}>Uninstall</button>}
          {confirmUninstall && (
            <>
              <button onClick={() => setConfirmUninstall(false)}>Keep it</button>
              <button className="danger" onClick={() => api.uninstallApp()}>Yes, uninstall</button>
            </>
          )}
        </div>
      </div>

      <div className="muted tiny" style={{ padding: "0 4px" }}>
        Proprietary software of VRChat Legends. All rights reserved.
        Standee concept credit: Sketch494's Auto-Standee (original implementation, no GPL code).
      </div>
    </div>
  );
}

function ToggleRow({ label, desc, value, onChange }) {
  return (
    <label className="switch-row settings-toggle">
      <div className="grow">
        <div className="small" style={{ fontWeight: 600 }}>{label}</div>
        <div className="muted tiny">{desc}</div>
      </div>
      <input type="checkbox" checked={value} onChange={(event) => onChange(event.target.checked)} />
      <span className="switch-track"><span /></span>
    </label>
  );
}
