// 音乐故事引擎 — the verifiable-material pipeline (RADIO_VISION §六B·A).
//
// Claudio's DJ tells "back in 1971…" stories from the model's free-floating
// music knowledge — which hallucinates. Aurio's equivalent must be VERIFIABLE:
// every specific claim in a spoken break comes from real text fetched from the
// track's own music source (netease 歌手简介/专辑文案, QQ 同类接口, navidrome
// tags), distilled ONCE by the LLM into 5–8 story-ready facts — each carrying
// the source snippet it came from — and cached forever.
//
// Two cards per track, cached in DATA_ROOT/cache/stories.json (cue.js pattern:
// versioned schema, atomic write, in-flight coalescing):
//   artist:<artist>          the artist's bio, distilled
//   album:<artist>/<album>   the album blurb + release metadata, distilled
//
// A card: { v, kind, subject, source, facts: [{ fact, source }], distilled,
// fetchedAt }. Distillation failure degrades to trimmed raw excerpts (the
// facts ARE the raw sentences); no material at all is remembered in-process
// only, so a restart retries. Everything is best-effort and never throws.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_ROOT, config } from '../config.js';
import { extractJson } from '../brain/parse.js';
import { navidrome } from './navidrome.js';

export const STORY_SCHEMA_VERSION = 1;
export const STORY_CACHE_FILE = path.join(DATA_ROOT, 'cache', 'stories.json');

const RAW_TEXT_CAP = 2000;     // per raw text (bio / blurb), code points
const MAX_FACTS = 8;
const FACT_MAX = 90;           // stored fact length
const SOURCE_MAX = 60;         // stored source-snippet length
const FETCH_DEADLINE_MS = 10000;
const MAX_CONCURRENT_BUILDS = 2; // fetch+distill is I/O + LLM spend — keep it polite

// --- small helpers ----------------------------------------------------------

function clip(value, max) {
  const t = (value ?? '').toString().replace(/\s+/g, ' ').trim();
  const cp = Array.from(t);
  return cp.length <= max ? t : `${cp.slice(0, max - 1).join('')}…`;
}

// Cap raw source text, keeping line structure (the distiller reads it).
function rawCap(value, max = RAW_TEXT_CAP) {
  const t = (value ?? '').toString().trim();
  const cp = Array.from(t);
  return cp.length <= max ? t : cp.slice(0, max).join('');
}

function yearFromMs(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const y = new Date(n).getFullYear();
  return y > 1900 ? y : undefined;
}

function yearFromDate(s) {
  const m = /(19|20)\d{2}/.exec((s ?? '').toString());
  return m ? Number(m[0]) : undefined;
}

function withDeadline(promise, ms = FETCH_DEADLINE_MS) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const t = setTimeout(() => reject(new Error(`story fetch timed out after ${ms}ms`)), ms);
      if (t.unref) t.unref();
    }),
  ]);
}

// --- keys --------------------------------------------------------------------

