import * as api from "./api.js";

const ICE_CONFIG = {
  iceServers: [
    { urls: "stun:stun.cloudflare.com:3478" },
    { urls: "stun:stun.l.google.com:19302" }
  ]
};
const POLL_MS = 900;
const HEARTBEAT_MS = 30_000;
const BUFFER_HIGH_WATER = 1024 * 1024;
const BUFFER_LOW_WATER = 256 * 1024;

function sessionId() {
  return `peer_${crypto.randomUUID().replace(/-/g, "")}`;
}

function asArrayBuffer(value) {
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  }
  return new Uint8Array(value).buffer;
}

function waitForWritable(channel) {
  if (channel.bufferedAmount < BUFFER_HIGH_WATER) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      channel.removeEventListener("bufferedamountlow", ready);
      reject(new Error("The peer connection stopped accepting file data."));
    }, 30_000);
    const ready = () => {
      window.clearTimeout(timeout);
      channel.removeEventListener("bufferedamountlow", ready);
      resolve();
    };
    channel.bufferedAmountLowThreshold = BUFFER_LOW_WATER;
    channel.addEventListener("bufferedamountlow", ready);
  });
}

class PeerFileService {
  constructor() {
    this.identity = null;
    this.peers = new Map();
    this.transfers = new Map();
    // roomId -> Set of own attachment ids we heartbeat for that room; ticket
    // rooms ride along beside the active chat room so ticket files stay
    // servable while the uploader is anywhere in the app
    this.watchedByRoom = new Map();
    this.listeners = new Set();
    this.pollTimer = 0;
    this.heartbeatTimer = 0;
    this.polling = false;
    this.heartbeating = false;
    this.lastHeartbeatAt = 0;
    this.extraPollIndex = 0;
  }

  start(identity) {
    const next = identity?.userId
      ? {
          userId: String(identity.userId),
          communityId: String(identity.communityId || ""),
          staff: identity.staff === true
        }
      : null;
    const currentKey = this.identity
      ? `${this.identity.userId}:${this.identity.communityId}:${this.identity.staff}`
      : "";
    const nextKey = next ? `${next.userId}:${next.communityId}:${next.staff}` : "";
    if (currentKey === nextKey) return;
    this.stop();
    this.identity = next;
    if (!next) return;
    this.pollTimer = window.setInterval(() => this.pollSignals(), POLL_MS);
    this.heartbeatTimer = window.setInterval(() => this.heartbeat(), HEARTBEAT_MS);
    this.pollSignals();
    this.refreshOwnedAttachments();
  }

  stop() {
    window.clearInterval(this.pollTimer);
    window.clearInterval(this.heartbeatTimer);
    this.pollTimer = 0;
    this.heartbeatTimer = 0;
    for (const peer of this.peers.values()) this.closePeer(peer);
    this.peers.clear();
    this.watchedByRoom.clear();
    this.transfers.clear();
    this.lastHeartbeatAt = 0;
    this.identity = null;
    this.emit();
  }

  setCommunity(communityId) {
    if (!this.identity) return;
    const next = String(communityId || "");
    if (this.identity.communityId === next) return;
    for (const peer of this.peers.values()) this.closePeer(peer);
    this.peers.clear();
    // ticket-room watches survive room switches so those shares stay alive;
    // the outgoing chat room's watch entry is rebuilt when we return to it
    for (const roomId of [...this.watchedByRoom.keys()]) {
      if (!roomId.startsWith("ticket-")) this.watchedByRoom.delete(roomId);
    }
    this.transfers.clear();
    this.lastHeartbeatAt = 0;
    this.identity = { ...this.identity, communityId: next };
    this.emit();
    this.pollSignals();
    this.refreshOwnedAttachments();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  snapshot() {
    return Object.fromEntries(this.transfers.entries());
  }

  emit() {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  setTransfer(attachmentId, patch) {
    const id = String(attachmentId || "");
    this.transfers.set(id, { ...(this.transfers.get(id) || {}), ...patch });
    this.emit();
  }

  async sendSignal(recipientId, peer, type, payload = {}) {
    const roomId = peer.roomId || this.identity?.communityId;
    if (!roomId) return;
    await api.alley("/api/chat/signals", {
      method: "POST",
      json: {
        communityId: roomId,
        recipientId: String(recipientId),
        sessionId: peer.sessionId,
        attachmentId: peer.attachmentId,
        type,
        payload
      }
    });
  }

  createPeer({ id, attachmentId, remoteId, direction, roomId }) {
    const pc = new RTCPeerConnection(ICE_CONFIG);
    const peer = {
      sessionId: id,
      attachmentId: String(attachmentId),
      remoteId: String(remoteId),
      roomId: String(roomId || this.identity?.communityId || ""),
      direction,
      pc,
      channel: null,
      receiveQueue: Promise.resolve(),
      received: 0,
      expected: 0,
      descriptionSent: false,
      localCandidates: [],
      done: false
    };
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        const candidate = event.candidate.toJSON();
        if (peer.descriptionSent) this.sendSignal(peer.remoteId, peer, "ice", { candidate });
        else peer.localCandidates.push(candidate);
      }
    };
    pc.onconnectionstatechange = () => {
      if (!peer.done && ["failed", "disconnected", "closed"].includes(pc.connectionState)) {
        this.failPeer(peer, "The uploader is offline or the peer connection could not be established.");
      }
    };
    this.peers.set(id, peer);
    return peer;
  }

