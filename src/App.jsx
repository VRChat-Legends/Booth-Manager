import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Boxes,
  Bug,
  Building2,
  Combine,
  Download,
  Image,
  LayoutDashboard,
  LifeBuoy,
  LockKeyhole,
  Megaphone,
  MessageSquareText,
  Package,
  Palette,
  QrCode,
  ScrollText,
  Settings,
  ShieldCheck,
  Sparkles,
  UploadCloud
} from "lucide-react";
import * as api from "./lib/api.js";
import * as audio from "./lib/audio.js";
import { MarkdownView, BroadcastMedia } from "./lib/markdown.jsx";
import peerFiles from "./lib/peerFiles.js";
import LoginPage from "./pages/LoginPage.jsx";
import DashboardPage from "./pages/DashboardPage.jsx";
import BoothsPage from "./pages/BoothsPage.jsx";
import AlleyDashboardPage from "./pages/AlleyDashboardPage.jsx";
import AlleyAdminPage from "./pages/AlleyAdminPage.jsx";
import StandeePage from "./pages/StandeePage.jsx";
import SettingsPage from "./pages/SettingsPage.jsx";
import TeamChatPage from "./pages/TeamChatPage.jsx";
import ChangelogPage from "./pages/ChangelogPage.jsx";
import BugsPage from "./pages/BugsPage.jsx";
import SupportPage from "./pages/SupportPage.jsx";
import UnitySdkPage from "./pages/UnitySdkPage.jsx";
import QrPage from "./pages/QrPage.jsx";
import logoUrl from "../assets/app-icon.png";

const NAV = [
  { section: "Workspace" },
  { id: "dashboard", label: "Dashboard", Icon: LayoutDashboard },
  { id: "booths", label: "Booth Backups", Icon: Boxes },
  { id: "chat", label: "Team Chat", Icon: MessageSquareText },
  { section: "Alley service" },
  { id: "alleyDashboard", label: "Community", Icon: Building2, communityOnly: true },
  { id: "alleyAdmin", label: "Alley Admin", Icon: ShieldCheck, staffOnly: true },
  { section: "Tools" },
  { id: "builder", label: "Booth Builder", Icon: Box, badge: "Soon", disabled: true },
  { id: "standee", label: "Standee Studio", Icon: Sparkles },
  { id: "unitySdk", label: "Unity SDK", Icon: Package },
  { id: "qr", label: "QR Codes", Icon: QrCode },
  {
    id: "atlas",
    label: "Texture Atlas",
    Icon: Combine,
    badge: "Soon",
    disabled: true,
    tooltip: "Coming soon: upload a 3D model with its textures and get back a single combined texture atlas, with an optional toggle to compress everything into one mesh"
  },
  {
    id: "worldPosters",
    label: "World Posters",
    Icon: Image,
    badge: "Soon",
    disabled: true,
    tooltip: "Coming soon: design and export polished posters for your VRChat worlds"
  },
  {
    id: "promo",
    label: "Promo Studio",
    Icon: Palette,
    badge: "Soon",
    disabled: true,
    tooltip: "Coming soon: banners, social posts, and invite graphics generated from your community branding"
  },
  { section: "Resources" },
  { id: "support", label: "Support", Icon: LifeBuoy },
  { id: "bugs", label: "Bug Tracker", Icon: Bug },
  { id: "changelog", label: "Change Log", Icon: ScrollText }
];

const TITLES = {
  dashboard: "Dashboard",
  booths: "Booth Backups",
  chat: "Team Chat",
  alleyDashboard: "Community",
  alleyAdmin: "Alley Admin",
  standee: "Standee Studio",
  unitySdk: "Unity SDK",
  qr: "QR Codes",
  support: "Support",
  bugs: "Bug Tracker",
  changelog: "Change Log",
  settings: "Settings"
};

/** First line or so of a popup's markdown as plain text for the native
 * notification body (strips headings, emphasis, links, images, quotes). */
