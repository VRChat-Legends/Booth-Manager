"use strict";

// Discord sign-in starts a loopback HTTP
// listener on 127.0.0.1, opens the system browser, and resolves when the
// backend bounces back.

const http = require("http");
const crypto = require("crypto");
const { shell } = require("electron");

const TIMEOUT_MS = 3 * 60 * 1000;

function pageHtml(title, message) {
  const esc = (s) =>
    String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return (
    "<!doctype html><html><head><title>" + esc(title) + "</title></head>" +
    '<body style="background:#080B10;color:#E8EDF2;font-family:Segoe UI,sans-serif;display:grid;place-items:center;height:100vh;margin:0">' +
    '<div style="text-align:center;padding:2.4rem 3rem;border:1px solid rgba(0,230,204,.3);border-radius:1rem;background:#12161D">' +
    '<h2 style="color:#00E6CC;margin-top:0">' + esc(title) + "</h2>" +
    '<p style="color:#8B95A0">' + esc(message) + "</p></div></body></html>"
  );
}

function listenOnLoopback(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

/**
 * Alley service sign-in (same grant/exchange protocol as the Legends Alley
 * Unity SDK): loopback receives ?grant=..., we trade grant+verifier for a JWT.
 */
async function loginAlley(alleyApiBase) {
  const base = String(alleyApiBase || "https://alley.vrchatlegends.com").replace(/\/$/, "");
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier, "ascii").digest("base64url");

  const grant = await new Promise(async (resolveOuter) => {
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { server.close(); } catch { /* ignore */ }
      resolveOuter(result);
    };

    const server = http.createServer((req, res) => {
      const url = new URL(req.url, "http://127.0.0.1");
      if (url.pathname !== "/callback") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(pageHtml("Legends Alley", "Nothing to see here."));
        return;
      }
      const err = url.searchParams.get("error");
      if (err) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(pageHtml("Sign in failed", err));
        done({ ok: false, error: err });
        return;
      }
      const g = url.searchParams.get("grant");
      if (!g) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(pageHtml("Sign in failed", "The sign in response was missing its grant. Try again."));
        done({ ok: false, error: "missing grant" });
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(pageHtml("Connected", "You can close this tab and head back to Booth Manager."));
      done({ ok: true, grant: g });
    });

    let timer = null;
    try {
      const port = await listenOnLoopback(server);
      timer = setTimeout(() => done({ ok: false, error: "timeout" }), TIMEOUT_MS);
      await shell.openExternal(`${base}/api/auth/sdk/start?port=${port}&challenge=${encodeURIComponent(challenge)}`);
    } catch (ex) {
      done({ ok: false, error: String(ex && ex.message ? ex.message : ex) });
    }
  });

  if (!grant.ok) return grant;

  try {
    const res = await fetch(`${base}/api/auth/sdk/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grant: grant.grant, verifier })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.token) {
      return { ok: false, error: body.error || `exchange failed (${res.status})` };
    }
    return {
      ok: true,
      token: body.token,
      community: body.community || null,
      staff: body.staff === true,
      role: body.role || "",
      user: body.user || null
    };
  } catch (ex) {
    return { ok: false, error: String(ex && ex.message ? ex.message : ex) };
  }
}

module.exports = { loginAlley };
