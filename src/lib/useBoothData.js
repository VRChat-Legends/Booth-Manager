import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "./api.js";
import { loadBoothSnapshot } from "./boothData.mjs";

export default function useBoothData({ cfg, scope = "mine" }) {
  const key = JSON.stringify([cfg.alleyDiscordId, cfg.alleyCommunityId, cfg.alleyStaff === true, cfg.alleyToken, scope]);
  const [state, setState] = useState({ key: "", data: null, loading: true, error: "" });
  const refreshRef = useRef(null);
  const refresh = useCallback(() => refreshRef.current?.(), []);

  useEffect(() => {
    let disposed = false;
    let pending = false;
    const load = async () => {
      if (pending || disposed) return;
      pending = true;
      setState((current) => ({ key, data: current.key === key ? current.data : null, loading: true, error: current.key === key ? current.error : "" }));
      try {
        const data = await loadBoothSnapshot(api.alley, { scope, isStaff: cfg.alleyStaff === true, communityId: cfg.alleyCommunityId });
        if (!disposed) setState({ key, data, loading: false, error: "" });
      } catch (exception) {
        if (!disposed) setState((current) => ({ key, data: current.key === key ? current.data : null, loading: false, error: String(exception?.message || "The Alley service could not be reached.") }));
      } finally {
        pending = false;
      }
    };
    refreshRef.current = load;
    load();
    const timer = window.setInterval(() => { if (!document.hidden) load(); }, 60_000);
    return () => {
      disposed = true;
      refreshRef.current = null;
      window.clearInterval(timer);
    };
  }, [key]);

  return { ...(state.key === key ? state : { data: null, loading: true, error: "" }), refresh };
}