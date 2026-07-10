// Deterministic fact detectors — code finds a verified fact, the DJ only
// decides whether to read it out (RADIO_VISION §四 / RADIO_AUDIT idea 04).
// 「距上次收听 23 天」must come from arithmetic over state.json, never from
// hoping the model "notices" something.
//
// Contract: every detector returns { code, fact, commit } or null, where
// `fact` is a short neutral Chinese fact string (never a suggested script).
// detectFacts() surfaces AT MOST ONE fact per observation, in priority order
// absence > weather_flip > long_memory > shelf > replay, and commits only the
// winner's cooldown — losers keep their fact for a later observation.
// Cooldowns are the soul of this feature: a repeated fact is worse than no
// fact.
//
// Deliberately absent: skip streaks. feedback-reaction.js already reacts to
// skips in real time; a second voice on the same event would double-speak.
//
// No LLM calls. Everything here is arithmetic + db prefs.
import { db } from '../store.js';
import { getRollups, monthKey } from './rollups.js';

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

// dj.js logs the user's message (and the renderer POSTs /api/played) BEFORE a
// segment composes, so activity inside this window is "the return in
// progress", not evidence the user was around. Ignore it when measuring gaps.
const RECENT_WINDOW = 10 * MIN;

const ABSENCE_MIN_GAP = 7 * DAY;      // an absence starts counting after a week

const REPLAY_WINDOW = 7 * DAY;        // 「这周」
const REPLAY_MIN_PLAYS = 3;
const REPLAY_COOLDOWN = 7 * DAY;      // once per track per week

const SHELF_MIN_GAP = 365 * DAY;      // a shelf track slept for over a year
const SHELF_COOLDOWN = 30 * DAY;      // once per track per month

const LONG_MEMORY_MIN_AGE_MONTHS = 2; // this month and last month are replay territory
const LONG_MEMORY_MIN_PLAYS = 3;      // top-20 of a three-play month is not a memory
const LONG_MEMORY_COOLDOWN = 90 * DAY; // once per track per quarter

const WEATHER_FLIP_MAX_AGE = 2 * 60 * MIN;  // a flip older than ~2h is stale news
const WEATHER_MAX_OBS_GAP = 2 * 60 * MIN;   // observations too far apart can't date the flip
const WEATHER_LOG_MAX = 24;

const STATE_KEY = 'detectors';              // cooldown ledger, persisted via prefs
const WEATHER_LOG_KEY = 'detectorWeatherLog';

// ---- shared state helpers ----