function plainTextSnippet(markdown, max = 160) {
  const text = String(markdown || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,3}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

export default function App() {
  const [cfg, setCfg] = useState(null);
  const [page, setPage] = useState("dashboard");
  const [checking, setChecking] = useState(true);
  const [loginError, setLoginError] = useState("");
  const [event, setEvent] = useState(null);
  const [platformLock, setPlatformLock] = useState(false);
  const [newUploads, setNewUploads] = useState([]);
  const [update, setUpdate] = useState(null);
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const [popups, setPopups] = useState([]);
  const [ticketAttention, setTicketAttention] = useState(0);
  const sessionStartRef = useRef(new Date().toISOString());
  const seenBroadcastsRef = useRef(new Set());
  const ticketSeenRef = useRef({ byId: new Map(), primed: false });

  const refreshConfig = useCallback(async () => {
    const next = await api.getConfig();
    setCfg(next);
    return next;
  }, []);

  useEffect(() => {
    let disposed = false;
    (async () => {
      const current = await refreshConfig();
      audio.setSfxEnabled(current.sfxEnabled !== false);
      audio.setPingEnabled(current.pingSoundEnabled !== false);
      if (current.alleyToken) {
        const result = await api.alley("/api/auth/me");
        if (!disposed && (result.status === 401 || result.status === 403)) {
          setLoginError(result.error || "Your Alley session expired. Sign in again.");
        }
        await refreshConfig();
      }
      if (!disposed) setChecking(false);
    })();

    const off = api.onUpdateState(setUpdate);
    api.getUpdateState().then(setUpdate);
    const onClick = (pointerEvent) => {
      if (pointerEvent.target.closest("button, .navitem, .tab, .clickable")) audio.click();
    };
    window.addEventListener("pointerdown", onClick, true);
    // stray drops outside a drop zone must never navigate the window to file://
    const swallowDrag = (dragEvent) => dragEvent.preventDefault();
    window.addEventListener("dragover", swallowDrag);
    window.addEventListener("drop", swallowDrag);
    return () => {
      disposed = true;
      off?.();
      window.removeEventListener("pointerdown", onClick, true);
      window.removeEventListener("dragover", swallowDrag);
      window.removeEventListener("drop", swallowDrag);
    };
  }, [refreshConfig]);

  useEffect(() => {
    if (!cfg?.alleyToken) {
      setEvent(null);
      setPlatformLock(false);
      return undefined;
    }
    let disposed = false;
    const load = async () => {
      // manual staff lock applies even when no event is live
      api.alley("/api/public/app-status").then((status) => {
        if (!disposed && status.status === 200) setPlatformLock(status.data?.appLocked === true);
      });
      let result = await api.alley("/api/events/current");
      if (result.status === 200) {
        if (!disposed && result.data?.event) setEvent(result.data.event);
        return;
      }
      if (result.status !== 404) return; // transient failure (rate limit, offline): keep the last good event
      result = await api.alley("/api/events");
      if (result.status !== 200) return;
      const events = result.data?.events || [];
      const selected = events.find((item) => item.active) || events[0] || null;
      if (!disposed && selected) setEvent(selected);
    };
    load();
    const timer = window.setInterval(load, 60_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [cfg?.alleyToken]);

  useEffect(() => {
    if (!cfg?.alleyToken || !cfg?.alleyDiscordId) {
      peerFiles.stop();
      return undefined;
    }
    peerFiles.start({
      userId: cfg.alleyDiscordId,
      communityId: cfg.alleyCommunityId,
      staff: cfg.alleyStaff === true
    });
    return () => peerFiles.stop();
  }, [cfg?.alleyToken, cfg?.alleyDiscordId, cfg?.alleyCommunityId, cfg?.alleyStaff]);

  useEffect(() => {
    if (!cfg?.alleyToken || !cfg?.alleyCommunityId) {
      setNewUploads([]);
      return undefined;
    }
    let disposed = false;
    const check = async () => {
      const result = await api.alley("/api/booths/mine");
      if (result.status !== 200 || disposed) return;
      const uploads = result.data?.booths || [];
      const ids = uploads.map((booth) => String(booth.id));
      if (cfg.seenBoothUploadsInitialized !== true) {
        const saved = await api.saveConfig({ seenBoothUploadIds: ids, seenBoothUploadsInitialized: true });
        if (!disposed) setCfg(saved);
        return;
      }
      const seen = new Set((cfg.seenBoothUploadIds || []).map(String));
      setNewUploads(uploads.filter((booth) => !seen.has(String(booth.id))));
    };
    check();
    const timer = window.setInterval(check, 60_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [cfg?.alleyToken, cfg?.alleyCommunityId, cfg?.seenBoothUploadsInitialized, cfg?.seenBoothUploadIds]);

  const loggedIn = Boolean(cfg?.alleyToken);
  const isStaff = cfg?.alleyStaff === true;
  const appLocked = (event?.appLocked === true || platformLock) && !isStaff;
  const effectivePage = appLocked && page !== "settings" ? "booths" : page;

  const visibleNav = useMemo(
    () => NAV.filter((item) => item.section || ((!item.staffOnly || isStaff) && (!item.communityOnly || cfg?.alleyCommunityId))),
    [isStaff, cfg?.alleyCommunityId]
  );

  const login = useCallback(async () => {
    setLoginError("");
    const result = await api.alleyLogin();
    if (!result.ok) {
      setLoginError(result.error === "timeout" ? "Sign in timed out. Try again." : String(result.error || "Sign in failed."));
      return;
    }
    audio.success();
    await api.alley("/api/auth/me");
    await refreshConfig();
    setPage("dashboard");
  }, [refreshConfig]);

  const logout = useCallback(async () => {
    peerFiles.stop();
    await api.alleyLogout();
    await refreshConfig();
  }, [refreshConfig]);

  // Staff popups plus the access watchdog: this loop runs against the strict
  // membership middleware, so a removed team member or a deactivated
  // community turns into a 401/403 here and signs the app out.
  //
  // Delivery is a long-poll: the service holds /api/broadcasts/wait for up
  // to ~25s and resolves the moment staff hit send, so popups (and their
  // native notifications) land within a second instead of on a poll cycle.
  // Older service builds without /wait fall back to the 45s flat poll.
  useEffect(() => {
    if (!cfg?.alleyToken) return undefined;
    let disposed = false;
    let fallbackTimer = 0;
    let longPollSupported = true;
    // advances past everything already delivered so a resolved long-poll
    // does not re-return the same broadcasts in a tight loop
    let since = sessionStartRef.current;

    const deliver = (broadcasts) => {
      const seen = seenBroadcastsRef.current;
      const sessionStart = Date.parse(sessionStartRef.current);
      for (const broadcast of broadcasts || []) {
        if (Date.parse(broadcast.createdAt) > Date.parse(since)) since = broadcast.createdAt;
      }
      const fresh = (broadcasts || []).filter((broadcast) =>
        !seen.has(broadcast.id) && Date.parse(broadcast.createdAt) >= sessionStart);
      for (const broadcast of fresh) seen.add(broadcast.id);
      if (!fresh.length) return;
      audio.ping();
      setPopups((current) => [...current, ...fresh]);
      // Native notification when the window is hidden (tray), minimized, or
      // unfocused; skipped when the user is looking at the in-app popup.
      if (document.hidden || !document.hasFocus()) {
        for (const broadcast of fresh) {
          api.notifyNative({
            title: broadcast.createdByName || "Alley Staff",
            body: plainTextSnippet(broadcast.body) || broadcast.title || "New staff popup"
          });
        }
      }
    };

    const handle = async (result) => {
      if (disposed) return false;
      if (result.status === 401 || result.status === 403) {
        setLoginError(result.error || "Your Legends Alley access changed. Sign in again.");
        setPopups([]);
        await logout();
        return false;
      }
      if (result.status === 404) longPollSupported = false;
      if (result.status === 200) deliver(result.data?.broadcasts);
      return true;
    };

    const loop = async () => {
      while (!disposed && longPollSupported) {
        const result = await api.alley(`/api/broadcasts/wait?since=${encodeURIComponent(since)}`);
        if (!(await handle(result))) return;
        // network hiccup or unsupported: breathe before the next cycle
        if (result.status !== 200) await new Promise((resolve) => setTimeout(resolve, 5000));
      }
      if (disposed) return;
      const poll = async () => {
        const result = await api.alley(`/api/broadcasts?since=${encodeURIComponent(since)}`);
        await handle(result);
      };
      poll();
      fallbackTimer = window.setInterval(poll, 45_000);
    };
    loop();

    return () => {
      disposed = true;
      window.clearInterval(fallbackTimer);
    };
  }, [cfg?.alleyToken, logout]);

  // Ticket activity: same ping language as chat mentions plus a nav badge.
  // Users hear about staff replies; staff hear about tickets entering the
  // needs-reply queue.
  useEffect(() => {
    if (!cfg?.alleyToken) {
      setTicketAttention(0);
      return undefined;
    }
    ticketSeenRef.current = { byId: new Map(), primed: false };
    let disposed = false;
    const poll = async () => {
      const result = isStaff
        ? await api.alley("/api/tickets?status=awaiting_staff")
        : await api.alley("/api/tickets/mine");
      if (disposed || result.status !== 200) return;
      const list = result.data?.tickets || [];
      const relevant = isStaff
        ? list
        : list.filter((ticket) => ticket.status === "awaiting_user");
      setTicketAttention(isStaff ? (result.data?.counts?.awaitingStaff ?? relevant.length) : relevant.length);
      const seen = ticketSeenRef.current;
      if (seen.primed) {
        const hasNews = relevant.some((ticket) => {
          const last = seen.byId.get(ticket.id);
          return !last || Date.parse(ticket.lastMessageAt || ticket.updatedAt) > last;
        });
        if (hasNews) audio.ping();
      }
      seen.byId = new Map(relevant.map((ticket) => [ticket.id, Date.parse(ticket.lastMessageAt || ticket.updatedAt)]));
      seen.primed = true;
    };
    poll();
    const timer = window.setInterval(poll, 60_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [cfg?.alleyToken, isStaff]);

  const acknowledgeUploads = useCallback(async () => {
    if (!newUploads.length) return;
    const ids = [...new Set([
      ...(cfg.seenBoothUploadIds || []).map(String),
      ...newUploads.map((booth) => String(booth.id))
    ])];
    const saved = await api.saveConfig({ seenBoothUploadIds: ids, seenBoothUploadsInitialized: true });
    setCfg(saved);
    setNewUploads([]);
  }, [cfg, newUploads]);

  if (checking) return <div className="login-wrap"><div className="spinner" /></div>;
  if (!loggedIn) return <LoginPage onLogin={login} error={loginError} logoUrl={logoUrl} />;

  const PageComponent = {
    dashboard: DashboardPage,
    booths: BoothsPage,
    chat: TeamChatPage,
    alleyDashboard: AlleyDashboardPage,
    alleyAdmin: AlleyAdminPage,
    standee: StandeePage,
    unitySdk: UnitySdkPage,
    qr: QrPage,
    support: SupportPage,
    bugs: BugsPage,
    changelog: ChangelogPage,
    settings: SettingsPage
  }[effectivePage] || DashboardPage;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <img src={logoUrl} alt="" />
          <div><div className="t1">Booth Manager</div><div className="t2">Legends Alley</div></div>
        </div>
        <div className="nav-scroll">
          {visibleNav.map((item, index) => item.section ? (
            <div key={`section-${index}`} className="nav-section">{item.section}</div>
          ) : (
            <button
              type="button"
              key={item.id}
              className={`navitem${effectivePage === item.id ? " active" : ""}`}
              disabled={item.disabled || (appLocked && item.id !== "booths")}
              title={item.disabled ? (item.tooltip || "Coming soon") : appLocked && item.id !== "booths" ? "Backup-only mode is active" : ""}
              onClick={() => !item.disabled && setPage(item.id)}
            >
              <item.Icon className="ico" size={17} strokeWidth={1.8} />
              <span>{item.label}</span>
              {item.id === "support" && ticketAttention > 0 && <span className="nav-badge attention">{ticketAttention}</span>}
              {item.badge && <span className="nav-badge">{item.badge}</span>}
            </button>
          ))}
        </div>
        <div className="sidebar-status">
          <span className="service-dot online" />
          <span>{cfg.alleyCommunityName || (isStaff ? "Alley staff" : "Alley connected")}</span>
        </div>
        <button type="button" className={`navitem${effectivePage === "settings" ? " active" : ""}`} onClick={() => setPage("settings")}>
          <Settings className="ico" size={17} strokeWidth={1.8} /><span>Settings</span>
        </button>
      </aside>

      <main className="main">
        {update && !updateDismissed && ["available", "downloading", "downloaded"].includes(update.status) && (
          <UpdateBanner update={update} onDismiss={() => setUpdateDismissed(true)} />
        )}
        {appLocked && <LockBanner event={event} manual={platformLock && event?.appLocked !== true} />}
        {newUploads.length > 0 && (
          <div className="new-upload-banner">
            <UploadCloud size={18} />
            <div>
              <strong>{newUploads.length === 1 ? "A new booth backup is ready" : `${newUploads.length} new booth backups are ready`}</strong>
              <span>Your latest server upload is available to inspect and download.</span>
            </div>
            <button className="primary small right" onClick={() => { setPage("booths"); acknowledgeUploads(); }}>View backups</button>
            <button className="ghost small" onClick={acknowledgeUploads}>Dismiss</button>
          </div>
        )}
        <header className="topbar">
          <div className="topbar-heading">
            <span>Legends Alley</span>
            <strong>{appLocked && effectivePage === "booths" ? "Backup Mode" : TITLES[effectivePage]}</strong>
          </div>
          <div className="spacer" />
          <div className="community-chip">
            <FallbackImage className="chip-logo" src={cfg.alleyLogoUrl} fallback={<Building2 size={15} />} />
            <span>
              <strong>{cfg.alleyCommunityName || "Alley Staff"}</strong>
              <small>{cfg.alleyGroupId || (isStaff ? "All communities" : "Group ID pending")}</small>
            </span>
            <span className="rolebadge">{String(cfg.alleyRole || (isStaff ? "staff" : "team")).toUpperCase()}</span>
          </div>
          <div className="userchip">
            <FallbackImage
              src={cfg.alleyAvatarUrl}
              fallback={<div className="avatar compact-avatar">{(cfg.alleyUsername || "?")[0]?.toUpperCase()}</div>}
            />
            <span className="name">{cfg.alleyUsername || "Signed in"}</span>
          </div>
        </header>
        <div className="content" key={effectivePage}>
          <PageComponent
            cfg={cfg}
            refreshConfig={refreshConfig}
            isAdmin={isStaff}
            goTo={setPage}
            onLogout={logout}
            event={event}
            appLocked={appLocked}
            newUploadIds={new Set(newUploads.map((booth) => String(booth.id)))}
            onAcknowledgeUploads={acknowledgeUploads}
          />
        </div>
      </main>
      {popups.length > 0 && (
        <BroadcastPopup
          broadcast={popups[0]}
          onDismiss={() => setPopups((current) => current.slice(1))}
        />
      )}
    </div>
  );
}

/** Image that swaps to a fallback node when the source is empty or fails
 * to load (expired Discord avatar, rate-limited logo fetch, offline). */
function FallbackImage({ src, className, fallback }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) return fallback || null;
  return <img className={className} src={src} alt="" onError={() => setFailed(true)} />;
}

function BroadcastPopup({ broadcast, onDismiss }) {
  const media = (broadcast.assets || []).filter((asset) => ["image", "video", "audio"].includes(asset.kind));
  const files = (broadcast.assets || []).filter((asset) => asset.kind === "file");
  return (
    <div className="modal-scrim broadcast-scrim">
      <div className="modal broadcast-popup" onClick={(clickEvent) => clickEvent.stopPropagation()}>
        <div className="broadcast-head">
          <span className="broadcast-badge"><Megaphone size={13} /> ALLEY STAFF</span>
          <h2>{broadcast.title || "Message from the Alley staff"}</h2>
          <span className="broadcast-byline">{broadcast.createdByName} | {api.formatDate(broadcast.createdAt)}</span>
        </div>
        {broadcast.body && <MarkdownView text={broadcast.body} />}
        {media.length > 0 && (
          <div className="broadcast-media">
            {media.map((asset) => <BroadcastMedia key={asset.id} asset={asset} />)}
          </div>
        )}
        {files.length > 0 && (
          <div className="broadcast-files">
            {files.map((asset) => (
              <button key={asset.id} className="ghost" onClick={() => api.alleyDownload(`/api/broadcasts/assets/${asset.id}`, asset.name)}>
                <Download size={14} /><strong>{asset.name}</strong><small>{api.formatBytes(asset.size)}</small>
              </button>
            ))}
          </div>
        )}
        <div className="actions"><button className="primary" onClick={onDismiss}>Got it</button></div>
      </div>
    </div>
  );
}

function LockBanner({ event, manual }) {
  return (
    <div className="lock-banner">
      <LockKeyhole size={17} />
      <div>
        <strong>Backup-only mode is active</strong>
        <span>{manual
          ? "Alley staff temporarily locked the app. Editing and collaboration tools are paused; retained booth ZIP downloads remain available."
          : `${event?.name || "The event"} begins within five days. Editing and collaboration tools are locked to protect the final event build; retained booth ZIP downloads remain available.`}</span>
      </div>
    </div>
  );
}

function UpdateBanner({ update, onDismiss }) {
  return (
    <div className="update-banner">
      {update.status === "available" && <><strong>Update {update.latestVersion || ""} is available</strong><span className="muted">A new Booth Manager release is ready.</span><span className="right" /><button className="primary small" onClick={() => api.downloadUpdate()}>Download</button><button className="ghost small" onClick={onDismiss}>Later</button></>}
      {update.status === "downloading" && <><strong>Downloading update</strong><div className="bar"><div style={{ width: `${update.progress || 0}%` }} /></div><span className="muted">{update.progress || 0}%</span></>}
      {update.status === "downloaded" && <><strong>Update ready</strong><span className="muted">Restart to finish installing.</span><span className="right" /><button className="primary small" onClick={() => api.installUpdate()}>Restart now</button><button className="ghost small" onClick={onDismiss}>Later</button></>}
    </div>
  );
}