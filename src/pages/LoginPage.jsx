import { useState } from "react";

export default function LoginPage({ onLogin, error, logoUrl }) {
  const [busy, setBusy] = useState(false);

  const handle = async () => {
    setBusy(true);
    try {
      await onLogin();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="card login-card">
        <img className="logo" src={logoUrl} alt="Legends Alley" />
        <h1>Booth Manager</h1>
        <div className="tag">Legends Alley Community Companion</div>
        <p className="muted small" style={{ marginBottom: 26 }}>
          Community chat, retained booth backups, and event tools for approved
          Legends Alley teams. Use the Discord account linked to your community.
        </p>
        {busy ? (
          <div className="center" style={{ padding: 10 }}>
            <div className="spinner" />
            <div className="muted small mt12">Waiting for Discord in your browser...</div>
          </div>
        ) : (
          <button className="discord" onClick={handle} style={{ width: "100%" }}>
            Sign in with Discord
          </button>
        )}
        {error && <div className="errbox">{error}</div>}
      </div>
    </div>
  );
}
