// The station — the process-wide wiring of the playout engine (docs/PLAYOUT_CUTOVER.md).
//
// createProgrammeLog/createPlayout are pure mechanics; this module gives them a
// home: persistence through server/store.js, verbs the DJ orchestrator lands
// segments with (append / insertNext / steer / skip), voice tracking (upcoming
// spoken lines are synthesized BEFORE they air — TTS latency disappears
// structurally), and opportunistic cue enrichment (server/music/cue.js,
// read-only import).
//
// Money rules live at exactly two seams:
//   · cursor advance is free and unconditional — the engine never checks
//     listeners;
//   · TTS pre-synthesis checks the injected listener gate (set by index.js to
//     the WS roster) so an empty studio spends nothing.
//
// Every externally visible change emits eventBus 'programme' { reason } —
// index.js turns those into WS pushes of a fresh join() snapshot.
import { createProgrammeLog, startOf, audibleEndOf } from './log.js';
import { createPlayout } from './playout.js';
import { db } from '../store.js';
import { config } from '../config.js';
import { eventBus } from '../runtime/event-bus.js';
import { synthesizeBackground } from '../tts/index.js';
import { ensureCue, cachedCue } from '../music/cue.js';
import { voiceParamsAt } from '../shows.js';
import { isQuietNow } from '../plan.js';

export const PROGRAMME_LOG_PREF = 'programmeLog';
export const STATION_STARTED_PREF = 'stationStartedAt';
const FALLBACK_DURATION_MS = 4 * 60000; // a track without a believable duration
// Aired retention (the 磁带, RADIO_AUDIT idea 06): GET /api/tape replays up to
// 12h of aired items, so history is kept by AGE — anything that stopped being
// audible within the last 12h survives — with a hard item cap as the size
// bound (400 items ≈ 12h of 90s items; typical 3-min songs land well under it).
const HISTORY_KEPT = 400;                        // hard cap on aired items
const HISTORY_MAX_AGE_MS = 12 * 60 * 60 * 1000;  // the tape window
const VOICE_TRACK_AHEAD = 2;            // upcoming voice lines pre-synthesized

let log = null;
let playout = null;
let started = false;
let listenerGate = () => false;
const inflightVoice = new Set();

// Injectable seams (tests / index.js). Cue analysis defaults OFF under vitest —
// a unit test appending fixture tracks must never spawn ffmpeg probes. The
// stationStartedAt prefs seam likewise defaults to memory under vitest so a
// unit test airing items never writes the real state.json.
let deps = {};
function memoryPrefs() {
  const m = new Map();
  return {
    get: (k, d = null) => (m.has(k) ? m.get(k) : d),
    set: (k, v) => { m.set(k, v); },
  };
}
function defaultDeps() {
  return {
    now: () => Date.now(),
    // unref'd so an armed boundary hours out never pins the process open.
    setTimer: (fn, ms) => { const h = setTimeout(fn, ms); h.unref?.(); return h; },
    clearTimer: (h) => clearTimeout(h),
    horizonMs: undefined, // engine default (5 min)
    cue: process.env.VITEST ? null : ensureCue,
    synthesize: synthesizeBackground,
    // Per-airing voice params (the show — later plan segment — on air at ts)
    // and the day plan's quiet-window check. Both default OFF under vitest,
    // like cue: unit tests with fake epoch-0 clocks must not have today's
    // real schedule/plan leak into their assertions.
    voiceParams: process.env.VITEST ? () => null : (ts) => voiceParamsAt(ts),
    quiet: process.env.VITEST ? () => null : (ts) => isQuietNow(ts),
    prefs: process.env.VITEST ? memoryPrefs() : {
      get: (k, d) => db.getPref(k, d),
      set: (k, v) => db.setPref(k, v),
    },
  };
}

/** index.js wires this to the WS roster: "is anybody listening right now?" */
export function setListenerGate(fn) {
  listenerGate = typeof fn === 'function' ? fn : () => false;
}

function storeSeam() {
  return {
    load: () => db.getPref(PROGRAMME_LOG_PREF),
    save: (data) => db.setPref(PROGRAMME_LOG_PREF, data),
  };
}

function emitProgramme(reason) {
  eventBus.emit('programme', { reason });
}

// ---------------------------------------------------------------------------
// track ⇄ LogItem mapping
// ---------------------------------------------------------------------------

function trackShape(t = {}) {
  return {
    source: t.source, id: t.id, title: t.title, artist: t.artist,
    album: t.album, coverArt: t.coverArt, year: t.year, genre: t.genre,
    reason: t.reason || '', duration: t.duration,
  };
}