  async flushLocalCandidates(peer) {
    peer.descriptionSent = true;
    const pending = peer.localCandidates.splice(0);
    for (const candidate of pending) {
      await this.sendSignal(peer.remoteId, peer, "ice", { candidate });
    }
  }

  closePeer(peer) {
    peer.done = true;
    try { peer.channel?.close(); } catch { /* ignore */ }
    try { peer.pc?.close(); } catch { /* ignore */ }
    this.peers.delete(peer.sessionId);
  }

  failPeer(peer, message) {
    if (peer.done) return;
    api.cancelIncomingFile(peer.sessionId);
    this.setTransfer(peer.attachmentId, { status: "error", error: String(message || "Peer transfer failed."), progress: 0 });
    this.closePeer(peer);
  }

  async request(attachment, communityId) {
    if (!this.identity?.userId) throw new Error("Connect to Legends Alley first.");
    if (communityId) this.setCommunity(communityId);
    if (!this.identity.communityId) throw new Error("Choose a community chat room first.");

    // Our own attachments resolve straight from disk, regardless of what the
    // server availability flag says (heartbeats may simply not have landed yet).
    if (String(attachment?.authorId) === this.identity.userId) {
      const local = await api.getLocalShareStatus(attachment.id);
      this.setTransfer(attachment.id, local.available
        ? { status: "ready", progress: 1, localUrl: local.localUrl, own: true, name: attachment.name }
        : { status: "unavailable", error: "This file was moved, changed, or deleted on this computer." });
      return;
    }

    if (!attachment?.available) {
      this.setTransfer(attachment?.id, { status: "unavailable", error: "The uploader's local file is not available." });
      return;
    }

    const existing = this.transfers.get(attachment.id);
    if (["requesting", "connecting", "transferring"].includes(existing?.status)) return;
    const id = sessionId();
    const peer = this.createPeer({ id, attachmentId: attachment.id, remoteId: attachment.authorId, direction: "download", roomId: this.identity.communityId });
    const channel = peer.pc.createDataChannel("attachment", { ordered: true });
    this.configureDownloadChannel(peer, channel, attachment);
    this.setTransfer(attachment.id, { status: "requesting", progress: 0, error: "", sessionId: id, name: attachment.name });
    const offer = await peer.pc.createOffer();
    await peer.pc.setLocalDescription(offer);
    const result = await api.alley("/api/chat/signals", {
      method: "POST",
      json: {
        communityId: this.identity.communityId,
        recipientId: String(attachment.authorId),
        sessionId: id,
        attachmentId: attachment.id,
        type: "offer",
        payload: { description: peer.pc.localDescription.toJSON() }
      }
    });
    if (result.status !== 201) this.failPeer(peer, result.error || "Could not contact the uploader.");
    else await this.flushLocalCandidates(peer);
  }

  configureDownloadChannel(peer, channel, attachment) {
    peer.channel = channel;
    channel.binaryType = "arraybuffer";
    channel.onopen = () => this.setTransfer(peer.attachmentId, { status: "connecting", progress: 0 });
    channel.onerror = () => this.failPeer(peer, "The peer file channel failed.");
    channel.onmessage = (event) => {
      peer.receiveQueue = peer.receiveQueue
        .then(() => this.receivePart(peer, event.data, attachment))
        .catch((error) => this.failPeer(peer, error.message || error));
    };
  }

