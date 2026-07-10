// Fixed-slot rituals — deterministic facts computed from play history for
// clock-scheduled segments (RADIO_VISION §四 内容栏目). Same philosophy as
// server/agent/detectors.js — code computes the fact, the host only decides
// how to read it out — but rituals are pulled by the clock (a cron), not
// pushed by an observation, so they live here rather than in detectors.js.
//
// No LLM calls. Everything is arithmetic over db.state.plays.
import { db } from './store.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const RECAP_WINDOW_DAYS = 7;

// Same track identity convention as topPlays()/detectors.js: the same song
// across sources is the same record.
function trackKey(p = {}) {
  return `${p.artist || ''} — ${p.title || ''}`;
}

function topOf(map) {
  let best = null;
  for (const entry of map.values()) {
    if (!best || entry.count > best.count) best = entry; // ties: first seen wins
  }
  return best;
}

// The Friday-night recap fact:「本周你听得最多的是……」. Deterministic over the
// last 7 days of plays; null when there is nothing honest to say (the cron
// then silently skips — an empty week gets music, not filler).
export function weeklyRecapFact(now = Date.now()) {
  const since = now - RECAP_WINDOW_DAYS * DAY_MS;
  const plays = db.state.plays.filter((p) => p && p.ts >= since && p.ts <= now);
  if (!plays.length) return null;

  const artists = new Map();
  const tracks = new Map();
  for (const p of plays) {
    const artist = (p.artist || '').toString().trim();
    const title = (p.title || '').toString().trim();
    if (artist) {
      const a = artists.get(artist) || { name: artist, count: 0 };
      a.count++;
      artists.set(artist, a);
    }
    if (title) {
      const key = trackKey(p);
      const t = tracks.get(key) || { title, artist, count: 0 };
      t.count++;
      tracks.set(key, t);
    }
  }

  const parts = [`过去 7 天一共播放了 ${plays.length} 次`];
  const topArtist = topOf(artists);
  if (topArtist) parts.push(`听得最多的歌手是${topArtist.name}（${topArtist.count} 次）`);
  const topTrack = topOf(tracks);
  if (topTrack) parts.push(`听得最多的一首是《${topTrack.title}》（${topTrack.count} 遍）`);
  return parts.join('；');
}
