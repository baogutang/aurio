// Station imaging — Aurio's audio identity: a synthesized sonic logo, a rotation
// of pre-authored liners (台呼), and an hourly station ID (整点台呼).
//
// Everything in this file is deterministic: the logo is rendered from raw PCM in
// pure Node, the liners are hand-written against prompts/voice-bible.zh.json,
// and the time calls come from a template. Zero LLM calls.
//
// Delivery rides the programme log (P3 cutover): patch an upcoming log item's
// `voice` via station.updateItem — the playout station pushes the change to
// every client, which plays the clip ducked right as that item starts. Two
// rules, enforced here: never touch an item that already carries a voice (the
// DJ's own words win), and never speak into an empty studio
// (hasActiveSession()).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config, DATA_ROOT } from './config.js';
import { db } from './store.js';
import { station } from './playout/station.js';
import { synthesizeBackground, TTS_CACHE_DIR } from './tts/index.js';
import { hasActiveSession } from './radio.js';
import { isQuietNow } from './plan.js';
import { runFfmpeg, ffmpegBin, ffmpegAvailable, FFMPEG_RUN_TIMEOUT_MS } from './music/ffmpeg.js';

export const IMAGING_CACHE_DIR = path.join(DATA_ROOT, 'cache', 'imaging');
export const SONIC_LOGO_FILE = 'sonic-logo.wav';

const TICK_MS = 60000;            // how often the rotation checks the clock
const RECENT_LINERS_KEPT = 4;     // ids remembered to avoid quick repeats
const UPCOMING_LOOKAHEAD = 3;     // how far past the playhead we look for a free slot

// ---------------------------------------------------------------------------
// Sonic logo — three warm notes rising A4 → E5 → A5 (a fifth, then up to the
// octave), soft attack, long decay, gentle harmonics. Rendered once to
// cache/imaging/sonic-logo.wav (44.1 kHz / 16-bit / mono) and served at
// /imaging/sonic-logo.wav.
// ---------------------------------------------------------------------------

export const SAMPLE_RATE = 44100;
export const LOGO_SECONDS = 2.0;

const LOGO_NOTES = [
  { freq: 440.0, at: 0.0, gain: 0.9 },   // A4
  { freq: 659.25, at: 0.32, gain: 0.85 }, // E5 — a fifth up
  { freq: 880.0, at: 0.64, gain: 1.0 },  // A5 — the octave, rings out
];

export function renderSonicLogo(sampleRate = SAMPLE_RATE) {
  const n = Math.round(LOGO_SECONDS * sampleRate);
  const mix = new Float64Array(n);
  const attack = 0.03;  // soft attack — a struck bar, not a beep
  const tau = 0.42;     // exponential decay constant
  for (const note of LOGO_NOTES) {
    const start = Math.round(note.at * sampleRate);
    for (let i = start; i < n; i++) {
      const t = (i - start) / sampleRate;
      const env = t < attack ? t / attack : Math.exp(-(t - attack) / tau);
      const w = 2 * Math.PI * note.freq * t;
      // Fundamental + tapered 2nd/3rd harmonics: warmer than a bare sine.
      const s = Math.sin(w) + 0.35 * Math.sin(2 * w) + 0.1 * Math.sin(3 * w);
      mix[i] += note.gain * env * s;
    }
  }
  const fade = Math.round(0.12 * sampleRate); // land the tail on true zero
  for (let i = Math.max(0, n - fade); i < n; i++) mix[i] *= (n - i) / fade;
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(mix[i]));
  const scale = peak > 0 ? 0.82 / peak : 0;
  const pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) pcm[i] = Math.round(mix[i] * scale * 32767);
  return pcm;
}

export function sonicLogoWav(sampleRate = SAMPLE_RATE) {
  const pcm = renderSonicLogo(sampleRate);
  const dataSize = pcm.length * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);              // fmt chunk size
  buf.writeUInt16LE(1, 20);               // PCM
  buf.writeUInt16LE(1, 22);               // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);  // byte rate
  buf.writeUInt16LE(2, 32);               // block align
  buf.writeUInt16LE(16, 34);              // bits per sample
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < pcm.length; i++) buf.writeInt16LE(pcm[i], 44 + i * 2);
  return buf;
}

export function ensureSonicLogo() {
  const file = path.join(IMAGING_CACHE_DIR, SONIC_LOGO_FILE);
  try {
    if (!fs.existsSync(file)) {
      fs.mkdirSync(IMAGING_CACHE_DIR, { recursive: true });
      fs.writeFileSync(file, sonicLogoWav());
    }
  } catch (e) {
    console.error('[imaging] sonic logo:', e.message);
  }
  return { file, url: `/imaging/${SONIC_LOGO_FILE}` };
}

