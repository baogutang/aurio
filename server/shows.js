// The programme schedule (节目表) — named shows carve the day into dayparts,
// each with a tone, music rules and a talk-density budget (RADIO_VISION §四).
//
// The schedule is user data: user/shows.json, editable like user/taste.md.
// Shows match in file order (first match wins on overlaps); hours no show
// claims belong to the implicit default show 《随波》. A malformed file can
// never take the station down — it degrades to the default show with one
// warning per broken file version.
//
// This module also owns the talk budget: how many breaks the host has ACTUALLY
// spoken in the current show's rolling hour (persisted via db prefs, so a
// restart doesn't grant free speech). dj.js consults it before composing a
// scheduled beat and records every aired break; user chat is always exempt —
// the hotline answers, budget or not. Imaging liners/IDs never pass through
// here: they are identity, not conversation.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_ROOT } from './config.js';
import { db } from './store.js';
import { isQuietNow } from './plan.js';

const HOUR_MS = 60 * 60 * 1000;
export const TALK_LEDGER_KEY = 'talkLedger';
const TALK_LEDGER_MAX = 60;

// The implicit default show: whatever hour no named show claims. Moderate
// budget — present, but the music leads.
export const DEFAULT_SHOW = Object.freeze({
  name: '随波',
  freq: '87.9',
  start: '00:00',
  end: '24:00',
  startMin: 0,
  endMin: 1440,
  days: undefined,
  talkBudget: 2,
  tone: '顺着此刻的时间与天气走，不抢戏',
  musicRules: '延续当前基调，熟歌为主，偶尔一点新鲜',
  familiarOnly: false,
  voice: undefined,
  isDefault: true,
});

// Mirrors the seed in user/shows.json. Used when the file is absent entirely —
// installs upgraded from older versions never had shows.json copied into their
// data dir, and they should still get a schedule. An explicit empty `shows`
// array in the file, by contrast, means "no named shows" and is honoured.
const BUILTIN_SHOWS = [
  {
    name: '早安频率', freq: '90.2', start: '07:00', end: '09:00', talkBudget: 3,
    tone: '清醒、轻快；天气、日程、报时都值得说一句',
    musicRules: '轻快有精神，只放听众熟悉的歌，早晨不试新',
    familiarOnly: true,
  },
  {
    name: '工作台', freq: '95.8', start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5], talkBudget: 1,
    tone: '近乎不说话，开口也只一句，不打扰',
    musicRules: '适合专注的器乐与听熟的老歌，节奏平稳不突兀',
  },
  {
    name: '深夜航班', freq: '88.7', start: '21:00', end: '24:00', talkBudget: 2,
    tone: '语速慢、声音轻，讲一个完整的小故事，敢留白',
    musicRules: '敢放冷门与回忆，慢歌优先，越晚越静',
    sayMax: 120, segueMax: 50,
    voice: { voiceType: 'zh_male_shenyeboke_emo_v2_mars_bigtts', speed: 0.85 },
  },
];

// "HH:MM" → minutes since midnight, or null. "24:00" (=1440) is allowed so an
// end can land exactly on midnight; anything past it is rejected.
function parseHM(value) {
  const m = /^([01]?\d|2[0-4]):([0-5]\d)$/.exec((value || '').toString().trim());
  if (!m) return null;
  const mins = Number(m[1]) * 60 + Number(m[2]);
  return mins > 1440 ? null : mins;
}

