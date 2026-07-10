// ensureHorizon — keeps the programme log holding at least horizonMs of
// airtime, replacing radio.js's tick + remainingTracks guessing.
//
// The playout engine's 'horizon-low' latch fires once per starvation; this
// keeper answers it (and re-checks on every programme change, so a failed
// refill or a skip into dead air self-heals). Cost rule (RADIO_AUDIT THE FIX):
//   · somebody listening  → compose through the brain (dj.runSegment refill)
//   · nobody / brain down → recommend() keeps the log fed with zero LLM spend
// Cold start included: an empty log at boot reads as horizonRemaining 0 and
// the first fill self-starts the station.
import { eventBus } from '../runtime/event-bus.js';

const RETRY_BASE_MS = 5000;
const MAX_FAIL_STREAK = 4;
const MAX_ROUNDS = 6;

/**
 * @param {object} opts
 * @param {() => number} opts.remaining      horizonRemaining in ms
 * @param {number} [opts.horizonMs]
 * @param {() => boolean} opts.hasListener   the cost gate
 * @param {() => Promise<number>} opts.compose   brain refill → tracks added
 * @param {() => Promise<number>} opts.fallback  recommend refill → tracks added
 * @param {(fn: () => void, ms: number) => any} [opts.setTimer]
 * @param {(h: any) => void} [opts.clearTimer]
 */
export function createHorizonKeeper({
  remaining,
  horizonMs = 5 * 60000,
  hasListener = () => false,
  compose,
  fallback,
  setTimer = (fn, ms) => { const h = setTimeout(fn, ms); h.unref?.(); return h; },
  clearTimer = (h) => clearTimeout(h),
} = {}) {
  let running = false;
  let rerun = false;
  let failStreak = 0;
  let retryTimer = null;

  function scheduleRetry() {
    if (retryTimer != null) return;
    retryTimer = setTimer(() => {
      retryTimer = null;
      void fill();
    }, RETRY_BASE_MS * Math.max(1, failStreak));
  }

  async function fill() {
    if (running) { rerun = true; return; }
    running = true;
    try {
      let rounds = 0;
      while (remaining() < horizonMs && rounds < MAX_ROUNDS) {
        rounds++;
        let added = 0;
        if (hasListener()) {
          try { added = await compose(); } catch (e) {
            console.error('[horizon] compose failed:', e.message);
            added = 0;
          }
        }
        if (!added) {
          try { added = await fallback(); } catch (e) {
            console.error('[horizon] fallback failed:', e.message);
            added = 0;
          }
        }
        if (added > 0) {
          failStreak = 0;
          continue;
        }
        failStreak++;
        if (failStreak <= MAX_FAIL_STREAK) scheduleRetry();
        return;
      }
    } finally {
      running = false;
      if (rerun) {
        rerun = false;
        if (remaining() < horizonMs) void fill();
      }
    }
  }

  return {
    /** Nudge the keeper; `reset` clears the give-up backoff (listener arrived). */
    poke({ reset = false } = {}) {
      if (reset) {
        failStreak = 0;
        if (retryTimer != null) {
          clearTimer(retryTimer);
          retryTimer = null;
        }
      }
      if (remaining() < horizonMs && retryTimer == null) void fill();
    },
    isFilling: () => running,
    stop() {
      if (retryTimer != null) {
        clearTimer(retryTimer);
        retryTimer = null;
      }
    },
  };
}

/**
 * Production wiring: dj compose + music recommend against the station.
 * Called once from index.js at startup; returns the keeper.
 */
export function wireHorizonKeeper({ station, runSegment, recommend, playbackUrl, hasListener, horizonMs }) {
  const keeper = createHorizonKeeper({
    remaining: () => station.horizonRemaining(),
    horizonMs,
    hasListener,
    compose: async () => {
      const b = await runSegment({ kind: 'refill', text: '' }, { mode: 'append' });
      if (b?.error) return 0;
      return Array.isArray(b?.queue) ? b.queue.length : 0;
    },
    fallback: async () => {
      const key = (t) => (t ? `${t.source}:${t.id}` : '');
      const recentKeys = station.items().slice(-30)
        .map((it) => key(it.track))
        .filter(Boolean);
      const avoid = new Set(recentKeys);
      // Rotation floor: even when the pool is small enough that repeats are
      // unavoidable (an unconfigured instance sees a short public chart),
      // never repeat back-to-back — and never starve the station over déjà vu.
      const tailAvoid = new Set(recentKeys.slice(-2));
      const pool = (await recommend(24)) || [];
      let tracks = pool.filter((t) => !avoid.has(key(t)));
      if (!tracks.length && pool.length) {
        tracks = pool.filter((t) => !tailAvoid.has(key(t)));
        if (!tracks.length) tracks = pool;
        console.log('[horizon] pool exhausted — rotating repeats back in');
      }
      tracks = tracks.slice(0, 5);
      // playbackUrl can HANG on a dead source (no adapter timeouts); a starving
      // keeper must never wedge on one track's URL.
      for (const t of tracks) {
        try {
          t.url = await Promise.race([
            playbackUrl(t),
            new Promise((resolve) => { const h = setTimeout(() => resolve(null), 8000); h.unref?.(); }),
          ]);
        } catch { t.url = null; }
      }
      tracks = tracks.filter((t) => t.url);
      if (!tracks.length) {
        console.error('[horizon] fallback found nothing playable');
        return 0;
      }
      return station.appendTracks(tracks).length;
    },
  });
  eventBus.on('horizon-low', () => keeper.poke());
  eventBus.on('programme', () => keeper.poke());
  return keeper;
}