// ---------------------------------------------------------------------------
// Liners (台呼) — short, written to be HEARD, in the station's voice: dry,
// specific, one listener, no assistant tone. Callsign「Aurio」, host「Auri」.
// Dayparts: morning 5–10 · day 11–16 · evening 17–21 · late 22–4.
// ---------------------------------------------------------------------------

export const LINERS = [
  // any time
  { id: 'callsign', daypart: 'any', text: '你在听 Aurio。' },
  { id: 'stay', daypart: 'any', text: '这里是 Aurio，别走开。' },
  { id: 'host', daypart: 'any', text: '我是 Auri，这里是 Aurio。' },
  { id: 'one-person', daypart: 'any', text: 'Aurio，只播给你一个人。' },
  { id: 'more-songs', daypart: 'any', text: 'Aurio，歌比话多。' },
  { id: 'keep-going', daypart: 'any', text: 'Aurio，接着放。' },
  // morning
  { id: 'morning-wake', daypart: 'morning', text: '早，Aurio 陪你醒。' },
  { id: 'morning-start', daypart: 'morning', text: '新的一天，从 Aurio 开始。' },
  { id: 'morning-song-first', daypart: 'morning', text: 'Aurio 早间，先放歌再说。' },
  // day
  { id: 'day-busy', daypart: 'day', text: 'Aurio 在放，你忙你的。' },
  { id: 'day-afternoon', daypart: 'day', text: '下午了，Aurio 换口气。' },
  { id: 'day-company', daypart: 'day', text: 'Aurio，不打扰，只陪着。' },
  // evening
  { id: 'evening-hello', daypart: 'evening', text: '晚上好，这里是 Aurio。' },
  { id: 'evening-lamp', daypart: 'evening', text: '灯留一盏，歌交给 Aurio。' },
  { id: 'evening-slow', daypart: 'evening', text: '今晚的 Aurio，慢慢来。' },
  // late night
  { id: 'late-quiet', daypart: 'late', text: '凌晨的 Aurio，声音放轻了。' },
  { id: 'late-awake', daypart: 'late', text: '还醒着的，Aurio 陪你。' },
  { id: 'late-songs-only', daypart: 'late', text: '夜深了，Aurio 只放歌。' },
];

export function daypartOf(hour) {
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 17) return 'day';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'late';
}

