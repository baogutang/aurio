// Radio stream engine — the "导播台". Keeps the show flowing: watches the active
// player's heartbeat and refills the queue before it runs dry, so the stream
// never stops. Server-driven, but decides off the player's reported state
// (node can't know playback position on its own).
import { runSegment } from './dj.js';

const LOW_WATER = 2;   // refill once this few (or fewer) tracks remain after current
const TICK_MS = 8000;  // fallback re-check, in case a heartbeat is missed

let session = null;    // { playingIndex, paused, queueLen, lastSeen }
let composing = false;
let timer = null;

export function onHeartbeat(state = {}) {
  session = {
    playingIndex: Number.isFinite(state.playingIndex) ? state.playingIndex : -1,
    paused: !!state.paused,
    queueLen: Number.isFinite(state.queueLen) ? state.queueLen : 0,
    lastSeen: Date.now(),
  };
  maybeRefill();
}

// Client disconnected → suspend the stream (stop composing, save resources).
export function onClientGone() {
  session = null;
}

// Current playing index from the latest heartbeat (-1 if unknown). Used by the
// DJ to place interjections relative to the now-playing track.
export function currentIndex() {
  return session ? session.playingIndex : -1;
}

function remaining() {
  if (!session) return Infinity;
  return session.queueLen - session.playingIndex - 1;
}

async function maybeRefill() {
  if (composing || !session || session.paused) return;
  if (session.playingIndex < 0) return;        // nothing playing yet → don't auto-start
  if (remaining() > LOW_WATER) return;
  composing = true;
  try {
    const b = await runSegment({ kind: 'station' }, { mode: 'append' });
    if (b && Array.isArray(b.queue) && session) {
      session.queueLen += b.queue.length;       // optimistic; next heartbeat corrects
    }
  } catch (e) {
    console.error('[radio] refill failed:', e.message);
  } finally {
    composing = false;
  }
}

export function startRadio() {
  if (timer) return;
  timer = setInterval(() => { if (session && !session.paused) maybeRefill(); }, TICK_MS);
  console.log('[radio] stream engine started');
}

export function stopRadio() {
  if (timer) clearInterval(timer);
  timer = null;
}
