import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "./api.js";
import { applyChatPatch, chatProfileKey, CHAT_DEFAULTS, createChatPreferenceWriter, readChatProfile } from "./chatPreferences.mjs";

const persist = createChatPreferenceWriter({ read: api.getConfig, write: api.saveConfig });

export default function useChatPreferences(cfg, refreshConfig) {
  const key = chatProfileKey(cfg);
  const [profile, setProfile] = useState(() => readChatProfile(cfg));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const current = useRef(profile);
  const committed = useRef(profile);
  const pending = useRef(0);
  const revision = useRef(0);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => {
    if (pending.current) return;
    const next = readChatProfile(cfg);
    current.current = next;
    committed.current = next;
    setProfile(next);
  }, [cfg.chatProfiles, key]);

  const update = useCallback(async (patch, roomId = "") => {
    if (!key) { setSaveError("Sign in again to save account-specific chat preferences."); return; }
    const ticket = ++revision.current;
    pending.current += 1;
    current.current = applyChatPatch(current.current, patch, roomId);
    setProfile(current.current);
    setSaving(true);
    setSaveError("");
    try {
      const saved = await persist(key, patch, roomId);
      committed.current = saved;
      if (live.current && ticket === revision.current) {
        current.current = saved;
        setProfile(saved);
      }
    } catch (error) {
      if (live.current && ticket === revision.current) {
        current.current = committed.current;
        setProfile(committed.current);
        setSaveError(error.message || "Could not save chat preferences.");
      }
    } finally {
      pending.current -= 1;
      if (live.current) {
        setSaving(pending.current > 0);
        if (!pending.current) Promise.resolve(refreshConfig?.()).catch(() => {});
      }
    }
  }, [key, refreshConfig]);

  return { profile, saving, saveError, disabled: !key, update, reset: () => update(CHAT_DEFAULTS) };
}