function normPart(value = '') {
  return value.toString().normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Cache keys for a track's two story cards ('' when unkeyable). */
export function storyKeys(track = {}) {
  const artist = normPart(track.artist);
  const album = normPart(track.album);
  return {
    artist: artist ? `artist:${artist}` : '',
    album: artist && album ? `album:${artist}/${album}` : '',
  };
}

// --- raw material: per-source fetchers ---------------------------------------
//
// Each source exposes different capabilities; every missing capability just
// leaves its field null. Returns { artist: {name,text}|null,
// album: {name,artist,text,year,company,genre}|null }. Never throws.

// netease: the vendored NCM client has the standard metadata endpoints —
// song_detail → artist/album ids, artist_desc (歌手简介), album (专辑文案 +
// publishTime + company). The client is imported lazily so tests that never
// fetch never load it; the anonymous-device registration mirrors netease.js
// (metadata calls are less risk-gated than streaming, but the realIP still
// matters for off-shore exits).
let ncmInit = null; // Promise<{ call } | null>
function ncmCaller() {
  if (ncmInit) return ncmInit;
  ncmInit = (async () => {
    try {
      const [pkgMod, utilMod] = await Promise.all([
        import('NeteaseCloudMusicApi'),
        import('NeteaseCloudMusicApi/util/index.js'),
      ]);
      const pkg = pkgMod.default ?? pkgMod;
      const ncm = pkg.default ?? pkg;
      const util = utilMod.default ?? utilMod;
      const realIP = config.netease.realIP || util.generateRandomChineseIP();
      let anonCookie = '';
      if (!config.netease.cookie) {
        try {
          const b = await ncm.register_anonimous({ realIP, timestamp: Date.now() });
          anonCookie = b?.body?.cookie || '';
        } catch { /* metadata endpoints mostly work anonymously */ }
      }
      const call = async (fn, params = {}) => {
        const cookie = config.netease.cookie || anonCookie || '';
        const res = await ncm[fn]({ ...params, cookie, realIP, timestamp: Date.now() });
        return res.body;
      };
      return { call };
    } catch (e) {
      console.error('[story] netease client unavailable:', e.message);
      return null;
    }
  })();
  return ncmInit;
}

async function fetchNetease(track, opts = {}) {
  const call = opts.ncmCall || (await ncmCaller())?.call;
  if (!call) return { artist: null, album: null };
  let artist = null;
  let album = null;
  try {
    const d = await withDeadline(call('song_detail', { ids: String(track.id) }));
    const song = d?.songs?.[0] || null;
    const artistId = song?.ar?.[0]?.id;
    const albumId = song?.al?.id;
    const albumName = track.album || song?.al?.name || '';
    const songYear = yearFromMs(song?.publishTime) ?? track.year;

    if (artistId) {
      try {
        const b = await withDeadline(call('artist_desc', { id: artistId }));
        const intro = Array.isArray(b?.introduction)
          ? b.introduction.map((x) => [x?.ti, x?.txt].filter(Boolean).join('：')).join('\n')
          : '';
        const text = [b?.briefDesc, intro].filter(Boolean).join('\n');
        if (text.trim()) {
          artist = { name: track.artist || song?.ar?.[0]?.name || '', text: rawCap(text) };
        }
      } catch { /* no bio → no artist card */ }
    }
    if (albumId && albumName) {
      try {
        const b = await withDeadline(call('album', { id: albumId }));
        const al = b?.album || {};
        album = {
          name: albumName,
          artist: track.artist || '',
          text: rawCap(al.description || al.briefDesc || ''),
          year: yearFromMs(al.publishTime) ?? songYear,
          company: (al.company || '').toString().trim(),
        };
      } catch { /* fall through to metadata-only below */ }
    }
    if (!album && albumName && songYear) {
      album = { name: albumName, artist: track.artist || '', text: '', year: songYear };
    }
  } catch { /* keep whatever we already have */ }
  return { artist, album };
}

// QQ music: no exported helpers on the adapter, so this replicates its minimal
// web-endpoint style — song detail → singer mid + album mid, singer 简介 via
// fcg_get_singer_desc (XML/CDATA), album 文案+发行 via fcg_v8_album_info_cp.
const QQ_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 9_1 like Mac OS X) AppleWebKit/601.1.46 (KHTML, like Gecko) Version/9.0 Mobile/13B143 Safari/601.1';

function qqHeaders() {
  const ip = `112.64.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`;
  return {
    'User-Agent': QQ_UA,
    Referer: 'https://y.qq.com',
    'X-Forwarded-For': ip,
    'Client-IP': ip,
  };
}

async function qqGetText(url) {
  const res = await fetch(url, { headers: qqHeaders(), signal: AbortSignal.timeout(FETCH_DEADLINE_MS) });
  if (!res.ok) throw new Error(`qq story GET HTTP ${res.status}`);
  return res.text();
}

async function qqGetJson(url) {
  const text = await qqGetText(url);
  const t = text.trim();
  const m = t.match(/^[\w$]+\((.*)\)$/s);
  return JSON.parse(m ? m[1] : t);
}

// The singer-desc endpoint answers XML with the readable 简介 inside CDATA
// blocks; the longest non-trivial block is the bio.
export function cdataText(xml = '') {
  const chunks = [...String(xml).matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g)]
    .map((m) => m[1].trim())
    .filter((s) => Array.from(s).length >= 20);
  if (!chunks.length) return '';
  return chunks.sort((a, b) => b.length - a.length)[0];
}

