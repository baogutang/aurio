// Monthly play rollups — long-term listening memory (RADIO_VISION §六
// 「探测器记忆的长期化」). state.json caps plays at 2000 rows, so raw history
// dies within weeks; this module folds it into one compact record per calendar
// month before it does, giving detectors an honest 「去年 11 月你听了 14 遍」
// months after the rows themselves are gone.
//
// Fold-on-write, not a nightly cron: this is a sometimes-off desktop app, and
// a 03:30 job only runs if the machine happens to be awake at 03:30. Every
// play already lands on POST /api/played, so foldRollups() rides that write —
// the rollup is exactly as current as the history it summarizes.
//
//   · The CURRENT month is recomputed from db.state.plays on every fold
//     (cheap: ≤2000 rows). If a single month ever outgrows the plays cap the
//     recount is a lower bound — we under-claim, never invent.
//   · PAST months freeze: once a month has a rollup and is no longer current,
//     it is never recomputed (its rows may since have been evicted). A month
//     first seen in plays after it ended (app off across the boundary) is
//     computed once from what survived, then frozen.
//   · Bounded to the newest 24 months.
//
// No LLM calls. Arithmetic + db prefs, same philosophy as detectors.js.
import { db } from '../store.js';

export const ROLLUP_KEY = 'playRollups';
export const ROLLUP_MONTHS_KEPT = 24;
const TOP_TRACKS = 20;
const TOP_ARTISTS = 10;

/** Local calendar month of a timestamp, as a sortable 'YYYY-MM' key. */
export function monthKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Same track identity convention as topPlays()/detectors.js: the same song
// across sources is the same record.
function trackKey(p = {}) {
  return `${p.artist || ''} — ${p.title || ''}`;
}

function computeMonth(plays) {
  const tracks = new Map();
  const artists = new Map();
  for (const p of plays) {
    const title = (p.title || '').toString().trim();
    const artist = (p.artist || '').toString().trim();
    if (title) {
      const key = trackKey(p);
      const t = tracks.get(key) || { key, artist, title, count: 0 };
      t.count++;
      tracks.set(key, t);
    }
    if (artist) {
      const a = artists.get(artist) || { artist, count: 0 };
      a.count++;
      artists.set(artist, a);
    }
  }
  const byCount = (a, b) => b.count - a.count;
  return {
    topTracks: [...tracks.values()].sort(byCount).slice(0, TOP_TRACKS),
    topArtists: [...artists.values()].sort(byCount).slice(0, TOP_ARTISTS),
    totalPlays: plays.length,
  };
}

/** The persisted rollups: { 'YYYY-MM': { topTracks, topArtists, totalPlays } }. */
export function getRollups() {
  const raw = db.getPref(ROLLUP_KEY, {});
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

/**
 * Fold play history into the monthly rollups (see the header for the policy).
 * Returns the persisted rollups object.
 */
export function foldRollups(now = Date.now()) {
  const current = monthKey(now);
  const rollups = { ...getRollups() };
  const byMonth = new Map();
  for (const p of db.state.plays) {
    if (!p || !Number.isFinite(p.ts)) continue;
    const m = monthKey(p.ts);
    if (m > current) continue;                 // clock skew: never fold the future
    if (m !== current && rollups[m]) continue; // past month already frozen
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m).push(p);
  }
  for (const [m, plays] of byMonth) rollups[m] = computeMonth(plays);
  const kept = Object.keys(rollups).sort().slice(-ROLLUP_MONTHS_KEPT);
  const out = {};
  for (const m of kept) out[m] = rollups[m];
  db.setPref(ROLLUP_KEY, out);
  return out;
}
