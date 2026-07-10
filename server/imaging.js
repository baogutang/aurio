// Station imaging — Aurio's audio identity: a synthesized sonic logo, a rotation
// of pre-authored liners (台呼), and an hourly station ID (整点台呼).
//
// Everything in this file is deterministic: the logo is rendered from raw PCM in
// pure Node, the liners are hand-written against prompts/voice-bible.zh.json,
// and the time calls come from a template. Zero LLM calls.
//
// Delivery rides the same mechanism the DJ uses for segues: patch an upcoming
// track's segueTtsUrl via queueController.patchSegueTts and mirror it to live
// clients with eventBus.emit('tts', { mode: 'append', track }). The client then
// plays the clip ducked, right before that track starts — between songs, with
// zero client changes. Two rules, enforced here: never touch a track that
// already carries a segue (the DJ's own words win), and never speak into an
// empty studio (hasActiveSession()).
import fs from 'node:fs';
import path from 'node:path';
import { config, DATA_ROOT } from './config.js';
import { db } from './store.js';
import { queueController } from './runtime/queue-controller.js';
import { eventBus } from './runtime/event-bus.js';
import { synthesizeBackground } from './tts/index.js';
import { hasActiveSession, currentIndex } from './radio.js';

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
// TODO(imaging): prepend the sonic logo to the voice server-side. The TTS
// output format varies by provider (wav at assorted sample rates, or mp3), so
// a correct concat needs decode + resample. Until then the ID ships voice-only
// and the logo stays a served asset at /imaging/sonic-logo.wav.
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

// ---------------------------------------------------------------------------
// Delivery — patch an upcoming track's segueTtsUrl, exactly like dj.js does.
// ---------------------------------------------------------------------------

function trackRef(track) {
  if (!track) return null;
  return { source: track.source, id: track.id, title: track.title, artist: track.artist };
}

function matchesRef(item, ref) {
  return (ref.source && item.source === ref.source && ref.id && item.id === ref.id)
    || (ref.title && ref.artist && item.title === ref.title && item.artist === ref.artist);
}

// First upcoming track (within the lookahead) that has no segue attached.
// Never the currently-playing one — its segue moment already passed.
function upcomingFreeTrack() {
  const { queue } = queueController.peekSnapshot();
  const idx = currentIndex();
  const start = idx >= 0 ? idx + 1 : 0;
  for (const item of queue.slice(start, start + UPCOMING_LOOKAHEAD)) {
    if (!item.segueTtsUrl) return trackRef(item);
  }
  return null;
}

// Attach the clip only if the slot is STILL free — synthesis may have taken a
// while and the DJ may have claimed the track for her own segue meanwhile.
function patchIfFree(ref, ttsUrl, kind) {
  const { queue } = queueController.peekSnapshot();
  const item = queue.find((t) => matchesRef(t, ref));
  if (!item || item.segueTtsUrl) return false;
  queueController.patchSegueTts(ref, ttsUrl);
  eventBus.emit('tts', { ts: Date.now(), kind, mode: 'append', ttsUrl, track: ref });
  return true;
}

// Synthesize through the existing TTS cache (mp3/wav lands in cache/tts/) and
// deliver when ready. Fire-and-forget; cached texts deliver immediately.
function speakOnTrack(text, ref, kind) {
  const deliver = (tts) => { if (tts?.url) patchIfFree(ref, tts.url, kind); };
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
export function deliverLiner(now = Date.now()) {
  if (!imagingEnabled()) return false;
  if (!hasActiveSession()) return false;
  const ref = upcomingFreeTrack();
  if (!ref) return false;
  const recent = db.getPref('imagingRecentLiners', []);
  const liner = pickLiner(new Date(now).getHours(), recent);
  if (!liner) return false;
  speakOnTrack(liner.text, ref, 'liner');
  db.setPref('imagingRecentLiners', [...recent, liner.id].slice(-RECENT_LINERS_KEPT));
  lastSpokeTs = now;
  return true;
}

// Interval-gated wrapper the rotation timer calls.
export function maybeLiner(now = Date.now()) {
  if (now - lastSpokeTs < linerIntervalMs()) return false;
  return deliverLiner(now);
}

// Top-of-hour station ID, called from the scheduler cron.
export function hourlyStationId(date = new Date()) {
  if (!imagingEnabled()) return false;
  if (!hasActiveSession()) return false;
  const ref = upcomingFreeTrack();
  if (!ref) return false;
  speakOnTrack(timeCallText(date.getHours()), ref, 'id');
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
