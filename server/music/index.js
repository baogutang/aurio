import { db } from '../store.js';
import { lanBaseUrl } from '../net.js';
import { navidrome } from './navidrome.js';
import { netease } from './netease.js';
import { qqmusic } from './qqmusic.js';
import { parseLrc, plainLines, mergeTranslation } from './lrc.js';

export const MUSIC_SOURCES = ['combined', 'netease', 'navidrome', 'qqmusic'];

export function sourceServices() {
  return {
    // 网易云只有登录后才算用户已配置的音源；QQ 走内置适配器，默认可用。
    netease: netease.loggedIn(),
    navidrome: navidrome.enabled(),
    qqmusic: qqmusic.enabled(),
  };
}

export function availableSourceModes() {
  const svc = sourceServices();
  const modes = [];
  if (svc.netease || svc.navidrome || svc.qqmusic) modes.push('combined');
  if (svc.netease) modes.push('netease');
  if (svc.navidrome) modes.push('navidrome');
  if (svc.qqmusic) modes.push('qqmusic');
  return modes;
}

export function getMusicSource() {
  const v = db.getPref('musicSource', 'combined');
  const modes = availableSourceModes();
  if (modes.includes(v)) return v;
  return modes[0] || 'combined';
}

export function setMusicSource(mode) {
  if (!availableSourceModes().includes(mode)) throw new Error('音源未配置或不可用');
  db.setPref('musicSource', mode);
}

function useNavidrome() {
  if (!sourceServices().navidrome) return false;
  const m = getMusicSource();
  return m === 'combined' || m === 'navidrome';
}

function useNetease() {
  if (!sourceServices().netease) return false;
  const m = getMusicSource();
  return m === 'combined' || m === 'netease';
}

function useQQ() {
  if (!sourceServices().qqmusic) return false;
  const m = getMusicSource();
  return m === 'combined' || m === 'qqmusic';
}