  async receivePart(peer, data, attachment) {
    if (typeof data === "string") {
      const message = JSON.parse(data);
      if (message.type === "meta") {
        peer.expected = Number(message.size) || 0;
        const result = await api.beginIncomingFile(peer.sessionId, {
          name: message.name || attachment.name,
          size: peer.expected,
          mime: message.mime || attachment.mime
        });
        if (!result.ok) throw new Error(result.error || "Could not open the temporary download.");
        this.setTransfer(peer.attachmentId, { status: "transferring", progress: 0 });
        return;
      }
      if (message.type === "error") throw new Error(message.error || "The uploader could not read this file.");
      if (message.type === "end") {
        const result = await api.finishIncomingFile(peer.sessionId);
        if (!result.ok) throw new Error(result.error || "The received file was incomplete.");
        peer.done = true;
        this.setTransfer(peer.attachmentId, {
          status: "ready",
          progress: 1,
          localUrl: result.localUrl,
          sessionId: peer.sessionId,
          name: result.name,
          mime: result.mime,
          own: false
        });
        window.setTimeout(() => this.closePeer(peer), 500);
      }
      return;
    }

    const bytes = data instanceof Blob ? await data.arrayBuffer() : asArrayBuffer(data);
    const result = await api.appendIncomingFile(peer.sessionId, bytes);
    if (!result.ok) throw new Error(result.error || "Could not write the incoming file.");
    peer.received = result.received;
    const progress = peer.expected > 0 ? Math.min(1, peer.received / peer.expected) : 0;
    this.setTransfer(peer.attachmentId, { status: "transferring", progress });
  }

  async acceptOffer(signal, roomId) {
    const local = await api.getLocalShareStatus(signal.attachmentId);
    if (!local.available) {
      const tempPeer = { sessionId: signal.sessionId, attachmentId: signal.attachmentId, roomId };
      await this.sendSignal(signal.senderId, tempPeer, "unavailable", {});
      if (roomId) {
        await api.alley(`/api/chat/attachments/${encodeURIComponent(signal.attachmentId)}/status`, {
          method: "POST",
          json: { communityId: roomId, available: false }
        });
      }
      return;
    }

    const peer = this.createPeer({
      id: signal.sessionId,
      attachmentId: signal.attachmentId,
      remoteId: signal.senderId,
      direction: "upload",
      roomId
    });
    peer.pc.ondatachannel = (event) => this.configureUploadChannel(peer, event.channel, local);
    await peer.pc.setRemoteDescription(signal.payload.description);
    const answer = await peer.pc.createAnswer();
    await peer.pc.setLocalDescription(answer);
    await this.sendSignal(peer.remoteId, peer, "answer", { description: peer.pc.localDescription.toJSON() });
    await this.flushLocalCandidates(peer);
  }

  configureUploadChannel(peer, channel, local) {
    peer.channel = channel;
    channel.binaryType = "arraybuffer";
    channel.onopen = () => this.sendLocalFile(peer, local).catch((error) => {
      try { channel.send(JSON.stringify({ type: "error", error: String(error.message || error) })); } catch { /* ignore */ }
      window.setTimeout(() => this.closePeer(peer), 250);
    });
    channel.onerror = () => this.closePeer(peer);
  }

  async sendLocalFile(peer, local) {
    const channel = peer.channel;
    channel.send(JSON.stringify({ type: "meta", name: local.name, size: local.size, mime: local.mime }));
    let offset = 0;
    while (offset < local.size && channel.readyState === "open") {
      await waitForWritable(channel);
      const chunk = await api.readLocalShareChunk(local.id, offset, 64 * 1024);
      if (!chunk.ok) throw new Error(chunk.error || "The local file is no longer available.");
      if (Number(chunk.offset) <= offset) throw new Error("The local file ended before the transfer completed.");
      channel.send(asArrayBuffer(chunk.data));
      offset = chunk.offset;
    }
    if (offset !== local.size || channel.readyState !== "open") throw new Error("The peer connection closed before upload completed.");
    await waitForWritable(channel);
    channel.send(JSON.stringify({ type: "end" }));
    peer.done = true;
    window.setTimeout(() => this.closePeer(peer), 1500);
  }

