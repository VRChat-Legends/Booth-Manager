const validObject = (value) => value && typeof value === "object" && !Array.isArray(value);

export function normalizeMessages(value) {
  if (!Array.isArray(value)) throw new Error("The chat service returned an invalid message list.");
  const byId = new Map();
  for (const item of value) {
    if (!validObject(item) || !["string", "number"].includes(typeof item.id) || !String(item.id)) continue;
    byId.set(String(item.id), {
      ...item, id: String(item.id), body: typeof item.body === "string" ? item.body : "",
      authorName: typeof item.authorName === "string" ? item.authorName : "Unknown member",
      attachments: Array.isArray(item.attachments) ? item.attachments.filter((attachment) => validObject(attachment) && attachment.id) : []
    });
  }
  return [...byId.values()].sort((a, b) => {
    const before = Date.parse(a.createdAt);
    const after = Date.parse(b.createdAt);
    return Number.isFinite(before) && Number.isFinite(after) ? before - after : 0;
  });
}

export function createRoomFeed({ roomId, request, publish, onIncoming = () => {}, onMessages = () => {} }) {
  let active = true;
  let inFlight = null;
  let membersFlight = null;
  let revision = 0;
  let mutations = [];
  let seen = new Set();
  let state = { messages: [], room: null, members: [], loading: true, refreshing: false, hasLoaded: false, error: "", membersError: "", updatedAt: null };
  const emit = (patch) => {
    state = { ...state, ...patch };
    if (active) publish(state);
  };
  const invoke = (callback, value) => { if (active) { try { Promise.resolve(callback(value)).catch(() => {}); } catch {} } };

  const refresh = () => {
    if (!active || !roomId) return Promise.resolve();
    if (inFlight) return inFlight;
    const startedAt = revision;
    emit({ loading: !state.hasLoaded, refreshing: state.hasLoaded });
    inFlight = (async () => {
      try {
        const result = await request(`/api/chat/messages?communityId=${encodeURIComponent(roomId)}&limit=300`);
        if (!active) return;
        if (result?.status !== 200) throw new Error(result?.error || "Messages could not be refreshed. Your draft is safe.");
        let next = normalizeMessages(result.data?.messages);
        mutations = mutations.filter((mutation) => mutation.revision > startedAt);
        for (const mutation of mutations) {
          next = next.filter((message) => message.id !== mutation.id);
          if (mutation.message) next.push(mutation.message);
        }
        next = normalizeMessages(next);
        const incoming = state.hasLoaded ? next.filter((message) => !seen.has(message.id)) : [];
        next.forEach((message) => seen.add(message.id));
        if (seen.size > 2000) seen = new Set([...seen].slice(-1000));
        emit({ messages: next, room: validObject(result.data?.community) ? result.data.community : null, hasLoaded: true, error: "", updatedAt: new Date().toISOString() });
        invoke(onMessages, next);
        if (incoming.length) invoke(onIncoming, incoming);
      } catch (error) {
        if (active) emit({ error: error.message || "Chat is unavailable." });
      }
    })().finally(() => {
      inFlight = null;
      if (active) emit({ loading: false, refreshing: false });
    });
    return inFlight;
  };

  const refreshMembers = () => {
    if (!active || !roomId) return Promise.resolve();
    if (membersFlight) return membersFlight;
    membersFlight = (async () => {
      try {
        const result = await request(`/api/chat/members?communityId=${encodeURIComponent(roomId)}`);
        if (!active) return;
        if (result?.status !== 200 || !Array.isArray(result.data?.members)) throw new Error(result?.error || "The member list is unavailable.");
        emit({ members: result.data.members.filter(validObject), membersError: "" });
      } catch (error) {
        if (active) emit({ membersError: error.message || "The member list is unavailable." });
      }
    })().finally(() => { membersFlight = null; });
    return membersFlight;
  };

  return {
    refresh, refreshMembers,
    append(message) {
      if (!active) return;
      const normalized = normalizeMessages([message])[0];
      if (!normalized) return;
      mutations.push({ revision: ++revision, id: normalized.id, message: normalized });
      seen.add(normalized.id);
      const messages = normalizeMessages([...state.messages.filter((item) => item.id !== normalized.id), normalized]);
      emit({ messages });
      invoke(onMessages, messages);
    },
    remove(id) {
      if (!active) return;
      mutations.push({ revision: ++revision, id: String(id) });
      emit({ messages: state.messages.filter((message) => message.id !== String(id)) });
    },
    dispose() { active = false; },
    getState: () => state
  };
}