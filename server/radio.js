// Radio stream engine — watches the active controller heartbeat and refills the queue.
import { runSegment } from './dj.js';
import { clientSessionManager } from './runtime/client-session-manager.js';
import { eventBus } from './runtime/event-bus.js';
import { queueController } from './runtime/queue-controller.js';

const LOW_WATER = 5;
const TICK_MS = 8000;
const ACTIVE_TTL_MS = 90000;

let composing = false;
let timer = null;
let sessionSuspended = false;

export function onHeartbeat() {
  sessionSuspended = false;
  maybeRefill();
}

export function onClientGone() {
  sessionSuspended = true;
}

eventBus.on('session:all-gone', () => onClientGone());
eventBus.on('session:connected', () => { sessionSuspended = false; });
eventBus.on('queue:changed', () => {
  if (!sessionSuspended && hasActiveSession()) maybeRefill();
});

export function currentIndex() {
  return clientSessionManager.currentIndex();
}

export function hasActiveSession(maxAgeMs = ACTIVE_TTL_MS) {
  if (sessionSuspended) return false;
  return clientSessionManager.hasActiveSession(maxAgeMs);
}

export function remainingTracks() {
  const snap = queueController.peekSnapshot();
  const serverRem = clientSessionManager.remaining(snap.queue.length);
  const c = clientSessionManager.getController();
  if (c && c.playingIndex >= 0 && c.queueLen > 0) {
    const clientRem = Math.max(0, c.queueLen - c.playingIndex - 1);
    return Math.min(serverRem, clientRem);
  }
  return serverRem;
}

export async function maybeRefill() {
  if (composing || sessionSuspended) return;
  if (!hasActiveSession()) return;

  const snap = queueController.peekSnapshot();
  const idx = currentIndex();
  if (idx < 0 && snap.queue.length === 0) return;
  if (remainingTracks() > LOW_WATER) return;

  composing = true;
  let holdComposing = false;
  try {
    const b = await runSegment({ kind: 'refill', text: '' }, { mode: 'append' });
    if (b?.error === 'busy' || b?.error === 'superseded') {
      holdComposing = true;
      setTimeout(() => {
        composing = false;
        maybeRefill();
      }, 2500);
      return;
    }
    if (!b?.error && remainingTracks() <= LOW_WATER) {
      holdComposing = true;
      composing = false;
      setImmediate(() => maybeRefill());
      return;
    }
  } catch (e) {
    console.error('[radio] refill failed:', e.message);
  } finally {
    if (!holdComposing) composing = false;
  }
}

export function startRadio() {
  if (timer) return;
  timer = setInterval(() => {
    if (!sessionSuspended && hasActiveSession()) maybeRefill();
  }, TICK_MS);
  console.log('[radio] stream engine started');
}

export function stopRadio() {
  if (timer) clearInterval(timer);
  timer = null;
}
