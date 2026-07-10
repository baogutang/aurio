// Online listener roster — who is connected, whether they are actually
// listening (the cost gate), and the freshest playback position for the brain.
//
// The controller election is gone (P3 cutover): the server-side playout
// timeline is authoritative, every client is a full client, and this module
// keeps exactly two jobs — a roster ("may the station spend money?") and the
// validated positionSec/durationSec heartbeat the DJ prompt reads.
import crypto from 'node:crypto';
import { eventBus } from './event-bus.js';
import { station } from '../playout/station.js';

const ACTIVE_TTL_MS = 45000;

/** @type {Map<string, object>} */
const clients = new Map();

function fresh(c, maxAgeMs) {
  return c && Date.now() - c.lastSeen <= maxAgeMs;
}

// The freshest listening (un-paused) client; falls back to the freshest
// connected one so position data survives a brief pause.
function primary() {
  let bestListening = null;
  let bestAny = null;
  for (const c of clients.values()) {
    if (!bestAny || c.lastSeen > bestAny.lastSeen) bestAny = c;
    if (!c.paused && (!bestListening || c.lastSeen > bestListening.lastSeen)) {
      bestListening = c;
    }
  }
  return bestListening || bestAny;
}

export const clientSessionManager = {
  register(ws, meta = {}) {
    const clientId = crypto.randomUUID();
    clients.set(clientId, {
      clientId,
      ws,
      connectedAt: Date.now(),
      lastSeen: Date.now(),
      paused: true,
      currentTrack: null,
      itemId: null,
      positionSec: null,
      durationSec: null,
      userAgent: meta.userAgent || '',
    });
    eventBus.emit('session:connected', { clientId });
    return { clientId };
  },

  unregister(clientId) {
    clients.delete(clientId);
    eventBus.emit('session:disconnected', { clientId });
  },

  onHeartbeat(clientId, state = {}) {
    const c = clients.get(clientId);
    if (!c) return null;
    c.paused = !!state.paused;
    if (state.currentTrack && typeof state.currentTrack === 'object') {
      c.currentTrack = state.currentTrack;
    }
    c.itemId = state.itemId != null ? String(state.itemId) : c.itemId;
    // Playback position (contract A). Validate hard: finite, non-negative, and
    // never past the duration when we have one. Garbage → null, not stored.
    const dur = Number(state.durationSec);
    c.durationSec = Number.isFinite(dur) && dur >= 0 ? dur : null;
    const pos = Number(state.positionSec);
    c.positionSec = Number.isFinite(pos) && pos >= 0 && (!(c.durationSec > 0) || pos <= c.durationSec)
      ? pos
      : null;
    c.lastSeen = Date.now();
    eventBus.emit('session:updated', { ...c });
    return c;
  },

  /** The heartbeat source for the brain's observation (agent/loop.js). */
  getController() {
    return primary() || null;
  },

  /**
   * The cost gate: LLM composition and TTS synthesis need somebody actually
   * listening within the TTL. Cursor advance never asks.
   */
  hasActiveSession(maxAgeMs = ACTIVE_TTL_MS) {
    for (const c of clients.values()) {
      if (!c.paused && fresh(c, maxAgeMs)) return true;
    }
    return false;
  },

  /** Items after the on-air one, given the log view length (agent/loop.js). */
  remaining(queueLen) {
    const len = Number.isFinite(queueLen) ? queueLen : 0;
    return station.current() ? Math.max(0, len - 1) : len;
  },

  getPlaybackState() {
    const c = primary();
    const onAir = station.current();
    return {
      playingIndex: onAir ? 0 : -1,
      paused: c?.paused ?? true,
      queueLen: station.viewTracks().length,
      controllerId: c?.clientId ?? null,
      observers: clients.size,
      currentTrack: c?.currentTrack ?? (onAir?.track || null),
    };
  },

  clientCount() {
    return clients.size;
  },
};