async function fetchQQ(track, opts = {}) {
  const getJson = opts.qqJson || qqGetJson;
  const getText = opts.qqText || qqGetText;
  let artist = null;
  let album = null;
  try {
    const u = new URL('https://c.y.qq.com/v8/fcg-bin/fcg_play_single_song.fcg');
    const id = String(track.id || '').trim();
    if (/^\d+$/.test(id)) u.searchParams.set('songid', id);
    else u.searchParams.set('songmid', id);
    u.searchParams.set('format', 'json');
    const body = await getJson(u.toString());
    const item = body?.data?.[0] || {};
    const singerMid = item?.singer?.[0]?.mid || '';
    const albumMid = item.albummid || item?.album?.mid || track.albumMid || '';
    const albumName = track.album || item.albumname || item?.album?.name || '';

    if (singerMid) {
      try {
        const xml = await getText(`https://c.y.qq.com/splcloud/fcgi-bin/fcg_get_singer_desc.fcg?singermid=${encodeURIComponent(singerMid)}&utf8=1&outCharset=utf-8&format=xml`);
        const text = cdataText(xml);
        if (text) artist = { name: track.artist || item?.singer?.[0]?.name || '', text: rawCap(text) };
      } catch { /* no bio */ }
    }
    if (albumMid) {
      try {
        const b = await getJson(`https://c.y.qq.com/v8/fcg-bin/fcg_v8_album_info_cp.fcg?albummid=${encodeURIComponent(albumMid)}&format=json`);
        const d = b?.data || {};
        album = {
          name: albumName || d.name || '',
          artist: track.artist || '',
          text: rawCap(d.desc || ''),
          year: yearFromDate(d.aDate),
          company: (d.company || '').toString().trim(),
        };
        if (!album.name) album = null;
      } catch { /* no album card */ }
    }
  } catch { /* keep whatever we already have */ }
  return { artist, album };
}

// navidrome: no prose anywhere, but the file tags (year/genre/album) are
// ground truth from the listener's own library → metadata-only album card.
async function fetchNavidrome(track, opts = {}) {
  const getSong = opts.getSong || (navidrome.enabled() ? navidrome.getSong : null);
  let song = null;
  if (getSong) {
    try { song = await withDeadline(getSong(track.id)); } catch { song = null; }
  }
  const merged = { ...track, ...(song || {}) };
  const album = merged.album && (merged.year || merged.genre)
    ? { name: merged.album, artist: merged.artist || '', text: '', year: merged.year, genre: merged.genre }
    : null;
  return { artist: null, album };
}

/**
 * Raw story material for a track, from its own source. Fields degrade to null
 * per missing capability; texts are capped at ~2000 chars. Never throws.
 */
export async function fetchRawMaterial(track = {}, opts = {}) {
  try {
    if (track.source === 'netease') return await fetchNetease(track, opts);
    if (track.source === 'qqmusic') return await fetchQQ(track, opts);
    if (track.source === 'navidrome') return await fetchNavidrome(track, opts);
    // Unknown source: whatever metadata rides on the track object itself.
    const album = track.album && (track.year || track.genre)
      ? { name: track.album, artist: track.artist || '', text: '', year: track.year, genre: track.genre }
      : null;
    return { artist: null, album };
  } catch {
    return { artist: null, album: null };
  }
}

// --- distillation -------------------------------------------------------------
//
// One LLM call per subject, once ever (the card caches forever). Raw-JSON
// conventions as in judge-llm.js: prompt demands a bare JSON object, parse via
// extractJson. brain.think() would normalize the reply into a DJ action and
// drop the facts array, so the default caller is brain.ask() (raw text).

let brainAsk = null;
async function llmAsk(prompt) {
  if (!brainAsk) {
    const brain = await import('../brain/index.js');
    brainAsk = brain.ask;
  }
  if (typeof brainAsk !== 'function') throw new Error('brain ask unavailable');
  return brainAsk(prompt);
}

function distillPrompt(subject, raw) {
  return [
    `你是电台的资料员。下面是「${subject}」的官方介绍文本。把里面可以在口播里讲的、具体、可核实的事实提炼成 5–8 条，每条一句中文。`,
    '每条必须附上你依据的原文片段（30 字以内，直接从原文截取，不改写）。只提炼原文里真的写了的事：年份、地名、经历、奖项、合作者、创作背景。原文里没有的绝对不要补。',
    '你必须只输出一个原始 JSON 对象，不要 markdown，不要代码块，不要任何解释，格式：',
    '{"facts":[{"fact":"一句话的事实","source":"依据的原文片段"}]}',
    '原文：',
    '<<<',
    raw,
    '>>>',
  ].join('\n');
}

async function distill(subject, raw, opts = {}) {
  const askFn = opts.think || llmAsk;
  const reply = await askFn(distillPrompt(subject, raw));
  const parsed = extractJson(typeof reply === 'string' ? reply : JSON.stringify(reply ?? ''));
  const facts = Array.isArray(parsed?.facts) ? parsed.facts : [];
  return facts
    .map((f) => ({ fact: clip(f?.fact, FACT_MAX), source: clip(f?.source, SOURCE_MAX) }))
    .filter((f) => f.fact)
    .slice(0, MAX_FACTS);
}

