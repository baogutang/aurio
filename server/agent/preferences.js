// Playback feedback signals for taste learning.
import { db } from '../store.js';

const MAX_EVENTS = 2000;

export function recordFeedback({ signal, track, position_sec, queue_index, context = {} }) {
  if (!track?.id && !track?.title) return null;
  const normalized = signal === 'skipped' ? 'skip'
    : signal === 'replayed' ? 'replay'
      : signal === 'completed' ? 'complete'
        : signal;
  const events = db.getPref('feedbackEvents', []);
  const entry = {
    signal: normalized,
    track: {
      id: track.id,
      title: track.title,
      artist: track.artist,
      source: track.source,
    },
    position_sec: Number(position_sec) || 0,
    queue_index: Number.isFinite(queue_index) ? queue_index : -1,
    context,
    ts: Date.now(),
  };
  events.push(entry);
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  db.setPref('feedbackEvents', events);

  const key = `${track.artist} — ${track.title}`;
  const weights = db.getPref('trackWeights', {});
  const w = weights[key] || { plays: 0, skips: 0, completes: 0, replays: 0, likes: 0, dislikes: 0 };
  if (normalized === 'skip' || normalized === 'dislike') w.skips += 1;
  if (normalized === 'dislike') w.dislikes += 1;
  if (normalized === 'like') w.likes += 1;
  if (normalized === 'complete') w.completes += 1;
  if (normalized === 'replay') w.replays += 1;
  if (normalized === 'started') w.plays += 1;
  weights[key] = w;
  db.setPref('trackWeights', weights);
  return entry;
}

export function recentFeedback(n = 40) {
  const events = db.getPref('feedbackEvents', []);
  return events.slice(-n).reverse();
}

export function skipRateByArtist() {
  const weights = db.getPref('trackWeights', {});
  const byArtist = new Map();
  for (const [name, w] of Object.entries(weights)) {
    const artist = name.split(' — ')[0] || name;
    const cur = byArtist.get(artist) || { skips: 0, plays: 0 };
    cur.skips += w.skips || 0;
    cur.plays += (w.plays || 0) + (w.completes || 0);
    byArtist.set(artist, cur);
  }
  return [...byArtist.entries()].map(([artist, v]) => ({
    artist,
    skipRate: v.plays ? v.skips / v.plays : 0,
    ...v,
  })).sort((a, b) => b.skipRate - a.skipRate);
}

export function tasteSummary() {
  const weights = db.getPref('trackWeights', {});
  const liked = [];
  const disliked = [];
  for (const [name, w] of Object.entries(weights)) {
    if ((w.likes || 0) > 0) liked.push({ name, likes: w.likes });
    if ((w.dislikes || 0) > 0) disliked.push({ name, dislikes: w.dislikes });
  }
  liked.sort((a, b) => b.likes - a.likes);
  disliked.sort((a, b) => b.dislikes - a.dislikes);
  return {
    recent: recentFeedback(12),
    liked: liked.slice(0, 8),
    disliked: disliked.slice(0, 8),
    avoidArtists: skipRateByArtist().filter((a) => a.skipRate >= 0.5 && a.plays >= 2).slice(0, 6),
  };
}

export function scoreTrack(track, taste = null) {
  if (!track) return 0;
  const summary = taste || tasteSummary();
  const key = `${track.artist || ''} — ${track.title || ''}`;
  const weights = db.getPref('trackWeights', {});
  const w = weights[key] || {};
  let score = 0;
  score += (w.likes || 0) * 3;
  score += (w.completes || 0) * 2;
  score += (w.replays || 0) * 2;
  score -= (w.dislikes || 0) * 5;
  score -= (w.skips || 0) * 2;
  for (const bad of summary.disliked || []) {
    if (bad.name === key) score -= 20;
  }
  for (const artist of summary.avoidArtists || []) {
    if (track.artist && artist.artist && track.artist.includes(artist.artist)) score -= 15;
  }
  for (const good of summary.liked || []) {
    if (good.name === key) score += 10;
  }
  return score;
}
