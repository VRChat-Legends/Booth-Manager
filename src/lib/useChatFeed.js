import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "./api.js";
import peerFiles from "./peerFiles.js";
import { createRoomFeed } from "./chatFeed.mjs";

export function useChatRooms(ownRoomId) {
  const [state, setState] = useState({ rooms: null, loading: true, error: "" });
  const reload = useRef(null);
  useEffect(() => {
    let live = true;
    let running = false;
    const load = async () => {
      if (!live || running) return;
      running = true;
      setState((current) => ({ ...current, loading: current.rooms === null }));
      try {
        const result = await api.alley("/api/chat/rooms");
        if (!live) return;
        if (result?.status !== 200 || !Array.isArray(result.data?.rooms)) throw new Error(result?.error || "Could not load your rooms.");
        const rooms = result.data.rooms.filter((room) => room && room.communityId)
          .map((room) => ({ ...room, communityId: String(room.communityId) }));
        setState({ rooms, loading: false, error: "" });
      } catch (error) {
        if (live) setState((current) => ({ ...current, loading: false, error: error.message || "Rooms are unavailable." }));
      } finally { running = false; }
    };
    reload.current = load;
    load();
    const timer = window.setInterval(load, 30_000);
    return () => { live = false; reload.current = null; window.clearInterval(timer); };
  }, [ownRoomId]);
  return { ...state, refresh: useCallback(() => reload.current?.(), []) };
}

export default function useChatFeed(roomId, onIncoming) {
  const [state, setState] = useState({ messages: [], room: null, members: [], loading: true, refreshing: false, hasLoaded: false, error: "", membersError: "", updatedAt: null });
  const feed = useRef(null);
  const incoming = useRef(onIncoming);
  incoming.current = onIncoming;
  useEffect(() => {
    const session = createRoomFeed({
      roomId, request: api.alley, publish: setState,
      onIncoming: (messages) => incoming.current?.(messages),
      onMessages: (messages) => {
        peerFiles.setCommunity(roomId);
        peerFiles.watchAttachments(messages.flatMap((message) => message.attachments));
      }
    });
    feed.current = session;
    setState(session.getState());
    session.refresh();
    session.refreshMembers();
    const timer = window.setInterval(session.refresh, 3000);
    return () => { session.dispose(); window.clearInterval(timer); if (feed.current === session) feed.current = null; };
  }, [roomId]);
  return { ...state,
    refresh: useCallback(() => feed.current?.refresh(), []),
    refreshMembers: useCallback(() => feed.current?.refreshMembers(), []),
    append: useCallback((message) => feed.current?.append(message), []),
    remove: useCallback((id) => feed.current?.remove(id), [])
  };
}