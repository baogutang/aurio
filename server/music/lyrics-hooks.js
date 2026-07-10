// Salient-lyric extraction — gives the DJ real lines to speak from.
//
// The host's patter felt canned because the prompt never carried a single word
// from the songs on air. This module turns a track's raw lyrics (LRC or plain
// text) into 2–3 "hooks": the opening sung line and the most-repeated line(s)
// (repetition ≈ the chorus). context.js folds them into a 歌曲素材 block.
//
// Contract: fast, never throws, in-memory cached per track. A miss (no lyrics,
// instrumental, adapter error) caches as [] so we don't re-fetch garbage.
import { parseLrc } from './lrc.js';
import { lyricsFor } from './index.js';

// --- line filtering -------------------------------------------------------

// Credit/metadata headers before a colon: 作词/作曲/Lyrics by/OP/SP/…
// Matched only against the text LEFT of the first colon, so a sung line like
// 「我说：别走」 survives (「我说」 is not a credit keyword).
const CREDIT_KEYS = /(作词|作曲|填词|谱曲|编曲|制作|监制|出品|发行|混音|母带|录音|和声|合声|演唱|原唱|翻唱|歌手|艺人|吉他|贝斯|键盘|钢琴|弦乐|打击乐|鼓|笛|企划|统筹|策划|封面|设计|视觉|经纪|宣传|版权|词|曲|OP|SP|ISRC)/i;
const CREDIT_KEYS_EN = /\b(lyrics?|lyricist|music|melody|composer|composed|arranger?|arranged|producer|produced|written|mixed|mixing|master(?:ed|ing)?|record(?:ed|ing)?|vocals?|chorus\s*by|guitar|bass|drums?|piano|keyboards?|strings|label|publisher)\b/i;

function isCreditLine(line) {
  const m = line.match(/^([^:：︰]{1,24})[:：︰]/);
  if (m && (CREDIT_KEYS.test(m[1]) || CREDIT_KEYS_EN.test(m[1]))) return true;
  if (/^(lyrics?|music|composed|arranged|produced|written|mixed|mastered|performed)\s+by\b/i.test(line)) return true;
  if (/[©℗™]/.test(line)) return true;
  return false;
}

// Whole line wrapped in brackets → section header or annotation ([Verse 1],
// 【副歌】, (Chorus), 《歌名》…), never a singable line.
function isBracketHeader(line) {
  return /^[\[【(（<《{].*[\]】)）>》}]$/.test(line);
}

// Needs at least two letters/CJK chars to be worth quoting; pure punctuation,
// digits, mojibake and "---" separators fall out here.
function isSingable(line) {
  let letters = 0;
  for (const ch of line) {
    if (/[\p{L}]/u.test(ch)) letters += 1;
    if (letters >= 2) return true;
  }
  return false;
}

// Normalized identity for repetition counting — NFKC, case/punct/space blind,
// so 「霓虹在雨里慢慢化开」 and 「霓虹在雨里慢慢化开，」 count as the same line.
function normLine(line = '') {
  return line
    .toString()
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, '')
    .replace(/\s+/g, '')
    .trim();
}

// Cap to ~maxLen chars (code points). Latin text backtracks to a word break.
function capLine(line, maxLen = 30) {
  const chars = Array.from(line);
  if (chars.length <= maxLen) return line;
  let cut = chars.slice(0, maxLen - 1).join('');
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace > (maxLen - 1) * 0.6) cut = cut.slice(0, lastSpace);
  return `${cut.trim()}…`;
}

// --- extraction -----------------------------------------------------------

/**
 * Raw lyrics (LRC or plain text) → up to `max` speakable lines:
 *   hooks[0]  the opening sung line
 *   hooks[1+] the most-repeated distinct lines (count ≥ 2), i.e. the chorus
 * Returns [] for instrumentals, credits-only text, or garbage. Never throws.
 */