const secToMs = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 1000) : null);

/** Build a LogItem from a resolved track (url → streamUrl, sec → ms). Cached
 *  cue metadata is applied immediately; a fresh analysis patches in later. */
export function toLogItem(track = {}, { voice = null } = {}) {
  const cue = cachedCue(track) || {};
  const durationMs = secToMs(cue.durationSec) || secToMs(track.duration) || FALLBACK_DURATION_MS;
  const item = {
    type: 'song',
    duration: Math.max(1000, durationMs),
    track: trackShape(track),
    streamUrl: track.url || null,
    voice: voice && voice.text ? { ...voice } : null,
  };
  if (cue.cueIn != null) item.cueIn = secToMs(cue.cueIn);
  if (cue.cueOut != null) item.cueOut = secToMs(cue.cueOut);
  if (cue.seguePoint != null) item.seguePoint = secToMs(cue.seguePoint);
  if (cue.endType) item.endType = cue.endType;
  if (cue.introSec != null) item.introSec = cue.introSec;
  if (cue.lufs != null) item.lufs = cue.lufs;
  if (cue.gainDb != null) item.gainDb = cue.gainDb;
  return item;
}

/** LogItem → the Track shape legacy read paths (context/agent prompts) expect. */
export function itemToTrack(item = {}) {
  const t = { ...(item.track || {}) };
  if (item.streamUrl) t.url = item.streamUrl;
  if (item.voice?.text) t.segue = item.voice.text;
  if (item.voice?.ttsUrl) t.segueTtsUrl = item.voice.ttsUrl;
  return t;
}

// ---------------------------------------------------------------------------
// cue enrichment — fire-and-forget; a cue record retimes the schedule with
// real DSP ground truth (and fixes lying durations, e.g. VIP 30s previews).
// ---------------------------------------------------------------------------

