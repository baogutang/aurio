import { db } from '../store.js';
import { lanBaseUrl } from '../net.js';
import { navidrome } from './navidrome.js';
import { netease } from './netease.js';
import { qqmusic } from './qqmusic.js';
import { parseLrc, plainLines, mergeTranslation } from './lrc.js';
import { scoreTrack, tasteSummary } from '../agent/preferences.js';

export const MUSIC_SOURCES = ['combined', 'netease', 'navidrome', 'qqmusic'];

export function sourceServices() {
  return {
    // 网易云与 QQ 都走内置适配器，搜索开箱即用（无需登录）。网易云登录后能解锁
    // 更多可播曲目与每日推荐；未登录时版权受限曲的播放地址会解析失败（前端降级）。
    netease: netease.enabled(),
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

function sourceEnabled(source) {
  const svc = sourceServices();
  if (source === 'navidrome') return !!svc.navidrome;
  if (source === 'netease') return !!svc.netease;
  if (source === 'qqmusic') return !!svc.qqmusic;
  return false;
}

function shouldUseSource(source, constraints = {}) {
  if (constraints.source) return constraints.source === source && sourceEnabled(source);
  if (source === 'navidrome') return useNavidrome();
  if (source === 'netease') return useNetease();
  if (source === 'qqmusic') return useQQ();
  return false;
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

function normMatch(value = '') {
  return value
    .toString()
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '')
    .trim();
}

function cleanArtistHint(value = '') {
  const cleaned = value
    .toString()
    .replace(/navidrome|nas|NAS|网易云|网易|qq音乐|QQ音乐|qq|QQ/g, ' ')
    .replace(/里面|里边|里的|中的|中|上面|上|本地|曲库|音乐库/g, ' ')
    .replace(/我让|给我|帮我|想听|我想听|播放|放|播|来点|来几首|来首|几首|一首|一些|的歌|歌曲|歌|音乐|唱的/g, ' ')
    .replace(/[，。,.、：:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const alias = cleaned.toLowerCase().replace(/\s+/g, '');
  if (alias === 'jay' || alias === 'jaychou') return '周杰伦';
  return cleaned;
}

function requestedSource(text = '') {
  if (/navidrome|nas|本地|曲库|音乐库/i.test(text)) return 'navidrome';
  if (/网易云|网易|netease/i.test(text)) return 'netease';
  if (/qq音乐|QQ音乐|qqmusic/i.test(text)) return 'qqmusic';
  return '';
}

function requestedArtist(text = '') {
  const patterns = [
    /(?:歌手|艺人|artist)\s*[:：]?\s*([\u3400-\u9fffA-Za-z0-9 .·&-]{2,40})/i,
    /([\u3400-\u9fffA-Za-z0-9 .·&-]{2,40})(?:的歌|歌曲|唱的)/i,
    /(?:听|放|来(?:首|一首)?)\s*([\u4e00-\u9fffA-Za-z0-9 .·&-]{2,8})[的\s《]*([\u4e00-\u9fffA-Za-z0-9 .·&-]{2,20})/i,
    /([\u4e00-\u9fff]{2,6})[的\s《]+([\u4e00-\u9fffA-Za-z0-9 .·&-]{2,20})/,
  ];
  for (const pattern of patterns) {
    const hit = text.match(pattern);
    const name = hit?.[2] ? hit[1] : hit?.[1];
    const cleaned = cleanArtistHint(name || '');
    if (cleaned) return cleaned;
  }
  return '';
}

export function requestConstraints(text = '') {
  return {
    source: requestedSource(text),
    artist: requestedArtist(text),
  };
}

export function hasHardConstraints(constraints = {}) {
  return !!(constraints.source || constraints.artist);
}

export function describeConstraints(constraints = {}) {
  const parts = [];
  if (constraints.source === 'navidrome') parts.push('NAS');
  if (constraints.source === 'netease') parts.push('网易云');
  if (constraints.source === 'qqmusic') parts.push('QQ音乐');
  if (constraints.artist) parts.push(constraints.artist);
  return parts.join(' / ');
}

export function trackMatchesConstraints(track = {}, constraints = {}) {
  if (constraints.source && track.source !== constraints.source) return false;
  if (constraints.artist) {
    const wanted = normMatch(constraints.artist);
    const artist = normMatch(track.artist);
    if (!artist || (!artist.includes(wanted) && !wanted.includes(artist))) return false;
  }
  return true;
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

export async function search(query, limit = 8, options = {}) {
  const constraints = options.constraints || {};
  const results = [];
  if (shouldUseSource('navidrome', constraints)) {
    try { results.push(...await navidrome.search(query, limit)); }
    catch (e) { console.error('[music] navidrome search:', e.message); }
  }
  if (shouldUseSource('netease', constraints)) {
    try { results.push(...await netease.search(query, limit)); }
    catch (e) { console.error('[music] netease search:', e.message); }
  }
  if (shouldUseSource('qqmusic', constraints)) {
    try { results.push(...await qqmusic.search(query, limit)); }
    catch (e) { console.error('[music] qq search:', e.message); }
  }
  return dedupeTracks(results.filter((track) => trackMatchesConstraints(track, constraints)));
}

// The DJ writes queries as "歌手 - 歌名", but Subsonic/Navidrome full-text
// search treats the " - " literally and returns 0 hits. Collapse the separator
// to a space (keeping intra-word hyphens like "Spider-Man") so tokens match.
function normalizeQuery(q = '') {
  return q.replace(/\s+[-–—]\s+/g, ' ').replace(/\s+/g, ' ').trim();
}

async function searchOne(query, constraints = {}) {
  if (shouldUseSource('navidrome', constraints)) {
    try {
      const hits = await navidrome.search(query, 8);
      const hit = hits.find((track) => trackMatchesConstraints(track, constraints));
      if (hit) return hit;
    } catch (e) { console.error('[music] navidrome resolve:', e.message); }
  }
  if (shouldUseSource('netease', constraints)) {
    try {
      const hits = await netease.search(query, 8);
      const hit = hits.find((track) => trackMatchesConstraints(track, constraints));
      if (hit) return hit;
    } catch (e) { console.error('[music] netease resolve:', e.message); }
  }
  if (shouldUseSource('qqmusic', constraints)) {
    try {
      const hits = await qqmusic.search(query, 8);
      const hit = hits.find((track) => trackMatchesConstraints(track, constraints));
      if (hit) return hit;
    } catch (e) { console.error('[music] qq resolve:', e.message); }
  }
  return null;
}

export async function resolve(query, constraints = {}) {
  const norm = normalizeQuery(query);
  let hit = await searchOne(norm, constraints);
  if (!hit && norm !== query) hit = await searchOne(query, constraints); // fall back to raw
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
  return candidatesToText(await requestCandidates(text, limit));
}

export async function requestCandidates(text, limit = 20) {
  const constraints = requestConstraints(text);
  const kw = keywordsFor(text);
  const queries = [];
  if (constraints.artist) queries.push(constraints.artist);
  if (kw) queries.push(kw);
  if (text && text.trim() && text.trim() !== kw) queries.push(text.trim());
  const seen = new Set();
  const out = [];
  for (const q of queries) {
    let hits = [];
    try { hits = await search(q, limit, { constraints }); } catch { /* ignore */ }
    for (const h of hits) {
      if (hasTrack(seen, h)) continue;
      markTrack(seen, h);
      out.push(h);
      if (out.length >= limit) break;
    }
    if (out.length >= limit) break;
  }
  return rankTracks(out);
}

export function rankTracks(tracks = []) {
  const taste = tasteSummary();
  return dedupeTracks(tracks)
    .map((track) => ({ track, score: scoreTrack(track, taste) }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.track);
}

export function candidatesToText(tracks = []) {
  return tracks
    .map((t) => `- ${t.artist} - ${t.title}${t.album ? ` 《${t.album}》` : ''} [${sourceLabel(t.source)}]`)
    .join('\n');
}

export async function resolveQueue(requests = [], constraints = {}) {
  const out = [];
  for (const req of requests) {
    const q = typeof req === 'string' ? req : req.query;
    if (!q) continue;
    const reqConstraints = { ...constraints };
    const hint = typeof req === 'object' ? (req.source_hint || req.source) : '';
    if (hint) {
      if (/navidrome|nas|本地|曲库/i.test(String(hint))) reqConstraints.source = 'navidrome';
      else if (/netease|网易/i.test(String(hint))) reqConstraints.source = 'netease';
      else if (/qq/i.test(String(hint))) reqConstraints.source = 'qqmusic';
    }
    const track = await resolve(q, reqConstraints);
    if (track) out.push({ ...track, reason: req.reason || '' });
  }
  return rankTracks(dedupeTracks(out));
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

function sourceLabel(source) {
  if (source === 'navidrome') return 'NAS';
  if (source === 'netease') return '网易云';
  if (source === 'qqmusic') return 'QQ音乐';
  return source || 'unknown';
}

export async function recommend(count = 20, constraints = {}) {
  const pools = [];
  if (shouldUseSource('navidrome', constraints)) {
    try { pools.push(await navidrome.random(count)); } catch (e) { console.error('[music] recommend:', e.message); }
  }
  if (shouldUseSource('netease', constraints)) {
    try {
      const rec = await netease.dailyRecommend();
      if (rec?.length) pools.push(rec);
    } catch (e) { console.error('[music] netease recommend:', e.message); }
  }
  if (shouldUseSource('qqmusic', constraints)) {
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
  const taste = tasteSummary();
  const ranked = dedupeTracks(mixed.filter((track) => trackMatchesConstraints(track, constraints)))
    .map((track) => ({ track, score: scoreTrack(track, taste) }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.track);
  return ranked.slice(0, count);
}

export { navidrome, netease, qqmusic };