// Pick a liner fitting the hour, skipping recently played ids; if the recency
// window exhausts the pool, only the immediate repeat stays forbidden.
export function pickLiner(hour, recentIds = []) {
  const part = daypartOf(hour);
  const pool = LINERS.filter((l) => l.daypart === 'any' || l.daypart === part);
  if (!pool.length) return null;
  const recent = new Set(recentIds);
  let candidates = pool.filter((l) => !recent.has(l.id));
  if (!candidates.length) {
    const lastId = recentIds[recentIds.length - 1];
    candidates = pool.filter((l) => l.id !== lastId);
  }
  if (!candidates.length) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// ---------------------------------------------------------------------------
// Hourly station ID — time call from a template.「晚上十一点整，Aurio。」
// With ffmpeg on the machine (shared front-end: server/music/ffmpeg.js) the
// aired clip is the full ID: sonic logo → a 0.3s breath → the voice, both
// decoded and resampled to one rate (TTS output varies by provider — mp3 or
// wav at assorted sample rates), re-encoded as mp3 and cached per hour keyed
// by the voice clip's identity, so a text/voice/provider change regenerates.
// Without ffmpeg the ID ships voice-only, exactly as before, and the logo
// stays a served asset at /imaging/sonic-logo.wav.
// ---------------------------------------------------------------------------

const HOUR_WORDS = ['十二', '一', '两', '三', '四', '五', '六', '七', '八', '九', '十', '十一'];

function hourWord(h12) {
  // Spoken convention: 两点, not 二点.
  return HOUR_WORDS[h12 % 12];
}

export function timeCallText(hour) {
  const h = ((hour % 24) + 24) % 24;
  if (h === 0) return '零点整，Aurio。';
  if (h === 12) return '中午十二点整，Aurio。';
  let period;
  if (h < 5) period = '凌晨';
  else if (h < 9) period = '早上';
  else if (h < 12) period = '上午';
  else if (h < 18) period = '下午';
  else period = '晚上';
  return `${period}${hourWord(h)}点整，Aurio。`;
}

export const ID_GAP_SEC = 0.3;

// The stitched ID's cache name: hour first so the 24 files read as a clock,
// then a hash of everything that shapes the audio. The voice file's own name
// already encodes provider/voice/text (tts/index.js hashFor), so keying on it
// makes a voice or provider change regenerate the clip.
export function stationIdFileName(hour, text, voiceFileName) {
  const h = String(((hour % 24) + 24) % 24).padStart(2, '0');
  const hash = crypto.createHash('sha1').update(`${text}::${voiceFileName}`).digest('hex').slice(0, 12);
  return `id-${h}-${hash}.mp3`;
}

// One ffmpeg pass: decode both inputs, resample everything to 44.1kHz mono
// s16, insert an ID_GAP_SEC breath of true silence, concat logo → gap →
// voice, encode mp3. `-f mp3` is explicit because the output lands in a .tmp
// file first (rename-on-success keeps a killed run from caching a torso).
export function concatIdArgs(logoFile, voiceFile, outFile) {
  const fmt = 'aresample=44100,aformat=sample_fmts=s16:channel_layouts=mono';
  return [
    '-hide_banner', '-nostats', '-nostdin', '-v', 'error', '-y',
    '-i', logoFile,
    '-f', 'lavfi', '-t', String(ID_GAP_SEC), '-i', 'anullsrc=r=44100:cl=mono',
    '-i', voiceFile,
    '-filter_complex',
    `[0:a]${fmt}[logo];[1:a]${fmt}[gap];[2:a]${fmt}[voice];[logo][gap][voice]concat=n=3:v=0:a=1[id]`,
    '-map', '[id]', '-codec:a', 'libmp3lame', '-q:a', '4', '-f', 'mp3',
    outFile,
  ];
}

// A cached clip is trusted only if it has bytes — a crash mid-write or a
// truncated disk leaves an empty file, which must regenerate, not air.
function usableClip(file) {
  try { return fs.statSync(file).size > 0; } catch { return false; }
}

// Map a /tts/<name> URL back to its file in the TTS cache; anything else
// (remote, traversal, unexpected shape) is not ours to read.
function ttsFileFor(url) {
  const name = typeof url === 'string' && url.startsWith('/tts/') ? url.slice('/tts/'.length) : '';
  if (!name || name.includes('/') || name.includes('\\') || name.includes('..')) return null;
  return path.join(TTS_CACHE_DIR, name);
}

/**
 * URL of the full hourly ID (logo + gap + voice) for this hour, stitching and
 * caching it on first use. Falls back to `voiceUrl` — exactly today's
 * voice-only behavior — when ffmpeg is missing, the voice clip isn't a local
 * cache file, or the stitch fails. Never throws.
 *
 * opts (test seams): exec — the ffmpeg runner, available — the probe.
 */
export async function stationIdClip(hour, text, voiceUrl, opts = {}) {
  const exec = opts.exec || runFfmpeg;
  const available = opts.available || ffmpegAvailable;
  try {
    if (!(await available({ exec }))) return voiceUrl;
    const voiceFile = ttsFileFor(voiceUrl);
    if (!voiceFile || !usableClip(voiceFile)) return voiceUrl;
    const logoFile = ensureSonicLogo().file;
    if (!usableClip(logoFile)) return voiceUrl;
    const name = stationIdFileName(hour, text, path.basename(voiceFile));
    const outFile = path.join(IMAGING_CACHE_DIR, name);
    const url = `/imaging/${name}`;
    if (usableClip(outFile)) return url;
    const tmp = `${outFile}.tmp`;
    const run = await exec(ffmpegBin(), concatIdArgs(logoFile, voiceFile, tmp), FFMPEG_RUN_TIMEOUT_MS);
    if (run?.code !== 0 || !usableClip(tmp)) {
      try { fs.unlinkSync(tmp); } catch { /* best effort */ }
      return voiceUrl;
    }
    fs.renameSync(tmp, outFile);
    return url;
  } catch (e) {
    console.error('[imaging] hourly id stitch:', e.message);
    return voiceUrl;
  }
}

// ---------------------------------------------------------------------------
// Delivery — patch an upcoming log item's voice, exactly like the DJ's segues.
// ---------------------------------------------------------------------------

// First upcoming log item (within the lookahead) with no voice attached.
// Never the on-air one — its intro moment already passed.
function upcomingFreeItem() {
  const { upNext } = station.join({ upNext: UPCOMING_LOOKAHEAD });
  for (const item of upNext) {
    if (!item.voice) return item.id;
  }
  return null;
}

// Attach the clip only if the slot is STILL free — synthesis may have taken a
// while and the DJ may have claimed the item for her own words meanwhile
// (or it may already have gone to air).
function patchIfFree(itemId, ttsUrl, text, kind) {
  const item = station.getItem(itemId);
  if (!item || item.voice || item.airStart != null) return false;
  try {
    station.updateItem(itemId, { voice: { text, ttsUrl, kind } });
  } catch {
    return false;
  }
  return true;
}

// Synthesize through the existing TTS cache (mp3/wav lands in cache/tts/) and
// deliver when ready. Fire-and-forget; cached texts deliver immediately.
function speakOnTrack(text, itemId, kind) {
  const deliver = (tts) => { if (tts?.url) patchIfFree(itemId, tts.url, text, kind); };
  const ready = synthesizeBackground(text, deliver);
  if (ready?.url) deliver(ready);
}

// The hourly-ID variant: same TTS cache, same patch path, but the clip is
// upgraded to the stitched logo+voice ID when stationIdClip can build one
// (voice-only otherwise). Still fire-and-forget, like speakOnTrack.
function speakIdOnTrack(text, itemId, hour, opts) {
  const deliver = (tts) => {
    if (!tts?.url) return;
    stationIdClip(hour, text, tts.url, opts)
      .then((url) => patchIfFree(itemId, url || tts.url, text, 'id'))
      .catch(() => patchIfFree(itemId, tts.url, text, 'id')); // belt & braces: it never throws
  };
  const ready = synthesizeBackground(text, deliver);
  if (ready?.url) deliver(ready);
}

// ---------------------------------------------------------------------------
// Rotation — one liner roughly every config.imaging.linerIntervalMin minutes
// while somebody is listening. The hourly ID counts as speech too, so a liner
// never stacks right on top of it.
// ---------------------------------------------------------------------------

let timer = null;
let lastSpokeTs = 0;

function imagingEnabled() {
  return config.imaging?.enabled !== false;
}

function linerIntervalMs() {
  const min = Number(config.imaging?.linerIntervalMin);
  return (Number.isFinite(min) && min > 0 ? min : 25) * 60000;
}

// Pick + schedule one liner now. Returns true when one was scheduled.
// Imaging is identity, not conversation — but a quiet window (server/plan.js:
// a meeting on the calendar) silences it exactly like the talk budget's mute:
// nothing of the station speaks over a meeting.
export function deliverLiner(now = Date.now()) {
  if (!imagingEnabled()) return false;
  if (!hasActiveSession()) return false;
  if (isQuietNow(now)) return false;
  const itemId = upcomingFreeItem();
  if (!itemId) return false;
  const recent = db.getPref('imagingRecentLiners', []);
  const liner = pickLiner(new Date(now).getHours(), recent);
  if (!liner) return false;
  speakOnTrack(liner.text, itemId, 'liner');
  db.setPref('imagingRecentLiners', [...recent, liner.id].slice(-RECENT_LINERS_KEPT));
  lastSpokeTs = now;
  return true;
}

// Interval-gated wrapper the rotation timer calls.
export function maybeLiner(now = Date.now()) {
  if (now - lastSpokeTs < linerIntervalMs()) return false;
  return deliverLiner(now);
}

// Top-of-hour station ID, called from the scheduler cron. `opts` threads the
// stationIdClip test seams; production callers pass nothing.
export function hourlyStationId(date = new Date(), opts = undefined) {
  if (!imagingEnabled()) return false;
  if (!hasActiveSession()) return false;
  if (isQuietNow(date.getTime())) return false; // 整点撞上会议：这个整点不报
  const itemId = upcomingFreeItem();
  if (!itemId) return false;
  speakIdOnTrack(timeCallText(date.getHours()), itemId, date.getHours(), opts);
  lastSpokeTs = date.getTime();
  return true;
}

export function startImaging() {
  if (timer) return;
  ensureSonicLogo();
  lastSpokeTs = Date.now(); // first liner comes one full interval in, not at boot
  timer = setInterval(() => {
    try { maybeLiner(); } catch (e) { console.error('[imaging] liner:', e.message); }
  }, TICK_MS);
  if (timer.unref) timer.unref();
  console.log('[imaging] station imaging started');
}

export function stopImaging() {
  if (timer) clearInterval(timer);
  timer = null;
}