function positiveInt(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

// Optional per-show voice params (workstream C): { voiceType?, speed?, emotion? }
// override the TTS provider's configured voice for breaks aired in this show.
// Sanitized, never rejected — a typo in the voice field must not take the show
// off the schedule the way a broken time window rightly does.
function validateVoice(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out = {};
  if (typeof raw.voiceType === 'string' && raw.voiceType.trim()) out.voiceType = raw.voiceType.trim();
  const speed = Number(raw.speed);
  if (Number.isFinite(speed) && speed > 0) out.speed = speed;
  if (typeof raw.emotion === 'string' && raw.emotion.trim()) out.emotion = raw.emotion.trim();
  return Object.keys(out).length ? out : undefined;
}

// Validate one raw entry into a normalized show, or null when it can't be
// trusted. Kept strict: a half-valid show airing at the wrong hour is worse
// than falling back to the default show.
function validateShow(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const name = (raw.name || '').toString().trim();
  const startMin = parseHM(raw.start);
  const endMin = parseHM(raw.end);
  if (!name || startMin == null || endMin == null) return null;
  if (startMin >= 1440) return null;            // a show can't start at 24:00
  if (startMin === endMin) return null;         // zero-length window
  const talkBudget = Number(raw.talkBudget);
  if (!Number.isFinite(talkBudget) || talkBudget < 0) return null;
  let days;
  if (raw.days !== undefined) {
    if (!Array.isArray(raw.days)) return null;
    days = [...new Set(raw.days.map(Number).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))];
    if (!days.length) return null;
  }
  return {
    name,
    freq: raw.freq == null ? '' : String(raw.freq).trim(),
    start: (raw.start || '').toString().trim(),
    end: (raw.end || '').toString().trim(),
    startMin,
    endMin,
    days,
    talkBudget: Math.floor(talkBudget),
    tone: (raw.tone || '').toString().trim(),
    musicRules: (raw.musicRules || '').toString().trim(),
    familiarOnly: raw.familiarOnly === true,
    sayMax: positiveInt(raw.sayMax),
    segueMax: positiveInt(raw.segueMax),
    voice: validateVoice(raw.voice),
    isDefault: false,
  };
}

let cache = null;      // { key, shows, broken } — keyed by file mtime+size
let warnedKey = '';    // warn once per broken file version, not per prompt

/** Test seam: forget the parsed file between cases. */
export function _resetShows() {
  cache = null;
  warnedKey = '';
}

function showsFile() {
  return path.join(DATA_ROOT, 'user', 'shows.json');
}

function warnOnce(key, message) {
  if (warnedKey === key) return;
  warnedKey = key;
  console.warn(`[shows] ${message}`);
}

/** The validated named shows, in file order. Never throws. */
export function listShows() {
  const file = showsFile();
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    // Absent file (e.g. an upgraded install whose user/ predates shows.json):
    // fall back to the built-in seed so the station still has a day shape.
    cache = null; // absent ≠ broken: a stale broken flag must not linger
    return BUILTIN_SHOWS.map(validateShow).filter(Boolean);
  }
  const key = `${stat.mtimeMs}:${stat.size}`;
  if (cache && cache.key === key) return cache.shows;
  let shows = [];
  let broken = false;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const list = Array.isArray(parsed) ? parsed
      : Array.isArray(parsed?.shows) ? parsed.shows : null;
    if (!list) throw new Error('expected an array or { "shows": [...] }');
    shows = list.map(validateShow).filter(Boolean);
    const dropped = list.length - shows.length;
    if (dropped > 0) warnOnce(key, `user/shows.json: ${dropped} 条节目无效，已跳过（其余照常）`);
  } catch (e) {
    warnOnce(key, `user/shows.json 无法读取，整天走默认档《${DEFAULT_SHOW.name}》: ${e.message}`);
    shows = [];
    broken = true;
  }
  cache = { key, shows, broken };
  return shows;
}

/**
 * True when the CURRENT version of user/shows.json fails outright (unparseable
 * or not a show list). Partial drops don't count — the valid siblings still
 * air. Prompts degrade to the default show either way; the scheduler uses this
 * to keep the previous cron set instead of tearing every boundary down over a
 * typo mid-edit. Re-stats the file, so the verdict tracks the latest edit.
 */
export function showsFileBroken() {
  listShows();
  return !!(cache && cache.broken);
}

