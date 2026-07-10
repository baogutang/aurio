// Programme log — the wall-clock playout timeline (RADIO_AUDIT «THE FIX»).
// Pure data + arithmetic: no clock, no timers, no LLM. All time fields are
// wall-clock (or media-position) MILLISECONDS except introSec/outroSec, which
// keep their named unit as passthrough metadata for the client mixer.
//
// The one formula everything hangs on (RADIO_AUDIT LogItem spec):
//
//   scheduledStart[n] = airStart[n-1] + (seguePoint[n-1] - cueIn[n-1])
//
// i.e. the next item starts at the previous item's segue point, so the fade
// tail (cueOut - seguePoint) OVERLAPS the incoming item — the crossfade is in
// the schedule itself, not an afterthought in the client.
import crypto from 'node:crypto';

export const CROSSFADE_MS = 2000;

const TYPES = new Set(['song', 'voicetrack', 'liner', 'id', 'stinger']);

function num(v, fallback = null) {
  if (v == null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Where an item's timeline actually starts: history (airStart) wins over plan. */
export function startOf(item) {
  return item.airStart ?? item.scheduledStart;
}

/** How far this item advances the timeline before the next one begins. */
export function advanceOf(item) {
  return Math.max(0, item.seguePoint - item.cueIn);
}

/** Wall-clock instant the item stops being audible (media plays cueIn→cueOut). */
export function audibleEndOf(item) {
  return startOf(item) + Math.max(0, item.cueOut - item.cueIn);
}

// Fill in the audit's defaults and clamp cue metadata into sane ranges.
// Defaults when cue metadata is absent: cueIn 0, cueOut = duration,
// seguePoint = cueOut - 2s crossfade, endType 'fade'. A cold ending hard-cuts
// at cueOut and never fades, so nothing overlaps it: seguePoint = cueOut.
export function normalizeItem(raw = {}) {
  const duration = num(raw.duration);
  if (!(duration > 0)) throw new TypeError('LogItem needs a finite positive duration (ms)');
  const type = raw.type ?? 'song';
  if (!TYPES.has(type)) throw new TypeError(`unknown LogItem type: ${type}`);
  const cueIn = Math.min(Math.max(num(raw.cueIn, 0), 0), duration);
  const cueOut = Math.min(Math.max(num(raw.cueOut, duration), cueIn), duration);
  const endType = raw.endType === 'cold' ? 'cold' : 'fade';
  const segueDefault = endType === 'cold' ? cueOut : Math.max(cueIn, cueOut - CROSSFADE_MS);
  const seguePoint = Math.min(Math.max(num(raw.seguePoint, segueDefault), cueIn), cueOut);
  return {
    id: raw.id != null ? String(raw.id) : crypto.randomUUID(),
    type,
    scheduledStart: num(raw.scheduledStart),
    airStart: num(raw.airStart),
    duration,
    track: raw.track ?? null,
    streamUrl: raw.streamUrl ?? null,
    cueIn,
    cueOut,
    seguePoint,
    introSec: num(raw.introSec),
    outroSec: num(raw.outroSec),
    startType: raw.startType === 'ramp' ? 'ramp' : 'cold',
    endType,
    lufs: num(raw.lufs),
    gainDb: num(raw.gainDb, 0),
    voice: raw.voice ?? null,
    // True when this item was deliberately scheduled off the chain (append
    // after dead air). retime() must not snap it back onto the stale chain.
    pinned: !!raw.pinned,
  };
}

/**
 * @param {object} [opts]
 * @param {{load?: () => object|null, save?: (data: object) => void}} [opts.store]
 *   Persistence seam: plain JSON-able object in/out. save() runs after every
 *   mutation; load() once at creation. Deliberately NOT server/store.js — the
 *   cutover connects them.
 * @param {object} [opts.data] Previously serialized log (takes precedence).
 */
export function createProgrammeLog({ store = null, data = null } = {}) {
  /** @type {object[]} */
  let items = [];

  const initial = data ?? store?.load?.() ?? null;
  if (initial && Array.isArray(initial.items)) {
    items = initial.items.map(normalizeItem);
  }

  function toJSON() {
    return { items: structuredClone(items) };
  }

  function persist() {
    store?.save?.(toJSON());
  }

  function indexOf(id) {
    return items.findIndex((it) => it.id === id);
  }

  function mustFind(id) {
    const i = indexOf(id);
    if (i < 0) throw new Error(`no such LogItem: ${id}`);
    return i;
  }

  function assertNewId(id) {
    if (indexOf(id) >= 0) throw new Error(`duplicate LogItem id: ${id}`);
  }

  // Recompute scheduledStart downstream of any edit. Aired items are history
  // (airStart immutable); pinned items keep their wall-clock commitment and
  // become the chain base for whatever follows them.
  function retime() {
    for (let i = 1; i < items.length; i++) {
      const it = items[i];
      if (it.airStart != null || it.pinned) continue;
      items[i].scheduledStart = startOf(items[i - 1]) + advanceOf(items[i - 1]);
    }
  }

  return {
    size: () => items.length,
    items: () => structuredClone(items),
    get(id) {
      const i = indexOf(id);
      return i < 0 ? null : structuredClone(items[i]);
    },
    indexOf,
    toJSON,

    /**
     * Append to the tail. `at` (wall-clock now) matters in two cases: an empty
     * log needs an anchor, and a tail that already ended in the past (dead
     * air) must not schedule the new item at a stale point an hour ago —
     * max(chain, at) restarts the station now and pins the item there.
     */
    append(raw, { at = null } = {}) {
      const item = normalizeItem(raw);
      assertNewId(item.id);
      const tail = items[items.length - 1];
      const chain = tail ? startOf(tail) + advanceOf(tail) : null;
      const anchor = num(at);
      if (chain == null) {
        const start = item.scheduledStart ?? anchor;
        if (start == null) throw new Error('appending to an empty log needs an anchor time (at)');
        item.scheduledStart = start;
        item.pinned = true;
      } else if (anchor != null && anchor > chain) {
        item.scheduledStart = anchor;
        item.pinned = true;
      } else {
        item.scheduledStart = chain;
      }
      items.push(item);
      persist();
      return structuredClone(item);
    },

    /**
     * Insert right after `afterId` — the engine uses this with the on-air
     * item's id ("play this next"). Aired history is immutable: the item being
     * displaced must not have aired yet.
     */
    insertAfter(afterId, raw) {
      const i = mustFind(afterId);
      const displaced = items[i + 1];
      if (displaced && displaced.airStart != null) {
        throw new Error('cannot insert into aired history');
      }
      const item = normalizeItem(raw);
      assertNewId(item.id);
      items.splice(i + 1, 0, item);
      retime();
      persist();
      return structuredClone(item);
    },

    /** Remove a not-yet-aired item and close the gap behind it. */
    remove(id) {
      const i = mustFind(id);
      if (items[i].airStart != null) throw new Error('cannot remove the on-air or aired item');
      const [removed] = items.splice(i, 1);
      retime();
      persist();
      return structuredClone(removed);
    },

    /**
     * Patch an item (voice.ttsUrl arriving, better cue metadata, …) and retime
     * downstream. Derived/history fields (id, scheduledStart, airStart,
     * pinned) are not patchable through here.
     */
    update(id, patch = {}) {
      const i = mustFind(id);
      const { id: _id, scheduledStart: _s, airStart: _a, pinned: _p, ...rest } = patch;
      items[i] = normalizeItem({ ...items[i], ...rest });
      retime();
      persist();
      return structuredClone(items[i]);
    },

    /** Stamp the authoritative on-air time. The engine passes scheduledStart. */
    markAired(id, airStart) {
      const i = mustFind(id);
      const ts = num(airStart);
      if (ts == null) throw new TypeError('markAired needs a finite timestamp');
      items[i].airStart = ts;
      retime();
      persist();
      return structuredClone(items[i]);
    },

    /** Recompute scheduledStart for everything downstream of aired/pinned anchors. */
    retime() {
      retime();
      persist();
    },

    /**
     * What is on air at wall-clock `t` — the shape a client needs to tune in
     * mid-song. `offsetMs` is the MEDIA seek position (cueIn + elapsed).
     * During a crossfade the incoming item is `current`; the outgoing, still
     * audible one rides along as `ending` with its own offsetMs.
     */
    snapshotAt(t, { upNext = 5 } = {}) {
      let ci = -1;
      for (let i = 0; i < items.length; i++) {
        const s = startOf(items[i]);
        if (s == null || s > t) break;
        if (t < audibleEndOf(items[i])) ci = i; // last window containing t wins
      }
      if (ci < 0) {
        const future = items.filter((it) => startOf(it) > t);
        return { current: null, offsetMs: 0, ending: null, upNext: structuredClone(future.slice(0, upNext)) };
      }
      const cur = items[ci];
      const prev = items[ci - 1];
      const ending = prev && audibleEndOf(prev) > t
        ? { ...structuredClone(prev), offsetMs: prev.cueIn + (t - startOf(prev)) }
        : null;
      return {
        current: structuredClone(cur),
        offsetMs: cur.cueIn + (t - startOf(cur)),
        ending,
        upNext: structuredClone(items.slice(ci + 1, ci + 1 + upNext)),
      };
    },

    /** Scheduled airtime remaining after wall-clock `t` (horizon inspection). */
    horizonRemaining(t) {
      const last = items[items.length - 1];
      if (!last) return 0;
      return Math.max(0, audibleEndOf(last) - t);
    },

    /**
     * Drop aired history so the persisted log stays bounded across weeks of
     * unattended playout — while keeping enough of it for the tape
     * (GET /api/tape replays up to 12h of aired items). An aired item is
     * dropped when it falls beyond the most recent `keep` aired items (the
     * hard size cap), or — when `now` and `maxAgeMs` are given — when it
     * stopped being audible more than `maxAgeMs` before `now`. Never touches
     * unaired items, and always keeps the newest aired item (the on-air
     * anchor the chain retimes from).
     */
    pruneHistory({ keep = 40, now = null, maxAgeMs = null } = {}) {
      const airedIdx = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].airStart != null) airedIdx.push(i);
      }
      if (airedIdx.length <= 1) return 0;
      const dropIds = new Set();
      const excess = airedIdx.length - Math.max(1, keep);
      for (const i of airedIdx.slice(0, Math.max(0, excess))) dropIds.add(items[i].id);
      if (num(now) != null && num(maxAgeMs) != null) {
        const cutoff = num(now) - num(maxAgeMs);
        for (const i of airedIdx.slice(0, -1)) { // the newest aired item always survives
          if (audibleEndOf(items[i]) < cutoff) dropIds.add(items[i].id);
        }
      }
      if (!dropIds.size) return 0;
      items = items.filter((it) => !dropIds.has(it.id));
      persist();
      return dropIds.size;
    },
  };
}
