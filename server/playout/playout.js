// Playout engine — advances a cursor over the programme log in real wall-clock
// time, whether or not anyone is listening (RADIO_AUDIT «THE FIX»). Pure
// timeline mechanics: no LLM, no music resolution, no WebSocket. Clock and
// timers are injectable so tests (and the cutover) control time.
//
// Suspend/resume (合上笔记本一小时后打开): timers fire late after a process
// suspend. sync() never steps items one by one — it asks the log where the
// wall clock says the cursor should be and moves there directly, stamping
// airStart on everything that went to air meanwhile. One move of >1 item is a
// single 'jumped' event, never N catch-up item-start/item-end pairs.
import { EventEmitter } from 'node:events';
import { startOf, audibleEndOf } from './log.js';

const HORIZON_MS = 5 * 60000;

/**
 * @param {object} opts
 * @param {ReturnType<import('./log.js').createProgrammeLog>} opts.log
 * @param {() => number} [opts.now] Injectable wall clock.
 * @param {(fn: () => void, ms: number) => any} [opts.setTimer]
 * @param {(handle: any) => void} [opts.clearTimer]
 * @param {number} [opts.horizonMs] 'horizon-low' threshold.
 * @param {(info: {remainingMs: number}) => void} [opts.onHorizonLow]
 *   ensureHorizon seam — the cutover hands the composer callback in here.
 */
export function createPlayout({
  log,
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (h) => clearTimeout(h),
  horizonMs = HORIZON_MS,
  onHorizonLow = null,
} = {}) {
  if (!log) throw new TypeError('createPlayout needs a programme log');

  const emitter = new EventEmitter();
  let running = false;
  let timer = null;
  let cursorId = null;
  // Latch: 'horizon-low' fires once per starvation, re-arms once an append
  // lifts the remaining airtime back above the threshold.
  let horizonArmed = true;

  function checkHorizon(t) {
    const remainingMs = log.horizonRemaining(t);
    if (remainingMs < horizonMs) {
      if (horizonArmed) {
        horizonArmed = false;
        emitter.emit('horizon-low', { remainingMs });
        onHorizonLow?.({ remainingMs });
      }
    } else {
      horizonArmed = true;
    }
  }

  // One timer, armed for the earliest thing that needs a decision: the next
  // item's start, the current item's audible end, or the horizon threshold
  // crossing. Every sync re-arms, so retimes and edits move the alarm too.
  function armTimer(t) {
    if (timer != null) {
      clearTimer(timer);
      timer = null;
    }
    if (!running) return;
    const list = log.items();
    let boundary = Infinity;
    const ci = cursorId ? list.findIndex((it) => it.id === cursorId) : -1;
    if (ci >= 0) boundary = Math.min(boundary, audibleEndOf(list[ci]));
    for (const it of list) {
      const s = startOf(it);
      if (s != null && s > t) {
        boundary = Math.min(boundary, s);
        break; // items are in timeline order
      }
    }
    if (horizonArmed && list.length) {
      // +1: at the exact crossing, remaining === horizonMs which is not yet
      // "low" — fire the check one tick past it.
      const crossing = audibleEndOf(list[list.length - 1]) - horizonMs + 1;
      if (crossing > t) boundary = Math.min(boundary, crossing);
    }
    if (!Number.isFinite(boundary)) return;
    timer = setTimer(sync, Math.max(0, boundary - t));
  }

  // Fast-forward the cursor to wherever the wall clock says it should be.
  function sync() {
    if (!running) return;
    const t = now();
    const list = log.items();
    const ci = cursorId ? list.findIndex((it) => it.id === cursorId) : -1;

    // ti: on-air item index (last audible window containing t).
    // passed: furthest index whose start is ≤ t — everything up to it aired.
    let ti = -1;
    let passed = ci;
    for (let i = 0; i < list.length; i++) {
      const s = startOf(list[i]);
      if (s == null || s > t) break;
      passed = Math.max(passed, i);
      if (t < audibleEndOf(list[i])) ti = i;
    }

    // History first: stamp airStart (= scheduledStart — the station never
    // stopped, they aired on time) before any event carries the items out.
    for (let i = ci + 1; i <= passed; i++) {
      if (list[i].airStart == null) {
        list[i] = log.markAired(list[i].id, list[i].scheduledStart);
      }
    }

    if (ti >= 0) {
      const moved = ti - ci;
      if (moved === 1) {
        cursorId = list[ti].id;
        if (ci >= 0) emitter.emit('item-end', list[ci]);
        emitter.emit('item-start', list[ti]);
      } else if (moved > 1) {
        cursorId = list[ti].id;
        emitter.emit('jumped', {
          from: ci >= 0 ? list[ci] : null,
          to: list[ti],
          skipped: list.slice(ci + 1, ti),
          offsetMs: list[ti].cueIn + (t - startOf(list[ti])),
          at: t,
        });
      }
    } else if (ci >= 0 || passed > ci) {
      // Nobody on air: either the current item just ended (dead air begins),
      // or the clock leapt over the remaining schedule entirely.
      cursorId = null;
      if (passed === ci && ci >= 0) {
        emitter.emit('item-end', list[ci]);
      } else {
        emitter.emit('jumped', {
          from: ci >= 0 ? list[ci] : null,
          to: null,
          skipped: list.slice(ci + 1, passed + 1),
          offsetMs: 0,
          at: t,
        });
      }
    }

    checkHorizon(t);
    armTimer(t);
  }

  return {
    on: (event, fn) => emitter.on(event, fn),
    off: (event, fn) => emitter.off(event, fn),
    once: (event, fn) => emitter.once(event, fn),

    isRunning: () => running,
    current() {
      return cursorId ? log.get(cursorId) : null;
    },

    start() {
      if (running) return;
      running = true;
      sync();
    },

    stop() {
      running = false;
      if (timer != null) {
        clearTimer(timer);
        timer = null;
      }
    },

    /**
     * Tune-in shape for a client joining mid-song: current item + media
     * offset + the next few, plus the still-audible outgoing item during a
     * crossfade. Pure read — never moves the cursor.
     */
    join({ upNext = 5 } = {}) {
      const t = now();
      return { serverNow: t, ...log.snapshotAt(t, { upNext }) };
    },

    // Mutations route through the engine so every edit re-arms the timer and
    // re-checks the horizon.
    append(raw) {
      const item = log.append(raw, { at: now() });
      sync();
      return item;
    },

    insertNext(raw) {
      const item = cursorId
        ? log.insertAfter(cursorId, raw)
        : log.append(raw, { at: now() });
      sync();
      return item;
    },

    remove(id) {
      const removed = log.remove(id);
      sync();
      return removed;
    },

    update(id, patch) {
      const item = log.update(id, patch);
      sync();
      return item;
    },

    /**
     * Public resync seam — the cutover calls this on OS resume signals
     * (powerMonitor) instead of waiting for the late timer to fire.
     */
    wake() {
      sync();
    },
  };
}