// ISO weekday: Monday=1 … Sunday=7 (JS getDay has Sunday=0).
function isoDayOf(date) {
  const d = date.getDay();
  return d === 0 ? 7 : d;
}

function crossesMidnight(show) {
  return show.endMin < show.startMin;
}

function matchesShow(show, date) {
  const m = date.getHours() * 60 + date.getMinutes();
  const crosses = crossesMidnight(show);
  const inWindow = crosses
    ? (m >= show.startMin || m < show.endMin)
    : (m >= show.startMin && m < show.endMin);
  if (!inWindow) return false;
  if (!show.days) return true;
  // The post-midnight tail of a crossing show belongs to the day it STARTED:
  // a Friday 22:00–02:00 show still owns Saturday 01:00.
  let day = isoDayOf(date);
  if (crosses && m < show.endMin) day = day === 1 ? 7 : day - 1;
  return show.days.includes(day);
}

/** The show on air at `now`. First match wins; falls back to DEFAULT_SHOW. */
export function currentShow(now = new Date()) {
  for (const s of listShows()) {
    if (matchesShow(s, now)) return s;
  }
  return DEFAULT_SHOW;
}

/** Wall-clock ms when the current airing of `show` started, relative to `now`. */
export function showStartMs(show, now = Date.now()) {
  const d = new Date(now);
  const m = d.getHours() * 60 + d.getMinutes();
  const startedYesterday = crossesMidnight(show) && m < show.endMin;
  d.setHours(Math.floor(show.startMin / 60), show.startMin % 60, 0, 0);
  if (startedYesterday) d.setDate(d.getDate() - 1);
  return d.getTime();
}

// ---------------------------------------------------------------------------
// Talk budget — spoken breaks per rolling hour, clamped to the show boundary.
//
// The window is max(now − 1h, show start): a new show opens with a fresh
// voice (its show-open isn't muted by the previous show's chatter), while
// inside a long show the budget genuinely rolls hour by hour.
// ---------------------------------------------------------------------------

function ledger() {
  const raw = db.getPref(TALK_LEDGER_KEY, []);
  return Array.isArray(raw) ? raw.filter((ts) => Number.isFinite(ts)) : [];
}

/** Record one aired spoken break (a segment whose non-empty say went out). */
export function recordSpokenBreak(now = Date.now()) {
  const list = ledger().filter((ts) => now - ts < HOUR_MS);
  list.push(now);
  if (list.length > TALK_LEDGER_MAX) list.splice(0, list.length - TALK_LEDGER_MAX);
  db.setPref(TALK_LEDGER_KEY, list);
}

// The decision dj.js consults before composing a segment.
//   { allowed, exempt, spent, budget, show, quiet }
// 'chat' is always allowed — the hotline answers. Everything else spends from
// the current show's hourly allowance AND yields to the day plan's quiet
// windows (server/plan.js): a meeting on the calendar hard-mutes scheduled
// breaks regardless of budget — 「会议静默」, surfaced via `quiet.reason` so
// callers and the UI can say WHY the host went silent.
export function consultTalkBudget(kind, now = Date.now()) {
  const show = currentShow(new Date(now));
  const windowStart = Math.max(now - HOUR_MS, showStartMs(show, now));
  const spent = ledger().filter((ts) => ts >= windowStart && ts <= now).length;
  const exempt = kind === 'chat';
  const quiet = exempt ? null : isQuietNow(now);
  return {
    allowed: exempt || (!quiet && spent < show.talkBudget),
    exempt,
    spent,
    budget: show.talkBudget,
    show,
    quiet,
  };
}

/**
 * Per-call TTS voice params for a break airing at `ts` — the on-air show's
 * `voice` field, or null for the provider default. Seam for workstream B/C
 * convergence: when day-plan segments grow their own voice hints, this is the
 * single place that merges plan-segment voice over the show's.
 */
export function voiceParamsAt(ts = Date.now()) {
  return currentShow(new Date(ts)).voice || null;
}