  async handleSignal(signal, roomId) {
    if (signal.type === "offer") {
      await this.acceptOffer(signal, roomId);
      return;
    }
    const peer = this.peers.get(signal.sessionId);
    if (!peer) return;
    if (signal.type === "answer") {
      await peer.pc.setRemoteDescription(signal.payload.description);
    } else if (signal.type === "ice" && signal.payload?.candidate) {
      await peer.pc.addIceCandidate(signal.payload.candidate);
    } else if (signal.type === "unavailable") {
      this.failPeer(peer, "The uploader's local file was moved, changed, or deleted.");
    } else if (signal.type === "cancel") {
      this.failPeer(peer, "The peer transfer was cancelled.");
    }
  }

  /** Rooms beyond the active chat room whose signals we answer: ticket
   * threads where this user has shared files. */
  extraSignalRooms() {
    const active = this.identity?.communityId || "";
    return [...this.watchedByRoom.keys()].filter((roomId) => roomId.startsWith("ticket-") && roomId !== active);
  }

  async pollRoomSignals(roomId) {
    const result = await api.alley(`/api/chat/signals?communityId=${encodeURIComponent(roomId)}`);
    if (result.status !== 200) return;
    for (const signal of result.data?.signals || []) {
      try {
        await this.handleSignal(signal, roomId);
      } catch (error) {
        const peer = this.peers.get(signal.sessionId);
        if (peer) this.failPeer(peer, error.message || error);
      }
    }
  }

  async pollSignals() {
    if (this.polling || !this.identity) return;
    this.polling = true;
    try {
      if (this.identity.communityId) await this.pollRoomSignals(this.identity.communityId);
      // round-robin one ticket room per cycle so held offers still reach us
      // without multiplying the poll rate by the number of rooms
      const extras = this.extraSignalRooms();
      if (extras.length) {
        this.extraPollIndex = (this.extraPollIndex + 1) % extras.length;
        await this.pollRoomSignals(extras[this.extraPollIndex]);
      }
    } finally {
      this.polling = false;
    }
  }

  watchAttachments(attachments, roomId) {
    if (!this.identity?.userId) return;
    const targetRoom = String(roomId || this.identity.communityId || "");
    if (!targetRoom) return;
    let watched = this.watchedByRoom.get(targetRoom);
    for (const attachment of attachments || []) {
      if (String(attachment.authorId) !== this.identity.userId) continue;
      if (!watched) {
        watched = new Set();
        this.watchedByRoom.set(targetRoom, watched);
      }
      watched.add(String(attachment.id));
      // folder entries heartbeat individually so per-file availability stays live
      for (const entry of attachment.entries || []) watched.add(String(entry.id));
    }
    // bound the side-channel work: keep at most the 6 most recent ticket rooms
    const ticketRooms = [...this.watchedByRoom.keys()].filter((key) => key.startsWith("ticket-"));
    while (ticketRooms.length > 6) this.watchedByRoom.delete(ticketRooms.shift());
    this.heartbeat();
  }

  async refreshOwnedAttachments() {
    if (!this.identity?.communityId) return;
    const result = await api.alley(`/api/chat/attachments/mine?communityId=${encodeURIComponent(this.identity.communityId)}`);
    if (result.status !== 200) return;
    this.watchAttachments(result.data?.attachments || []);
  }

  async heartbeat() {
    if (this.heartbeating || !this.identity) return;
    const rooms = [...this.watchedByRoom.entries()].filter(([, ids]) => ids.size);
    if (!rooms.length) return;
    if (Date.now() - this.lastHeartbeatAt < HEARTBEAT_MS - 1000) return;
    this.heartbeating = true;
    this.lastHeartbeatAt = Date.now();
    try {
      const local = new Map((await api.listLocalShares()).map((item) => [String(item.id), item]));
      for (const [roomId, ids] of rooms) {
        await api.alley("/api/chat/attachments/status", {
          method: "POST",
          json: {
            communityId: roomId,
            attachments: [...ids].map((id) => ({ id, available: local.get(id)?.available === true }))
          }
        });
      }
    } finally {
      this.heartbeating = false;
    }
  }

  async save(attachmentId) {
    const transfer = this.transfers.get(String(attachmentId));
    if (!transfer?.sessionId || transfer.own) return { ok: false, error: "This file is already local." };
    return api.saveIncomingFile(transfer.sessionId);
  }
}

const peerFiles = new PeerFileService();
export default peerFiles;
