(() => {
  if (!["127.0.0.1", "localhost"].includes(location.hostname) && !(location.protocol === "file:" && window.__chatNative)) throw new Error("Chat fixtures only run against the local preview.");
  const clone = (value) => structuredClone(value);
  const cfg = {
    alleyApiBase: "https://chat-fixture.invalid", alleyToken: "isolated-chat-fixture",
    alleyDiscordId: "test-self", alleyUsername: "Cadyn", alleyStaff: true, alleyRole: "owner",
    alleyCommunityId: "room-a", alleyCommunityName: "Test Creators", alleyAvatarUrl: "", alleyLogoUrl: "",
    sfxEnabled: false, pingSoundEnabled: false, nativeNotificationsEnabled: true,
    seenBoothUploadIds: [], seenBoothUploadsInitialized: true,
    chatProfiles: JSON.parse(sessionStorage.getItem("__chatFixturePreferences") || "{}")
  };
  const rooms = [
    { communityId: "room-a", name: "Test Creators", memberCount: 3, lastMessage: "The booth preview is ready.", locked: false },
    { communityId: "room-b", name: "Event Planning", memberCount: 2, lastMessage: "Saturday rehearsal schedule", locked: false },
    { communityId: "global", name: "Alley Lounge", global: true, locked: false },
    { communityId: "room-empty", name: "New Community", locked: false }
  ];
  const members = [
    { id: "test-self", name: "Cadyn", role: "owner" },
    { id: "test-avery", name: "Avery", role: "manager" },
    { id: "test-morgan", name: "Morgan", role: "member" }
  ];
  const topics = [
    "The booth preview is ready for a final check.", "Can we review the entrance lighting before rehearsal?",
    "@Cadyn the material budget looks good on the latest build.", "I have updated the event schedule.",
    "The atlas export reduced our material count.", "Thanks, the new layout is much easier to navigate."
  ];
  const now = Date.now();
  const messages = Array.from({ length: 28 }, (_, index) => ({
    id: `a-${index}`, authorId: members[index % 3].id, authorName: members[index % 3].name,
    authorRole: members[index % 3].role, body: topics[index % topics.length],
    createdAt: new Date(now - (28 - index) * 16 * 60_000).toISOString(), attachments: []
  }));
  messages[9].attachments = [{ id: "fixture-file", name: "rehearsal-notes.txt", size: 1536, mime: "text/plain", kind: "file", authorId: "test-avery", available: false }];
  messages[23].body = "Avery is checking the poster placement.";
  Object.assign(messages[27], { authorId: "test-morgan", authorName: "Morgan", authorRole: "member", createdAt: new Date(Date.parse(messages[26].createdAt) + 60_000).toISOString() });
  const fixture = window.__chatFixture = {
    cfg, rooms, members,
    messages: {
      "room-a": messages,
      "room-b": [{ id: "b-1", authorId: "test-avery", authorName: "Avery", authorRole: "manager", body: "Saturday rehearsal schedule is posted here.", createdAt: new Date(now - 300_000).toISOString(), attachments: [] }],
      global: [{ id: "g-1", authorId: "test-morgan", authorName: "Morgan", authorRole: "member", body: "Welcome to the Alley Lounge.", createdAt: new Date(now - 200_000).toISOString(), attachments: [] }],
      "room-empty": []
    },
    notifications: [], requests: [], errors: [], sent: [], deferred: [], links: [],
    failMessages: false, failSave: false, failSend: false, holdRoom: "", holdSend: false,
    nextFiles: { ok: false, canceled: true }
  };
  window.addEventListener("error", (event) => fixture.errors.push(event.message));
  window.addEventListener("unhandledrejection", (event) => fixture.errors.push(String(event.reason)));
  const request = async (path, options = {}) => {
    fixture.requests.push({ path, method: options.method || "GET" });
    const url = new URL(path, "https://fixture.invalid");
    const roomId = url.searchParams.get("communityId") || options.json?.communityId;
    if (path.startsWith("/api/broadcasts/wait")) return new Promise(() => {});
    if (path === "/api/chat/rooms") return { status: 200, data: { rooms: clone(rooms) } };
    if (url.pathname === "/api/chat/members") return { status: 200, data: { members: clone(members) } };
    if (url.pathname === "/api/chat/messages" && options.method === "POST") {
      if (fixture.failSend) return { status: 503, error: "Simulated send failure" };
      const message = {
        id: `sent-${fixture.sent.length}`, authorId: cfg.alleyDiscordId, authorName: cfg.alleyUsername,
        authorRole: cfg.alleyRole, body: options.json.body, attachments: clone(options.json.attachments || []), createdAt: new Date().toISOString()
      };
      const finish = () => {
        fixture.messages[roomId].push(message);
        fixture.sent.push({ roomId, message });
        return { status: 201, data: { message: clone(message) } };
      };
      if (fixture.holdSend) return new Promise((resolve) => fixture.deferred.push({ kind: "send", roomId, resolve: () => resolve(finish()) }));
      return finish();
    }
    if (url.pathname === "/api/chat/messages") {
      if (fixture.failMessages) return { status: 503, error: "Simulated offline snapshot" };
      const result = { status: 200, data: { messages: clone(fixture.messages[roomId] || []), community: clone(rooms.find((room) => room.communityId === roomId)) } };
      if (fixture.holdRoom === roomId) return new Promise((resolve) => fixture.deferred.push({ kind: "messages", roomId, resolve: () => resolve(result) }));
      return result;
    }
    if (url.pathname.startsWith("/api/chat/messages/") && options.method === "DELETE") {
      fixture.messages[roomId] = fixture.messages[roomId].filter((message) => message.id !== decodeURIComponent(url.pathname.split("/").pop()));
      return { status: 200, data: {} };
    }
    if (path === "/api/chat/lock") {
      rooms.find((room) => room.communityId === roomId).locked = options.json.locked;
      return { status: 200, data: { locked: options.json.locked } };
    }
    if (path.startsWith("/api/chat/")) return { status: 200, data: { signals: [], attachments: [] } };
    if (path === "/api/events/current") return { status: 404, data: {} };
    if (path === "/api/events") return { status: 200, data: { events: [] } };
    if (path.includes("/booths")) return { status: 200, data: { booths: [] } };
    if (path === "/api/auth/me") return { status: 200, data: { user: clone(cfg) } };
    if (path.includes("tickets")) return { status: 200, data: { tickets: [] } };
    if (path === "/api/public/app-status") return { status: 200, data: { appLocked: false } };
    if (path.includes("broadcasts")) return { status: 200, data: { broadcasts: [] } };
    return { status: 200, data: {} };
  };
  window.boothApi = {
    getConfig: async () => clone(cfg),
    saveConfig: async (patch) => {
      if (fixture.failSave) throw new Error("Simulated settings write failure");
      Object.assign(cfg, clone(patch));
      sessionStorage.setItem("__chatFixturePreferences", JSON.stringify(cfg.chatProfiles));
      return clone(cfg);
    },
    alleyRequest: request, getAppVersion: async () => "2.4.1-test", getUpdateState: async () => ({ status: "idle" }),
    onUpdateState: () => () => {}, getWindowState: async () => ({ visible: true }),
    listLocalShares: async () => ({ files: [], folders: [] }), getLocalShareStatus: async () => ({ ok: false }),
    notifyNative: async (payload) => { fixture.notifications.push(payload); return { ok: true }; },
    openSharedFiles: async () => clone(fixture.nextFiles), openSharedFolder: async () => ({ ok: false, canceled: true }),
    pathForFile: () => "", addSharedPaths: async () => ({ ok: false, files: [], folders: [] }),
    openExternal: async (url) => { fixture.links.push(url); return { ok: true }; },
    alleyLogout: async () => { cfg.alleyToken = ""; cfg.alleyDiscordId = ""; return { ok: true }; }, checkForUpdates: async () => ({ status: "uptodate" }),
    githubReleases: async () => ({ status: 200, data: [] }), githubIssues: async () => ({ status: 200, data: [] }),
    githubSdkReleases: async () => ({ status: 200, data: [] }), showInFolder: async () => {},
    saveFileDialog: async () => ({ ok: false, canceled: true })
  };
  Object.assign(window.boothApi, window.__chatNative || {});
})();