function normKeyPart(value = '') {
  return value
    .toString()
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function trackKeys(track = {}) {
  const keys = [];
  if (track.source && track.id) keys.push(`id:${track.source}:${track.id}`);
  const title = normKeyPart(track.title);
  const artist = normKeyPart(track.artist);
  if (title && artist) keys.push(`song:${artist} - ${title}`);
  return keys;
}

function markTrack(seen, track) {
  for (const key of trackKeys(track)) seen.add(key);
}

function hasTrack(seen, track) {
  const keys = trackKeys(track);
  return keys.length > 0 && keys.some((key) => seen.has(key));
}

export function dedupeTracks(tracks = [], existing = []) {
  const seen = new Set();
  for (const t of existing) markTrack(seen, t);
  const out = [];
  for (const t of tracks) {
    if (!t || hasTrack(seen, t)) continue;
    markTrack(seen, t);
    out.push(t);
  }
  return out;
}

export async function search(query, limit = 8) {
  const results = [];
  if (useNavidrome()) {
    try { results.push(...await navidrome.search(query, limit)); }
    catch (e) { console.error('[music] navidrome search:', e.message); }
  }
  if (useNetease()) {
    try { results.push(...await netease.search(query, limit)); }
    catch (e) { console.error('[music] netease search:', e.message); }
  }
  if (useQQ()) {
    try { results.push(...await qqmusic.search(query, limit)); }
    catch (e) { console.error('[music] qq search:', e.message); }
  }
  return dedupeTracks(results);
}

// The DJ writes queries as "歌手 - 歌名", but Subsonic/Navidrome full-text
// search treats the " - " literally and returns 0 hits. Collapse the separator
// to a space (keeping intra-word hyphens like "Spider-Man") so tokens match.
function normalizeQuery(q = '') {
  return q.replace(/\s+[-–—]\s+/g, ' ').replace(/\s+/g, ' ').trim();
}

async function searchOne(query) {
  if (useNavidrome()) {
    try {
      const hits = await navidrome.search(query, 1);
      if (hits[0]) return hits[0];
    } catch (e) { console.error('[music] navidrome resolve:', e.message); }
  }
  if (useNetease()) {
    try {
      const hits = await netease.search(query, 1);
      if (hits[0]) return hits[0];
    } catch (e) { console.error('[music] netease resolve:', e.message); }
  }
  if (useQQ()) {
    try {
      const hits = await qqmusic.search(query, 1);
      if (hits[0]) return hits[0];
    } catch (e) { console.error('[music] qq resolve:', e.message); }
  }
  return null;
}

export async function resolve(query) {
  const norm = normalizeQuery(query);
  let hit = await searchOne(norm);
  if (!hit && norm !== query) hit = await searchOne(query); // fall back to raw
  return hit;
}

// Strip common Chinese "play me…" filler so the leftover is real search terms
// (artist/song/genre). e.g. "放几首周杰伦的歌" → "周杰伦".
function keywordsFor(text = '') {
  const STOP = /放|来点|来一?首|来|几首|几|点播|点|播放|播|我?想?听听?|我要|给我|帮我|的歌|的|歌曲|歌|音乐|曲子?|一些|一?首|那|这|吧|啊|呢|嘛|换|再|有没有|没有|什么|嗯/g;
  return text.replace(STOP, ' ').replace(/\s+/g, ' ').trim();
}

// Real, in-library candidates for a free-text request, formatted for the prompt.
// Returns '' when nothing matches (caller then lets the brain free-associate).
export async function candidatesText(text, limit = 20) {
  const kw = keywordsFor(text);
  const queries = [];
  if (kw) queries.push(kw);
  if (text && text.trim() && text.trim() !== kw) queries.push(text.trim());
  const seen = new Set();
  const out = [];
  for (const q of queries) {
    let hits = [];
    try { hits = await search(q, limit); } catch { /* ignore */ }
    for (const h of hits) {
      if (hasTrack(seen, h)) continue;
      markTrack(seen, h);
      out.push(h);
      if (out.length >= limit) break;
    }
    if (out.length >= limit) break;
  }
  return out
    .map((t) => `- ${t.artist} - ${t.title}${t.album ? ` 《${t.album}》` : ''} [${t.source}]`)
    .join('\n');
}

export async function resolveQueue(requests = []) {
  const out = [];
  for (const req of requests) {
    const q = typeof req === 'string' ? req : req.query;
    if (!q) continue;
    const track = await resolve(q);
    if (track) out.push({ ...track, reason: req.reason || '' });
  }
  return dedupeTracks(out);
}

export async function playbackUrl(track) {
  if (track.source === 'navidrome') return `/api/stream/${encodeURIComponent(track.id)}`;
  // Proxy netease through us so the browser plays a *same-origin* URL. The raw
  // netease CDN link is cross-origin without CORS — routing it through the
  // Web Audio graph (waveform) would output silence and zero analyser data.
  if (track.source === 'netease') return `/api/ncm/stream/${encodeURIComponent(track.id)}`;
  // QQ stream URLs are also cross-origin & time-limited → proxy + resolve fresh.
  if (track.source === 'qqmusic') return `/api/qq/stream/${encodeURIComponent(track.id)}`;
  return null;
}

// Absolute, LAN-reachable URL for a UPnP renderer to fetch. Navidrome streams
// are proxied through us (relative path) → prefix with our LAN base; netease
// URLs are already absolute & publicly reachable.
export async function castUrl(track = {}) {
  if (track.source === 'navidrome') return `${lanBaseUrl()}/api/stream/${encodeURIComponent(track.id)}`;
  if (track.source === 'netease') return (await netease.streamUrl(track.id)) || null;
  if (track.source === 'qqmusic') return (await qqmusic.streamUrl(track.id)) || null;
  if (track.url) return /^https?:\/\//i.test(track.url) ? track.url : `${lanBaseUrl()}${track.url}`;
  return null;
}

export async function lyricsFor(track) {
  if (track.source === 'navidrome') return navidrome.lyrics(track.artist, track.title);
  if (track.source === 'netease') return netease.lyrics(track.id);
  if (track.source === 'qqmusic') return qqmusic.lyrics(track.id);
  return '';
}

// Structured lyrics for the player. Returns { synced, lines }:
//   synced=true  → lines[].time is seconds (sorted); highlight against currentTime
//   synced=false → lines[].time is null (plain text, just display)
//   lines[].tr   → optional translation for that line (netease)
export async function lyricsLines(track = {}) {
  if (track.source === 'netease') {
    const { lrc, tlyric } = await netease.lyricsRich(track.id);
    const timed = parseLrc(lrc);
    if (timed.length) return { synced: true, lines: mergeTranslation(timed, tlyric) };
    if (lrc && lrc.trim()) return { synced: false, lines: plainLines(lrc) };
    return { synced: false, lines: [] };
  }
  if (track.source === 'navidrome') {
    const text = await navidrome.lyrics(track.artist, track.title);
    const timed = parseLrc(text);
    if (timed.length) return { synced: true, lines: timed };
    return { synced: false, lines: plainLines(text) };
  }
  if (track.source === 'qqmusic') {
    const text = await qqmusic.lyrics(track.id);
    const timed = parseLrc(text);
    if (timed.length) return { synced: true, lines: timed };
    if (text && text.trim()) return { synced: false, lines: plainLines(text) };
    return { synced: false, lines: [] };
  }
  return { synced: false, lines: [] };
}

export async function recommend(count = 20) {
  const pools = [];
  if (useNavidrome()) {
    try { pools.push(await navidrome.random(count)); } catch (e) { console.error('[music] recommend:', e.message); }
  }
  if (useNetease()) {
    try {
      const rec = await netease.dailyRecommend();
      if (rec?.length) pools.push(rec);
    } catch (e) { console.error('[music] netease recommend:', e.message); }
  }
  if (useQQ()) {
    try {
      const rec = await qqmusic.recommend(count);
      if (rec?.length) pools.push(rec);
    } catch (e) { console.error('[music] qq recommend:', e.message); }
  }
  const mixed = [];
  const maxLen = Math.max(0, ...pools.map((p) => p.length));
  for (let i = 0; i < maxLen; i += 1) {
    for (const p of pools) {
      if (p[i]) mixed.push(p[i]);
    }
  }
  return dedupeTracks(mixed).slice(0, count);
}

export { navidrome, netease, qqmusic };
