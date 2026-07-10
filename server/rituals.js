// Rituals — deterministic facts for ceremonial segments (RADIO_VISION §四/§六).
// Same philosophy as server/agent/detectors.js — code computes the fact, the
// host only decides how to read it out. Two kinds live here:
//   · clock-pulled rituals (the Friday recap) — arithmetic over db.state.plays;
//   · the first-run 开台仪式 — a cheap library scan for the once-per-data-dir
//     opening ceremony (no full scanner: source liveness + one recommend()).
//
// No LLM calls in this file. The DJ machinery voices everything.
import { db } from './store.js';
import { config } from './config.js';
import { sourceServices, recommend, candidatesToText, netease } from './music/index.js';

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

// ---------------------------------------------------------------------------
// 开台仪式 (RADIO_VISION §六, RADIO_AUDIT 冷启动) — the first five minutes are a
// performance, not a settings tour. Code scans what is actually reachable and
// hands the DJ one honest fact; the persona machinery does the rest.
// ---------------------------------------------------------------------------

const SAMPLE_TIMEOUT_MS = 8000;

// Resolve `promise` or fall back after `ms` — the ceremony must never hang on a
// slow music adapter. The timer is unref'd so it can't pin the process.
function withTimeout(promise, ms, fallback) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    if (typeof timer.unref === 'function') timer.unref();
    Promise.resolve(promise).then(
      (v) => { clearTimeout(timer); resolve(v); },
      () => { clearTimeout(timer); resolve(fallback); },
    );
  });
}

// One cheap listing from the music layer — recommend() already fans out to
// whatever is live (navidrome random / netease daily / qq charts). NOT a
// library scanner.
async function fetchFirstRunSample(count = 6) {
  try {
    return (await recommend(count)) || [];
  } catch {
    return [];
  }
}

function sampleLine(t) {
  if (!t?.title) return '';
  const year = t.year ? `（${t.year}）` : '';
  return `随手翻到：${t.artist || ''}《${t.title}》${year}`;
}

// The library-scan fact for the opening ceremony. Deterministic given its
// inputs; every input is injectable so tests can run source permutations
// without a network. Returns:
//   fact          — the Chinese fact string for trigger.fact
//   hasSource     — whether the ceremony can honestly play music
//   connected     — a user-established source exists (NAS / logins)
//   sample        — the one track we "随手翻到" (or null)
//   candidatesText — prompt-ready real tracks for trigger.toolResults ('' if none)
export async function firstRunFact({
  services = sourceServices(),
  neteaseLoggedIn = netease.loggedIn(),
  qqLoggedIn = !!config.qq.cookie,
  candidates = null,
  timeoutMs = SAMPLE_TIMEOUT_MS,
} = {}) {
  const tracks = candidates ?? await withTimeout(fetchFirstRunSample(), timeoutMs, []);
  const sample = tracks[0] || null;
  const connected = !!(services.navidrome || neteaseLoggedIn || qqLoggedIn);
  const hasSource = connected || !!sample;

  const lines = ['首次开台：这是这台电台第一次为这位听众开播。'];
  if (connected) {
    const parts = [];
    if (services.navidrome) parts.push('NAS 曲库已连接');
    parts.push(neteaseLoggedIn ? '网易云已登录' : '网易云未登录（内置搜索可用）');
    parts.push(qqLoggedIn ? 'QQ 音乐已登录' : 'QQ 音乐未登录（内置接口可用）');
    lines.push(`曲库连通：${parts.join('；')}。`);
  } else {
    lines.push('曲库还没连上：网易云未登录，QQ 音乐没有登录凭证，也没有配置 NAS 曲库。');
  }
  const s = sampleLine(sample);
  if (s) lines.push(`${s}。`);

  return {
    fact: lines.join(''),
    hasSource,
    connected,
    sample,
    candidatesText: tracks.length ? candidatesToText(tracks) : '',
  };
}

export const FIRST_RUN_PREF = 'firstRunPerformedAt';

// The quiet ceremony when nothing can play — a fixed degraded line (same
// convention as dj.js's brain-down fallbacks), not a persona script. The real
// ceremony's voice always comes from the DJ machinery.
export const FIRST_RUN_QUIET_SAY = '先陪你安静待一会儿，连上曲库我们就开始。';

export function firstRunPerformed() {
  return !!db.getPref(FIRST_RUN_PREF, null);
}

// Perform the opening ceremony at most once per data dir. `runSegment` is
// injected (server/index.js passes the real dj.js one) so this stays testable
// and rituals.js never imports the orchestrator. The guard commits only when
// the first song actually reached the queue — a failed or empty segment keeps
// the ceremony available for a retry.
export async function performFirstRun({ runSegment, currentIndex = -1, deps } = {}) {
  if (firstRunPerformed()) {
    return { ok: true, alreadyPerformed: true, kind: 'first-run', queue: [] };
  }
  const scan = await firstRunFact(deps);
  if (!scan.hasSource) {
    // Nothing playable: no segment, no LLM spend, guard stays unset so a later
    // attempt (after a library is connected) still gets the real ceremony.
    return {
      ok: true, kind: 'first-run', mode: 'chat', quiet: true,
      say: FIRST_RUN_QUIET_SAY, queue: [], ts: Date.now(),
    };
  }
  const trigger = { kind: 'first-run', fact: scan.fact };
  if (scan.candidatesText) trigger.toolResults = scan.candidatesText;
  const result = await runSegment(trigger, { mode: 'replace', currentIndex });
  if (result && !result.error && result.queue?.length) {
    db.setPref(FIRST_RUN_PREF, Date.now());
  }
  return result;
}