function absoluteStreamUrl(streamUrl) {
  if (!streamUrl) return null;
  if (/^https?:\/\//i.test(streamUrl)) return streamUrl;
  return `http://127.0.0.1:${config.port}${streamUrl}`;
}

function applyCue(id, rec) {
  if (!rec || !log) return;
  const it = log.get(id);
  if (!it || it.airStart != null) return; // aired history is settled
  const patch = {};
  if (Number(rec.durationSec) > 0) patch.duration = secToMs(rec.durationSec);
  if (rec.cueIn != null) patch.cueIn = secToMs(rec.cueIn);
  if (rec.cueOut != null) patch.cueOut = secToMs(rec.cueOut);
  if (rec.seguePoint != null) patch.seguePoint = secToMs(rec.seguePoint);
  if (rec.endType === 'cold' || rec.endType === 'fade') patch.endType = rec.endType;
  if (rec.introSec != null) patch.introSec = rec.introSec;
  if (rec.lufs != null) patch.lufs = rec.lufs;
  if (rec.gainDb != null) patch.gainDb = rec.gainDb;
  if (!Object.keys(patch).length) return;
  try {
    playout.update(id, patch);
    emitProgramme('log');
  } catch { /* item vanished under us — fine */ }
}

function enrichCue(item) {
  if (!deps.cue) return;
  const t = item.track;
  if (!t?.source || t.id == null || t.id === '' || !item.streamUrl) return;
  const probe = {
    source: t.source,
    id: t.id,
    durationSec: item.duration > 0 ? item.duration / 1000 : undefined,
    streamUrl: absoluteStreamUrl(item.streamUrl),
  };
  Promise.resolve()
    .then(() => deps.cue(probe))
    .then((rec) => applyCue(item.id, rec))
    .catch(() => {});
}

// ---------------------------------------------------------------------------
// voice tracking — synthesize the voice of the current + next N items before
// they air. Gated on a listener: pre-synthesis is spend, the cursor is not.
// ---------------------------------------------------------------------------

function trackVoices() {
  if (!playout || !listenerGate()) return;
  const snap = playout.join({ upNext: VOICE_TRACK_AHEAD });
  const targets = [snap.current, ...snap.upNext]
    .filter((it) => it?.voice?.text && !it.voice.ttsUrl)
    // Spend rule: don't synthesize what won't speak. An item airing inside a
    // day-plan quiet window (server/plan.js) has its break muted anyway, so
    // its voice never earns a TTS call. Skipped, not consumed: if the window
    // moves before it airs, the next trackVoices pass picks it up again.
    .filter((it) => !deps.quiet(startOf(it) ?? deps.now()));
  for (const it of targets) {
    const { id } = it;
    if (inflightVoice.has(id)) continue;
    inflightVoice.add(id);
    const deliver = (tts) => {
      inflightVoice.delete(id);
      if (!tts?.url || !log) return;
      const fresh = log.get(id);
      if (!fresh || fresh.voice?.ttsUrl || !fresh.voice?.text) return;
      try {
        playout.update(id, { voice: { ...fresh.voice, ttsUrl: tts.url } });
        emitProgramme('voice');
      } catch { /* item removed meanwhile */ }
    };
    // Voice params resolve against the item's air time, so a line riding a
    // 深夜航班 track is synthesized in that show's softer register.
    const vo = deps.voiceParams(startOf(it) ?? deps.now()) || null;
    const ready = vo
      ? deps.synthesize(it.voice.text, deliver, vo)
      : deps.synthesize(it.voice.text, deliver);
    if (ready?.url) deliver(ready);
    else if (ready === null && inflightVoice.has(id) && !it.voice.text.trim()) {
      inflightVoice.delete(id);
    }
  }
}

// ---------------------------------------------------------------------------
// station uptime — when did the current unbroken on-air run begin?
//
// The honest anchor is in the log, not the process: a restart fast-forwards
// through downtime stamping airStart = scheduledStart (per the log the station
// never stopped), so uptime must survive it. The anchor is persisted and only
// RESET when a gap is actually observed — the on-air item starts after the
// previous item stopped being audible (dead air broke the run; appends after
// dead air are pinned at now, so the gap is visible in the log). When history
// before the on-air item was pruned away, continuity can't be disproved and a
// valid earlier anchor is kept.
// ---------------------------------------------------------------------------

function noteRunAnchor() {
  const cur = playout.current();
  if (!cur) return; // dead air: the run ended; the next airing decides anew
  const list = log.items();
  const i = list.findIndex((it) => it.id === cur.id);
  const prev = i > 0 ? list[i - 1] : null;
  const gap = !!prev && startOf(cur) > audibleEndOf(prev);
  const anchor = startOf(cur);
  const existing = Number(deps.prefs.get(STATION_STARTED_PREF));
  if (!gap && Number.isFinite(existing) && existing > 0 && existing <= anchor) return;
  deps.prefs.set(STATION_STARTED_PREF, anchor);
}

function pruneAired() {
  log.pruneHistory({ keep: HISTORY_KEPT, now: deps.now(), maxAgeMs: HISTORY_MAX_AGE_MS });
}

// ---------------------------------------------------------------------------
// lifecycle
// ---------------------------------------------------------------------------

/**
 * (Re)create the log + engine. Tests pass fake clocks/timers and their own
 * store/cue seams; production callers use the defaults. Does not start().
 */
export function initStation(opts = {}) {
  if (playout) playout.stop();
  deps = { ...defaultDeps(), ...opts };
  started = false;
  inflightVoice.clear();
  log = createProgrammeLog({ store: opts.store ?? storeSeam() });

  // One-time migration: a pre-cutover state.json still carries the old client
  // queue. Seed the log from it so the station picks up where the queue left off.
  if (!log.size() && Array.isArray(db.state?.queue) && db.state.queue.length) {
    const t0 = deps.now();
    for (const tr of db.state.queue) {
      try { log.append(toLogItem(tr), { at: t0 }); } catch { /* skip garbage */ }
    }
    db.state.queue = [];
  }

  playout = createPlayout({
    log,
    now: deps.now,
    setTimer: deps.setTimer,
    clearTimer: deps.clearTimer,
    horizonMs: deps.horizonMs,
    onHorizonLow: (info) => eventBus.emit('horizon-low', info),
  });
  playout.on('item-start', (item) => {
    noteRunAnchor();
    pruneAired();
    emitProgramme('item-start');
    trackVoices();
  });
  playout.on('item-end', () => emitProgramme('log'));
  playout.on('jumped', () => {
    noteRunAnchor();
    pruneAired();
    emitProgramme('jumped');
    trackVoices();
  });
  return station;
}

function ensureInit() {
  if (!playout) initStation();
}

function addedTracks(items) {
  return items.map(itemToTrack);
}

export const station = {
  /** Restore + start the cursor. Idempotent. */
  start() {
    ensureInit();
    if (started) return;
    started = true;
    playout.start();
    emitProgramme('start');
  },

  stop() {
    if (playout) playout.stop();
    started = false;
  },

  /** OS resume (powerMonitor) — resync now instead of waiting for a late timer. */
  wake() {
    ensureInit();
    playout.wake();
  },

  isRunning: () => !!playout && playout.isRunning(),

  current() {
    ensureInit();
    return playout.current();
  },

  join(opts) {
    ensureInit();
    return playout.join(opts);
  },

  items() {
    ensureInit();
    return log.items();
  },

  getItem(id) {
    ensureInit();
    return log.get(id);
  },

  horizonRemaining() {
    ensureInit();
    return log.horizonRemaining(deps.now());
  },

  /**
   * ms epoch when the current unbroken on-air run began (contract field
   * `stationStartedAt`). Survives restarts that fast-forwarded through
   * downtime; resets only when the schedule actually ran dry (dead air) and
   * a new run was pinned at now. During dead air this reports the last run's
   * anchor; null before anything ever aired.
   */
  startedAt() {
    ensureInit();
    const v = Number(deps.prefs.get(STATION_STARTED_PREF));
    return Number.isFinite(v) && v > 0 ? v : null;
  },

  /** Legacy read view: [on-air track, ...upcoming tracks] (context/agent prompts). */
  viewTracks() {
    ensureInit();
    const snap = playout.join({ upNext: 30 });
    const out = [];
    if (snap.current) out.push(itemToTrack(snap.current));
    for (const it of snap.upNext) out.push(itemToTrack(it));
    return out;
  },

  /**
   * Append resolved tracks to the log tail. `voice` (say text, optional
   * ttsUrl) lands on the FIRST appended item and plays as its intro.
   */
  appendTracks(tracks = [], { voice = null } = {}) {
    ensureInit();
    const items = [];
    for (let i = 0; i < tracks.length; i++) {
      try {
        const item = playout.append(toLogItem(tracks[i], { voice: i === 0 ? voice : null }));
        items.push(item);
        enrichCue(item);
      } catch (e) { console.error('[station] append:', e.message); }
    }
    if (items.length) {
      emitProgramme('log');
      trackVoices();
    }
    return items;
  },

  /** Insert resolved tracks right after the on-air item ("play this next"). */
  insertNextTracks(tracks = [], { voice = null } = {}) {
    ensureInit();
    const items = [];
    // insertNext repeatedly would reverse the batch — insert in reverse order.
    for (let i = tracks.length - 1; i >= 0; i--) {
      try {
        const item = playout.insertNext(toLogItem(tracks[i], { voice: i === 0 ? voice : null }));
        items.unshift(item);
        enrichCue(item);
      } catch (e) { console.error('[station] insert:', e.message); }
    }
    if (items.length) {
      emitProgramme('log');
      trackVoices();
    }
    return items;
  },

  /**
   * Steer: the show changes direction. Aired history is immutable and the
   * on-air item keeps playing; everything not yet aired is removed, then the
   * new direction is appended.
   */
  steerTracks(tracks = [], { voice = null } = {}) {
    ensureInit();
    for (const it of log.items()) {
      if (it.airStart == null) {
        try { playout.remove(it.id); } catch { /* raced with airing — leave it */ }
      }
    }
    const items = station.appendTracks(tracks, { voice });
    if (!items.length) emitProgramme('log'); // the truncation alone changed the programme
    return items;
  },

  /**
   * Skip: a server log operation. The on-air item is shortened to end right
   * now (its aired history honestly shows how long it actually played) and
   * the next item starts immediately. Returns the new on-air item (or null —
   * skipped into dead air; the horizon keeper takes it from there).
   */
  skip() {
    ensureInit();
    const cur = playout.current();
    if (!cur) return null;
    const t = deps.now();
    const elapsed = Math.max(0, t - (cur.airStart ?? cur.scheduledStart ?? t));
    const cutAt = Math.min(Math.max(cur.cueIn, cur.cueIn + elapsed), cur.duration);
    try {
      playout.update(cur.id, { cueOut: cutAt, seguePoint: cutAt, endType: 'cold' });
    } catch (e) {
      console.error('[station] skip:', e.message);
      return playout.current();
    }
    emitProgramme('log');
    trackVoices();
    return playout.current();
  },

  /** Patch an upcoming item (imaging liners/IDs, cue metadata, voice text). */
  updateItem(id, patch) {
    ensureInit();
    const item = playout.update(id, patch);
    emitProgramme(patch && patch.voice !== undefined ? 'voice' : 'log');
    trackVoices();
    return item;
  },

  /** Test/diagnostic seam. */
  _log() {
    ensureInit();
    return log;
  },
};

export { addedTracks };