// Distillation failed → the raw sentences themselves become the facts, each
// its own source snippet. Less story-shaped, still verifiable.
export function excerptFacts(raw = '') {
  return raw
    .toString()
    .split(/[。！？!?\n]+/)
    .map((s) => s.trim())
    .filter((s) => Array.from(s).length >= 10)
    .slice(0, 5)
    .map((s) => ({ fact: clip(s, FACT_MAX), source: clip(s, SOURCE_MAX) }));
}

// Release metadata is verifiable without any prose — turn it into facts so the
// year the host may speak is literally present in the material text.
function metaFacts(album = {}) {
  const out = [];
  if (!album.name) return out;
  if (album.year) out.push({ fact: `《${album.name}》发行于 ${album.year} 年`, source: `发行时间 ${album.year}` });
  if (album.company) out.push({ fact: `《${album.name}》由${clip(album.company, 30)}发行`, source: `发行公司 ${clip(album.company, 30)}` });
  if (album.genre) out.push({ fact: `《${album.name}》的流派标注是${clip(album.genre, 20)}`, source: `音频标签 genre=${clip(album.genre, 20)}` });
  return out;
}

async function makeCard(kind, src, track, opts) {
  if (!src) return null;
  const subject = kind === 'artist'
    ? (src.name || track.artist || '')
    : `${src.artist || track.artist || ''}《${src.name || track.album || ''}》`;
  let facts = [];
  let distilled = false;
  const text = (src.text || '').trim();
  if (text) {
    try {
      const got = await distill(subject, text, opts);
      if (got.length) { facts = got; distilled = true; }
    } catch { /* fall back to excerpts */ }
    if (!facts.length) facts = excerptFacts(text);
  }
  if (kind === 'album') facts = facts.concat(metaFacts(src));
  if (!facts.length) return null;
  return {
    v: STORY_SCHEMA_VERSION,
    kind,
    subject,
    source: track.source || '',
    facts: facts.slice(0, MAX_FACTS),
    distilled,
    fetchedAt: new Date().toISOString(),
  };
}

// --- permanent cache (cue.js pattern) ------------------------------------------

let storyStore = null;         // loaded cache file, lazy
const memory = new Map();      // key → null: fetched, nothing found (retry after restart)
const pending = new Map();     // key → in-flight Promise

function loadStore() {
  if (storyStore) return storyStore;
  try {
    const raw = JSON.parse(fs.readFileSync(STORY_CACHE_FILE, 'utf8'));
    storyStore = raw && raw.v === STORY_SCHEMA_VERSION && raw.stories && typeof raw.stories === 'object'
      ? { v: STORY_SCHEMA_VERSION, stories: raw.stories }
      : { v: STORY_SCHEMA_VERSION, stories: {} };
  } catch {
    storyStore = { v: STORY_SCHEMA_VERSION, stories: {} };
  }
  return storyStore;
}