export function extractHooks(raw, { max = 3, maxLen = 30 } = {}) {
  try {
    const text = typeof raw === 'string' ? raw : '';
    if (!text.trim()) return [];
    // Netease marks instrumentals inside the lyric body itself.
    if (/纯音乐|没有填词|无歌词/.test(text) && text.length < 200) return [];

    const timed = parseLrc(text);
    const rawLines = timed.length ? timed.map((l) => l.text) : text.split(/\r?\n/);

    const kept = [];
    for (const r of rawLines.slice(0, 400)) {
      const line = String(r).trim();
      if (!line) continue;
      if (isCreditLine(line) || isBracketHeader(line) || !isSingable(line)) continue;
      kept.push(line);
    }
    if (!kept.length) return [];

    const counts = new Map(); // norm -> { count, first, text }
    kept.forEach((line, i) => {
      const key = normLine(line);
      if (!key) return;
      const e = counts.get(key);
      if (e) e.count += 1;
      else counts.set(key, { count: 1, first: i, text: line });
    });

    const opening = kept[0];
    const openKey = normLine(opening);
    const repeated = [...counts.values()]
      .filter((e) => e.count >= 2 && normLine(e.text) !== openKey)
      .sort((a, b) => (b.count - a.count) || (a.first - b.first));

    const out = [capLine(opening, maxLen)];
    for (const e of repeated) {
      if (out.length >= max) break;
      out.push(capLine(e.text, maxLen));
    }
    return out;
  } catch {
    return [];
  }
}

// --- per-track cache ------------------------------------------------------

const CACHE_MAX = 300;
const cache = new Map(); // key -> string[] (misses cached as [])
const pending = new Map(); // key -> Promise<string[]> (in-flight fetches)

export function hookKey(track = {}) {
  if (track.source && track.id) return `id:${track.source}:${track.id}`;
  const artist = (track.artist || '').toString().trim().toLowerCase();
  const title = (track.title || '').toString().trim().toLowerCase();
  return artist && title ? `song:${artist} - ${title}` : '';
}

function remember(key, hooks) {
  if (!cache.has(key) && cache.size >= CACHE_MAX) {
    cache.delete(cache.keys().next().value); // FIFO evict
  }
  cache.set(key, hooks);
}

function startFetch(track, key, fetcher) {
  let p = pending.get(key);
  if (p) return p;
  p = Promise.resolve()
    .then(() => fetcher(track))
    .then((raw) => extractHooks(raw))
    .catch(() => [])
    .then((hooks) => {
      remember(key, hooks);
      pending.delete(key);
      return hooks;
    });
  pending.set(key, p);
  return p;
}

/** Sync, cache-only read. Returns hooks[] if known, null if never fetched. */
export function cachedHooks(track) {
  const key = hookKey(track);
  if (!key || !cache.has(key)) return null;
  return cache.get(key);
}

/** Fire-and-forget warmup so the NEXT break finds this track already cached. */
export function prefetchHooks(track, { fetcher = lyricsFor } = {}) {
  const key = hookKey(track);
  if (!key || cache.has(key)) return;
  startFetch(track, key, fetcher);
}

/** Seed the cache from lyrics already in hand (also the test seam). */
export function primeHooks(track, rawLyrics) {
  const key = hookKey(track);
  if (!key) return [];
  const hooks = extractHooks(rawLyrics);
  remember(key, hooks);
  return hooks;
}

/**
 * Hooks for a track, fetching lyrics if needed. Bounded by `timeoutMs`: on
 * timeout it returns [] immediately while the fetch keeps running in the
 * background and fills the cache for the next break. Never throws.
 */
export async function hooksForTrack(track, { timeoutMs = 1500, fetcher = lyricsFor } = {}) {
  try {
    const key = hookKey(track);
    if (!key) return [];
    if (cache.has(key)) return cache.get(key);
    const fetch = startFetch(track, key, fetcher);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return await fetch;
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
    });
    const result = await Promise.race([fetch, timeout]);
    clearTimeout(timer);
    return result ?? [];
  } catch {
    return [];
  }
}

export function clearHooksCache() {
  cache.clear();
  pending.clear();
}
