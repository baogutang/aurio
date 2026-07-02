// Per-client playback sessions with controller election for refill / insert placement.
import crypto from 'node:crypto';
import { eventBus } from './event-bus.js';

const ACTIVE_TTL_MS = 45000;
const GRACE_MS = 30000;

/** @type {Map<string, object>} */
const clients = new Map();
let controllerId = null;
let graceTimer = null;

function pickController() {
  let best = null;
  for (const [id, c] of clients) {
    if (c.playingIndex < 0) continue;
    if (!best) {
      best = { id, ...c };
      continue;
    }
    if (c.lastSeen > best.lastSeen) {
      best = { id, ...c };
    } else if (c.lastSeen === best.lastSeen) {
      if (c.playingIndex > best.playingIndex) {
        best = { id, ...c };
      } else if (c.playingIndex === best.playingIndex && id === controllerId) {
        best = { id, ...c };
      }
    }
  }
  if (best) {
    controllerId = best.id;
    return best;
  }
  controllerId = clients.size ? [...clients.keys()][0] : null;
  return controllerId ? { id: controllerId, ...clients.get(controllerId) } : null;
}

function roleFor(clientId) {
  pickController();
  return controllerId === clientId ? 'controller' : 'observer';
}

export const clientSessionManager = {
  register(ws, meta = {}) {
    const clientId = crypto.randomUUID();
    const session = {
      clientId,
      ws,
      connectedAt: Date.now(),
      lastSeen: Date.now(),
      playingIndex: -1,
      paused: true,
      queueLen: 0,
      queueRevision: 0,
      currentTrack: null,
      role: 'observer',
      userAgent: meta.userAgent || '',
    };
    clients.set(clientId, session);
    if (graceTimer) {
      clearTimeout(graceTimer);
      graceTimer = null;
    }
    pickController();
    session.role = roleFor(clientId);
    eventBus.emit('session:connected', { clientId, role: session.role });
    return { clientId, role: session.role };
  },

  unregister(clientId) {
    clients.delete(clientId);
    if (controllerId === clientId) controllerId = null;
    pickController();
    this.broadcastRoles();
    if (clients.size === 0 && !graceTimer) {
      graceTimer = setTimeout(() => {
        graceTimer = null;
        if (clients.size === 0) eventBus.emit('session:all-gone');
      }, GRACE_MS);
      if (graceTimer.unref) graceTimer.unref();
    }
    eventBus.emit('session:disconnected', { clientId });
  },

  onHeartbeat(clientId, state = {}) {
    const c = clients.get(clientId);
    if (!c) return null;
    c.playingIndex = Number.isFinite(state.playingIndex) ? state.playingIndex : -1;
    c.paused = !!state.paused;
    c.queueLen = Number.isFinite(state.queueLen) ? state.queueLen : 0;
    c.queueRevision = Number.isFinite(state.queueRevision) ? state.queueRevision : c.queueRevision;
    if (state.currentTrack && typeof state.currentTrack === 'object') {
      c.currentTrack = state.currentTrack;
    }
    c.lastSeen = Date.now();
    const prevRole = c.role;
    c.role = roleFor(clientId);
    const roleChanged = prevRole !== c.role;
    if (roleChanged) {
      eventBus.emit('session:role', { clientId, role: c.role, controllerId });
    }
    eventBus.emit('session:updated', { ...c });
    if (roleChanged) this.broadcastRoles();
    return c;
  },

  broadcastRoles() {
    pickController();
    const ctrlId = controllerId;
    for (const [id, c] of clients) {
      c.role = ctrlId === id ? 'controller' : 'observer';
      this.sendTo(id, { type: 'session', clientId: id, role: c.role, controllerId: ctrlId });
    }
  },

  getController() {
    pickController();
    if (!controllerId) return null;
    return clients.get(controllerId) || null;
  },

  isController(clientId) {
    pickController();
    return !!clientId && controllerId === clientId;
  },

  currentIndex(maxAgeMs) {
    const c = this.getController();
    if (!c) return -1;
    if (maxAgeMs != null && Date.now() - c.lastSeen > maxAgeMs) return -1;
    return c.playingIndex;
  },

  indexFresh(maxAgeMs = 15000) {
    const c = this.getController();
    if (!c) return false;
    return Date.now() - c.lastSeen <= maxAgeMs;
  },

  hasActiveSession(maxAgeMs = ACTIVE_TTL_MS) {
    const c = this.getController();
    if (!c) return false;
    if (Date.now() - c.lastSeen > maxAgeMs) return false;
    return c.playingIndex >= 0 || c.queueLen > 0;
  },

  remaining(queueLen) {
    const c = this.getController();
    const len = Number.isFinite(queueLen) ? queueLen : (c?.queueLen ?? 0);
    const idx = c ? c.playingIndex : -1;
    if (idx < 0) return len;
    return Math.max(0, len - idx - 1);
  },

  getPlaybackState() {
    const c = this.getController();
    return {
      playingIndex: c?.playingIndex ?? -1,
      paused: c?.paused ?? true,
      queueLen: c?.queueLen ?? 0,
      controllerId,
      observers: clients.size,
      revision: c?.queueRevision ?? 0,
      currentTrack: c?.currentTrack ?? null,
    };
  },

  broadcast(msg, sendFn) {
    const payload = JSON.stringify(msg);
    for (const c of clients.values()) {
      if (c.ws?.readyState === 1) c.ws.send(payload);
    }
    if (sendFn) sendFn(msg);
  },

  sendTo(clientId, msg) {
    const c = clients.get(clientId);
    if (c?.ws?.readyState === 1) c.ws.send(JSON.stringify(msg));
  },

  clientCount() {
    return clients.size;
  },
};