function saveStore() {
  try {
    const dir = path.dirname(STORY_CACHE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = `${STORY_CACHE_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(loadStore()));
    fs.renameSync(tmp, STORY_CACHE_FILE); // atomic-ish: no torn stories.json
  } catch (e) {
    console.error('[story] cache save:', e.message);
  }
}

function readCard(key) {
  return loadStore().stories[key] || memory.get(key) || null;
}

// Known = we already looked, whichever way it went. Only a card with facts
// earns the permanent file; a miss is remembered in-process only.
function knownCard(key) {
  return !!loadStore().stories[key] || memory.has(key);
}

function storeCard(key, card) {
  if (card && card.facts?.length) {
    loadStore().stories[key] = card;
    saveStore();
    memory.delete(key);
  } else {
    memory.set(key, null);
  }
}

// --- concurrency guard ----------------------------------------------------------

let activeBuilds = 0;
const buildWaiters = [];
async function withSlot(fn) {
  if (activeBuilds >= MAX_CONCURRENT_BUILDS) {
    await new Promise((resolve) => buildWaiters.push(resolve));
  }
  activeBuilds += 1;
  try {
    return await fn();
  } finally {
    activeBuilds -= 1;
    const next = buildWaiters.shift();
    if (next) next();
  }
}

async function buildCards(track, cardKeys, opts) {
  const fetchRaw = opts.fetchRaw || fetchRawMaterial;
  let raw = null;
  try { raw = await fetchRaw(track, opts); } catch { raw = null; }
  const keys = storyKeys(track);
  for (const key of cardKeys) {
    const kind = key === keys.artist ? 'artist' : 'album';
    let card = null;
    try { card = await makeCard(kind, kind === 'artist' ? raw?.artist : raw?.album, track, opts); } catch { card = null; }
    storeCard(key, card);
  }
}

// --- public surface ---------------------------------------------------------------

// Artist and album facts interleaved so a 6-line trim still shows both kinds.
function interleave(a = [], b = []) {
  const out = [];
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i]) out.push(a[i]);
    if (b[i]) out.push(b[i]);
  }
  return out;
}

/**
 * Sync, cache-only read. Returns { facts: [{fact,source}], artist, album,
 * distilled } merged from the track's cached cards, or null when nothing
 * usable is cached.
 */
export function cachedStory(track = {}) {
  const keys = storyKeys(track);
  const a = keys.artist ? readCard(keys.artist) : null;
  const b = keys.album ? readCard(keys.album) : null;
  const facts = interleave(a?.facts || [], b?.facts || []);
  if (!facts.length) return null;
  return {
    facts,
    artist: track.artist || '',
    album: track.album || '',
    distilled: !!(a?.distilled || b?.distilled),
  };
}

/**
 * Story card for a track, fetching + distilling at most once per subject.
 * Concurrent calls for the same subjects coalesce; a bounded number of builds
 * run at a time. Resolves to cachedStory(track) (possibly null). Never rejects.
 */
export function ensureStory(track = {}, opts = {}) {
  const keys = storyKeys(track);
  const wanted = [keys.artist, keys.album].filter(Boolean);
  if (!wanted.length) return Promise.resolve(null);
  const missing = wanted.filter((k) => !knownCard(k));
  if (!missing.length) return Promise.resolve(cachedStory(track));

  const waits = [];
  const mine = missing.filter((k) => {
    const p = pending.get(k);
    if (p) { waits.push(p); return false; }
    return true;
  });
  if (!mine.length) {
    return Promise.allSettled(waits).then(() => cachedStory(track));
  }
  const job = withSlot(() => buildCards(track, mine, opts))
    .catch((e) => { console.error('[story] build:', e.message); })
    .then(() => {
      for (const k of mine) pending.delete(k);
      return Promise.allSettled(waits).then(() => cachedStory(track));
    });
  for (const k of mine) pending.set(k, job);
  return job;
}

/** Fire-and-forget warmup so the break that airs this track finds it cached. */
export function prefetchStory(track = {}) {
  const keys = storyKeys(track);
  const wanted = [keys.artist, keys.album].filter(Boolean);
  if (!wanted.length || wanted.every((k) => knownCard(k))) return;
  ensureStory(track).catch(() => {});
}

/**
 * Bounded read for prompt assembly: cache hit returns immediately; a miss
 * races the fetch+distill against `timeoutMs` and returns whatever is cached
 * by then (the build keeps running and warms the next break). Never throws.
 */
export async function storyForTrack(track = {}, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 1200;
  try {
    const keys = storyKeys(track);
    const wanted = [keys.artist, keys.album].filter(Boolean);
    if (!wanted.length) return null;
    if (wanted.every((k) => knownCard(k))) return cachedStory(track);
    const build = ensureStory(track, opts);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return await build;
    let timer;
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve('timeout'), timeoutMs); });
    const raced = await Promise.race([build, timeout]);
    clearTimeout(timer);
    return raced === 'timeout' ? cachedStory(track) : raced;
  } catch {
    return null;
  }
}

/**
 * Seed the cache without fetching (also the test seam). Non-empty facts land
 * as a distilled artist card; the album key is marked known so no background
 * fetch fires for this track.
 */
export function primeStory(track = {}, facts = []) {
  const keys = storyKeys(track);
  const clean = (Array.isArray(facts) ? facts : [])
    .map((f) => ({ fact: clip(f?.fact, FACT_MAX), source: clip(f?.source, SOURCE_MAX) }))
    .filter((f) => f.fact)
    .slice(0, MAX_FACTS);
  if (keys.artist) {
    storeCard(keys.artist, clean.length ? {
      v: STORY_SCHEMA_VERSION,
      kind: 'artist',
      subject: track.artist || '',
      source: track.source || '',
      facts: clean,
      distilled: true,
      fetchedAt: new Date().toISOString(),
    } : null);
  }
  if (keys.album && !knownCard(keys.album)) memory.set(keys.album, null);
  return cachedStory(track);
}

/** Test helper: forget the loaded cache, in-process misses, and in-flight work. */
export function resetStoryState() {
  storyStore = null;
  memory.clear();
  pending.clear();
  ncmInit = null;
  brainAsk = null;
}