function detectorState() {
  const raw = db.getPref(STATE_KEY, {});
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

function patchDetectorState(patch) {
  db.setPref(STATE_KEY, { ...detectorState(), ...patch });
}

// Same track key convention as topPlays()/trackWeights — matches the same song
// across sources, which is what a human host would consider "the same record".
function trackKey(t = {}) {
  return `${t.artist || ''} — ${t.title || ''}`;
}

// Drop cooldown entries that already expired so the ledger can't grow forever.
function pruneLedger(map, now, maxAge) {
  const out = {};
  for (const [k, ts] of Object.entries(map || {})) {
    if (now - ts < maxAge) out[k] = ts;
  }
  return out;
}

// ---- return_after_absence ----

// "Listening activity" = plays (renderer reports every track start) + messages
// the USER sent. DJ-role messages are excluded: scheduled beats can make her
// talk into an empty room, and that must not count as the user being here.
function lastActivityBefore(cutoff) {
  let last = 0;
  for (const p of db.state.plays) {
    if (p.ts < cutoff && p.ts > last) last = p.ts;
  }
  for (const m of db.state.messages) {
    if (m.role === 'user' && m.ts < cutoff && m.ts > last) last = m.ts;
  }
  return last;
}

export function detectReturnAfterAbsence(now = Date.now()) {
  const anchor = lastActivityBefore(now - RECENT_WINDOW);
  if (!anchor) return null; // fresh install — there is nothing to return to
  const gap = now - anchor;
  if (gap < ABSENCE_MIN_GAP) return null;
  // Once per return: the anchor (last activity before the gap) identifies this
  // absence. After ~10 min of renewed activity the gap closes by itself; a new
  // long absence produces a new anchor and fires again.
  if (detectorState().absenceAnchor === anchor) return null;
  const days = Math.floor(gap / DAY);
  return {
    code: 'return_after_absence',
    fact: `距上次收听 ${days} 天`,
    commit: () => patchDetectorState({ absenceAnchor: anchor }),
  };
}

// ---- weather_flip ----

// Coarse condition classes from OpenWeather's localized description. 雪 before
// 雨 so 雨夹雪 counts as snow starting.
export function classifyWeather(desc = '') {
  const d = (desc || '').toString();
  if (/雪/.test(d)) return 'snow';
  if (/雨/.test(d)) return 'rain';
  if (/晴/.test(d)) return 'clear';
  if (/雾|霾/.test(d)) return 'fog';
  if (/云|阴/.test(d)) return 'clouds';
  return 'other';
}

const isPrecip = (c) => c === 'rain' || c === 'snow';

function weatherLog() {
  const raw = db.getPref(WEATHER_LOG_KEY, []);
  return Array.isArray(raw) ? raw : [];
}

// Persist one weather observation. Called (fire-and-forget) from
// buildObservation() whenever the weather module has data — weather.current()
// is memory-cached for 30 min, so flip timing is honest to within one cache
// interval. Consecutive same-condition observations collapse into one entry
// whose `ts` is when the condition was FIRST seen and `lastTs` when it was
// last confirmed; a new entry therefore marks a flip.
export function recordWeatherObservation(snapshot = {}, now = Date.now()) {
  const desc = (snapshot.desc || '').toString().trim();
  if (!desc) return;
  const cond = classifyWeather(desc);
  const log = weatherLog();
  const last = log[log.length - 1];
  if (last && last.cond === cond) {
    if (now > (last.lastTs || last.ts)) {
      last.lastTs = now;
      last.desc = desc;
    }
  } else {
    log.push({ ts: now, lastTs: now, desc, cond });
    if (log.length > WEATHER_LOG_MAX) log.splice(0, log.length - WEATHER_LOG_MAX);
  }
  db.setPref(WEATHER_LOG_KEY, log);
}

export function detectWeatherFlip(now = Date.now()) {
  const log = weatherLog();
  if (log.length < 2) return null;
  const prev = log[log.length - 2];
  const cur = log[log.length - 1];
  // Meaningful = precipitation started, stopped, or changed form (晴→雨,
  // 雨→晴, 雨→雪). 晴→多云 is not worth the DJ's breath.
  if (prev.cond === cur.cond || (!isPrecip(prev.cond) && !isPrecip(cur.cond))) return null;
  if (now - cur.ts > WEATHER_FLIP_MAX_AGE) return null;
  // If the old condition was last confirmed hours before the new one showed
  // up, we can't honestly say WHEN it flipped — stay silent.
  if (cur.ts - (prev.lastTs || prev.ts) > WEATHER_MAX_OBS_GAP) return null;
  if (detectorState().weatherFlipTs === cur.ts) return null; // once per flip
  const mins = Math.max(1, Math.round((now - cur.ts) / MIN));
  const fact = cur.cond === 'rain' ? `${mins} 分钟前开始下雨`
    : cur.cond === 'snow' ? `${mins} 分钟前开始下雪`
      : prev.cond === 'rain' ? `${mins} 分钟前雨停了`
        : prev.cond === 'snow' ? `${mins} 分钟前雪停了`
          : null;
  if (!fact) return null;
  return {
    code: 'weather_flip',
    fact,
    commit: () => patchDetectorState({ weatherFlipTs: cur.ts }),
  };
}

// ---- shelf_track ----

export function detectShelfTrack(now = Date.now(), nowPlaying = null) {
  if (!nowPlaying || !nowPlaying.title) return null;
  const key = trackKey(nowPlaying);
  // The renderer logs a play when the current spin starts — look past it for
  // the PREVIOUS play of this track.
  const cutoff = now - RECENT_WINDOW;
  let prevTs = 0;
  for (const p of db.state.plays) {
    if (trackKey(p) !== key) continue;
    if (p.ts < cutoff && p.ts > prevTs) prevTs = p.ts;
  }
  // No earlier play on record → no honest fact. Note the data limit: plays cap
  // at 2000 rows, so a genuinely ancient play may have been evicted; we only
  // speak when the evidence survived.
  if (!prevTs) return null;
  if (now - prevTs < SHELF_MIN_GAP) return null;
  const state = detectorState();
  if (now - (state.shelf?.[key] || 0) < SHELF_COOLDOWN) return null;
  const d = new Date(prevTs);
  return {
    code: 'shelf_track',
    fact: `《${nowPlaying.title}》上次播放是 ${d.getFullYear()}年${d.getMonth() + 1}月`,
    commit: () => {
      const st = detectorState();
      patchDetectorState({ shelf: { ...pruneLedger(st.shelf, now, SHELF_COOLDOWN), [key]: now } });
    },
  };
}

// ---- long_memory ----

// How many calendar months `b` ('YYYY-MM') is after `a`.
function monthsApart(a, b) {
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  return (by - ay) * 12 + (bm - am);
}

// Honest month naming from the rollup key: 今年 N 月 / 去年 N 月 / YYYY 年 N 月.
function monthPhrase(month, now) {
  const [y, m] = month.split('-').map(Number);
  const nowYear = new Date(now).getFullYear();
  if (y === nowYear) return `今年 ${m} 月`;
  if (y === nowYear - 1) return `去年 ${m} 月`;
  return `${y} 年 ${m} 月`;
}

// The current track was prominent in a monthly rollup at least two months back
// (server/agent/rollups.js):「《X》去年 11 月你听了 14 遍」. Month name and
// count both come straight from the frozen rollup — never an estimate. When a
// track charted in several old months, the heaviest one speaks.
export function detectLongMemory(now = Date.now(), nowPlaying = null) {
  if (!nowPlaying || !nowPlaying.title) return null;
  const key = trackKey(nowPlaying);
  const state = detectorState();
  if (now - (state.longMemory?.[key] || 0) < LONG_MEMORY_COOLDOWN) return null;
  const current = monthKey(now);
  let best = null;
  for (const [month, r] of Object.entries(getRollups())) {
    if (monthsApart(month, current) < LONG_MEMORY_MIN_AGE_MONTHS) continue;
    const hit = (r?.topTracks || []).find((t) => t && t.key === key);
    if (!hit || !(hit.count >= LONG_MEMORY_MIN_PLAYS)) continue;
    if (!best || hit.count > best.count) best = { month, count: hit.count };
  }
  if (!best) return null;
  return {
    code: 'long_memory',
    fact: `《${nowPlaying.title}》${monthPhrase(best.month, now)}你听了 ${best.count} 遍`,
    commit: () => {
      const st = detectorState();
      patchDetectorState({
        longMemory: { ...pruneLedger(st.longMemory, now, LONG_MEMORY_COOLDOWN), [key]: now },
      });
    },
  };
}

// ---- replay_obsession ----

export function detectReplayObsession(now = Date.now(), nowPlaying = null) {
  if (!nowPlaying || !nowPlaying.title) return null;
  const key = trackKey(nowPlaying);
  const since = now - REPLAY_WINDOW;
  let count = 0;
  for (const p of db.state.plays) {
    if (p.ts >= since && p.ts <= now && trackKey(p) === key) count++;
  }
  // The current spin is usually already in plays (renderer POSTs /api/played
  // on track start). If that row hasn't landed yet the count is conservative
  // by one — better to under-claim than to invent a spin.
  if (count < REPLAY_MIN_PLAYS) return null;
  const state = detectorState();
  if (now - (state.replay?.[key] || 0) < REPLAY_COOLDOWN) return null;
  return {
    code: 'replay_obsession',
    fact: `《${nowPlaying.title}》这周第 ${count} 遍`,
    commit: () => {
      const st = detectorState();
      patchDetectorState({ replay: { ...pruneLedger(st.replay, now, REPLAY_COOLDOWN), [key]: now } });
    },
  };
}

// ---- entry point ----

// At most ONE fact per observation. Priority: a return trumps weather; weather
// trumps a long memory (a flip is stale news in two hours, the memory can wait
// for this track's next spin); a long memory trumps a shelf find (when both
// speak about the same track,「去年 11 月你听了 14 遍」subsumes the bare gap —
// it names when AND how much — while shelf still covers tracks that never
// charted in any rollup month); a shelf find trumps replay trivia. Only the
// surfaced fact's cooldown is committed.
export function detectFacts({ now = Date.now(), nowPlaying = null } = {}) {
  const probes = [
    () => detectReturnAfterAbsence(now),
    () => detectWeatherFlip(now),
    () => detectLongMemory(now, nowPlaying),
    () => detectShelfTrack(now, nowPlaying),
    () => detectReplayObsession(now, nowPlaying),
  ];
  for (const probe of probes) {
    const hit = probe();
    if (!hit) continue;
    hit.commit();
    return { code: hit.code, fact: hit.fact };
  }
  return null;
}

// Ready-to-render prompt line. Neutral framing on purpose: the DJ may mention
// the fact or let it pass — never a suggested script.
export function factsPromptLine(facts = []) {
  const list = (facts || []).filter(Boolean);
  if (!list.length) return '';
  return `探测到的事实（可以自然地提一句，也可以不提）：${list.join('；')}`;
}
