// Per-track cue-point & loudness analysis — the DSP ground truth the playout
// timeline schedules real segues from (docs/RADIO_AUDIT.md 「收尾与灵魂」).
//
// ffmpeg (`silencedetect` + `ebur128`) runs ONLY on the head 40s and tail 40s
// of a track — never the whole file — and the result is cached permanently in
// cache/cues.json. Everything degrades gracefully: no ffmpeg on the machine,
// a dead stream, a timeout — callers always get an honest record with null
// fields, never an error.
//
// The cue record (v1):
//   {
//     v: 1, source, id, durationSec,
//     cueIn,       // sec — first non-silence in the head (0 if it starts hot, cap 15)
//     cueOut,      // sec — last audible moment (trailing-silence start, or EOF)
//     endType,     // 'cold' (stops abruptly → hard cut, NEVER crossfade) | 'fade'
//     seguePoint,  // sec — when the next item should start: cueOut for cold,
//                  //       cueOut − 2 for fade (the ≈2s equal-power crossfade)
//     introSec,    // vocal-entry estimate from the first sane LRC timestamp
//     lufs,        // integrated LUFS over the head+tail sample
//     gainDb,      // −16 − lufs, clamped to ±12 — normalize to −16 LUFS
//     ffmpeg,      // whether ffmpeg was present when this was analyzed
//     analyzedAt,
//   }
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DATA_ROOT } from '../config.js';
import { parseLrc } from './lrc.js';
import { isCreditLine, isBracketHeader } from './lyrics-hooks.js';
import { lyricsFor } from './index.js';

export const CUE_SCHEMA_VERSION = 1;
export const CUE_CACHE_FILE = path.join(DATA_ROOT, 'cache', 'cues.json');

const HEAD_WINDOW_SEC = 40;   // audit: never analyze the whole file
const TAIL_WINDOW_SEC = 40;
const SILENCE_NOISE = '-45dB'; // radio-floor threshold; vinyl hiss stays "sound"
const SILENCE_MIN_SEC = 0.5;
const CUE_IN_CAP_SEC = 15;    // longer "leading silence" is probably an intro pad we misread
const COLD_GAP_SEC = 1.0;     // trailing silence shorter than this = the song just stops
const SEGUE_OVERLAP_SEC = 2;  // audit: equal-power crossfade ≈ 2s
const INTRO_MIN_SEC = 1;      // ≤1s首行时间戳通常是 00:00 的头部/标题行
const INTRO_MAX_SEC = 60;     // 更晚的"首行"多半是整段前奏被打轴器吞了
const RUN_TIMEOUT_MS = 10000;
const VERSION_TIMEOUT_MS = 5000;
const LYRICS_TIMEOUT_MS = 5000;

const round2 = (v) => Math.round(v * 100) / 100;
const round1 = (v) => Math.round(v * 10) / 10;
// ffmpeg prints C-locale '.' decimals, but parse ',' too so a patched/localized
// build can't silently give us NaN.
const num = (s) => Number(String(s).replace(',', '.'));

// --- ffmpeg runner (the test seam) -----------------------------------------

// Spawn `bin args…`, capture stderr (where ffmpeg logs everything), resolve
// { code, stderr }. Kills the child and rejects on timeout — an ffmpeg stuck
// on a dead stream must never wedge the analysis queue.
export function runFfmpeg(bin, args, timeoutMs = RUN_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(bin, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (e) { reject(e); return; }
    let stderr = '';
    let done = false;
    const killer = setTimeout(() => {
      if (done) return;
      done = true;
      try { child.kill('SIGKILL'); } catch { /* noop */ }
      reject(new Error(`${bin} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stderr.on('data', (d) => {
      stderr += d.toString();
      // silencedetect+summary is tiny; bound memory anyway on pathological logs
      if (stderr.length > 512 * 1024) stderr = stderr.slice(-256 * 1024);
    });
    child.on('error', (e) => {
      if (done) return;
      done = true;
      clearTimeout(killer);
      reject(e);
    });
    child.on('close', (code) => {
      if (done) return;
      done = true;
      clearTimeout(killer);
      resolve({ code, stderr });
    });
  });
}

export function ffmpegBin() {
  return process.env.AURIO_FFMPEG || 'ffmpeg';
}

// Feature detection, cached per process: most users won't have ffmpeg, and the
// answer doesn't change under us. `AURIO_FFMPEG` overrides the PATH lookup.
let ffmpegCheck = null;
export function ffmpegAvailable({ exec = runFfmpeg } = {}) {
  if (!ffmpegCheck) {
    ffmpegCheck = Promise.resolve()
      .then(() => exec(ffmpegBin(), ['-version'], VERSION_TIMEOUT_MS))
      .then((r) => r?.code === 0)
      .catch(() => false);
  }
  return ffmpegCheck;
}

// --- stderr parsing ---------------------------------------------------------

// silencedetect writes (values can be bare integers, e.g. "silence_start: 0"):
//   [silencedetect @ 0x…] silence_start: 29.551723
//   [silencedetect @ 0x…] silence_end: 40 | silence_duration: 10.448277
// A silence still open at EOF has no silence_end on older ffmpeg; newer builds
// flush a final silence_end at the stream end. → [{ start, end|null }]
export function parseSilence(stderr = '') {
  const events = [];
  const re = /silence_(start|end):\s*([-+]?\d+(?:[.,]\d+)?)/g;
  let open = null;
  let m;
  while ((m = re.exec(stderr))) {
    const t = num(m[2]);
    if (!Number.isFinite(t)) continue;
    if (m[1] === 'start') {
      open = { start: Math.max(0, t), end: null }; // tiny negatives = codec padding
      events.push(open);
    } else if (open) {
      open.end = Math.max(open.start, t);
      open = null;
    }
  }
  return events;
}

// ebur128's end-of-stream summary block:
//     Integrated loudness:
//       I:         -22.2 LUFS
// Anchored on the "Integrated loudness:" header so the per-frame progress
// lines ("t: 1.0 … I: -19.1 LUFS …") can never be mistaken for the verdict.
// −70 LUFS is the gating floor — i.e. "no measurable signal" — not a reading.
export function parseIntegratedLufs(stderr = '') {
  const m = /Integrated loudness:\s*\r?\n\s*I:\s*([-+]?\d+(?:[.,]\d+)?)\s*LUFS/.exec(stderr);
  if (!m) return null;
  const v = num(m[1]);
  if (!Number.isFinite(v) || v <= -69.9) return null;
  return v;
}

// "Duration: 00:02:00.00, start: …" from the input header — the fallback when
// the caller didn't pass durationSec (tail math needs an absolute end).
export function parseDurationSec(stderr = '') {
  const m = /\bDuration:\s*(\d+):(\d{1,2}):(\d{1,2}(?:[.,]\d+)?)/.exec(stderr);
  if (!m) return null;
  const sec = Number(m[1]) * 3600 + Number(m[2]) * 60 + num(m[3]);
  return Number.isFinite(sec) && sec > 0 ? round2(sec) : null;
}

// --- cue math ---------------------------------------------------------------

// Head window → cueIn: if the file opens with silence, cue in where it ends;
// otherwise the track starts hot at 0. Clamped ≥0, capped at 15s.
export function headCueIn(events = []) {
  const lead = events.find((e) => e.start <= 0.5);
  if (!lead) return 0;
  if (lead.end == null) return CUE_IN_CAP_SEC; // silent through the whole window
  return round2(Math.min(CUE_IN_CAP_SEC, Math.max(0, lead.end)));
}

// Tail window → cueOut / endType / seguePoint. `events` are RELATIVE to the
// -sseof seek point (verified against ffmpeg 8.x); windowStart shifts them to
// absolute track time. Classification per the audit:
//   - no trailing silence, or trailing silence starting <1s before EOF
//     → the song stops abruptly: 'cold', hard cut at cueOut, never crossfade
//   - a longer trailing silence → the level died earlier: 'fade', segue pulled
//     in so the next item starts ≈2s before the level dies
export function tailCues(events = [], durationSec) {
  const dur = Number(durationSec);
  if (!Number.isFinite(dur) || dur <= 0) {
    return { cueOut: null, endType: null, seguePoint: null };
  }
  const windowStart = Math.max(0, dur - TAIL_WINDOW_SEC);
  const eps = 0.7; // mp3 padding / timestamp jitter at EOF
  const last = events[events.length - 1];
  const trailing = last && (last.end == null || windowStart + last.end >= dur - eps)
    ? { start: Math.min(windowStart + last.start, dur) }
    : null;
  if (!trailing) {
    // audible right up to EOF
    return { cueOut: round2(dur), endType: 'cold', seguePoint: round2(dur) };
  }
  const ts = trailing.start;
  if (dur - ts < COLD_GAP_SEC) {
    return { cueOut: round2(ts), endType: 'cold', seguePoint: round2(ts) };
  }
  return {
    cueOut: round2(ts),
    endType: 'fade',
    seguePoint: round2(Math.max(0, ts - SEGUE_OVERLAP_SEC)),
  };
}

// LUFS of two windows → one number. Averaged in the energy domain (mean of
// 10^(L/10)) — averaging dB directly would under-weight the louder window.
export function combineLufs(head, tail) {
  const vals = [head, tail].filter((v) => Number.isFinite(v));
  if (!vals.length) return null;
  if (vals.length === 1) return round1(vals[0]);
  const energy = vals.reduce((sum, v) => sum + 10 ** (v / 10), 0) / vals.length;
  return round1(10 * Math.log10(energy));
}

// Normalize to −16 LUFS. Clamped to ±12 dB — beyond that the measurement is
// more likely wrong than the master is quiet.
export function gainFor(lufs) {
  if (!Number.isFinite(lufs)) return null;
  return round1(Math.min(12, Math.max(-12, -16 - lufs)));
}

// First sane LRC timestamp = a free vocal-entry estimate. Sanity rules from
// the audit ("经常撞上标题行"): skip credit/title lines entirely, then reject a
// first-line timestamp ≤1s (a header parked at 00:00) or >60s (the timing is
// probably garbage). One verdict per track — no scanning deeper for a number
// we'd like better.
export function introFromLrc(raw) {
  const lines = parseLrc(raw);
  for (const line of lines) {
    const text = (line.text || '').trim();
    if (!text || isCreditLine(text) || isBracketHeader(text)) continue;
    if (line.time <= INTRO_MIN_SEC || line.time > INTRO_MAX_SEC) return null;
    return round2(line.time);
  }
  return null;
}

async function introSecFor(track, fetcher, timeoutMs) {
  try {
    let timer;
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); });
    const raw = await Promise.race([Promise.resolve().then(() => fetcher(track)), timeout]);
    clearTimeout(timer);
    return introFromLrc(typeof raw === 'string' ? raw : '');
  } catch {
    return null;
  }
}

// --- analysis ---------------------------------------------------------------

function emptyRecord(track = {}) {
  return {
    v: CUE_SCHEMA_VERSION,
    source: track.source || '',
    id: track.id != null ? String(track.id) : '',
    durationSec: Number.isFinite(Number(track.durationSec)) && Number(track.durationSec) > 0
      ? round2(Number(track.durationSec)) : null,
    cueIn: null,
    cueOut: null,
    endType: null,
    seguePoint: null,
    introSec: null,
    lufs: null,
    gainDb: null,
    ffmpeg: false,
    analyzedAt: new Date().toISOString(),
  };
}

const FILTERGRAPH = `silencedetect=noise=${SILENCE_NOISE}:d=${SILENCE_MIN_SEC},ebur128=framelog=quiet`;

/**
 * Analyze one track → cue record. Two bounded ffmpeg passes (head 40s via
 * `-t 40`, tail 40s via `-sseof -40`) against the stream URL — in analysis
 * context any http(s)/file input is fine; playback URLs are same-origin
 * proxies served by this very server. Never throws; every failure just leaves
 * its fields null.
 *
 * opts (test seams): exec — the runner, lyrics — the LRC fetcher, timeoutMs.
 */
export async function analyzeTrack(track = {}, opts = {}) {
  const exec = opts.exec || runFfmpeg;
  const lyrics = opts.lyrics || lyricsFor;
  const timeoutMs = opts.timeoutMs ?? RUN_TIMEOUT_MS;
  const record = emptyRecord(track);

  // introSec comes from lyrics we already fetch elsewhere — free, and
  // independent of whether ffmpeg exists.
  record.introSec = await introSecFor(track, lyrics, opts.lyricsTimeoutMs ?? LYRICS_TIMEOUT_MS);

  record.ffmpeg = await ffmpegAvailable({ exec });
  if (!record.ffmpeg || !track.streamUrl) return record;

  const bin = ffmpegBin();
  const url = String(track.streamUrl);
  const head = [
    '-hide_banner', '-nostats', '-nostdin', '-v', 'info',
    '-t', String(HEAD_WINDOW_SEC), '-i', url,
    '-map', 'a:0', '-af', FILTERGRAPH, '-f', 'null', '-',
  ];
  const tail = [
    '-hide_banner', '-nostats', '-nostdin', '-v', 'info',
    '-sseof', `-${TAIL_WINDOW_SEC}`, '-i', url,
    '-map', 'a:0', '-af', FILTERGRAPH, '-f', 'null', '-',
  ];
  const [headRun, tailRun] = await Promise.allSettled([
    exec(bin, head, timeoutMs),
    exec(bin, tail, timeoutMs),
  ]);
  const headOk = headRun.status === 'fulfilled' && headRun.value?.code === 0;
  const tailOk = tailRun.status === 'fulfilled' && tailRun.value?.code === 0;
  const headErr = headRun.status === 'fulfilled' ? String(headRun.value?.stderr || '') : '';
  const tailErr = tailRun.status === 'fulfilled' ? String(tailRun.value?.stderr || '') : '';

  // Even a failed run usually printed the input header — use it for duration.
  const dur = record.durationSec ?? parseDurationSec(headErr) ?? parseDurationSec(tailErr);
  if (dur) record.durationSec = dur;

  if (headOk) record.cueIn = headCueIn(parseSilence(headErr));
  if (tailOk) Object.assign(record, tailCues(parseSilence(tailErr), dur));
  record.lufs = combineLufs(
    headOk ? parseIntegratedLufs(headErr) : null,
    tailOk ? parseIntegratedLufs(tailErr) : null,
  );
  record.gainDb = gainFor(record.lufs);
  return record;
}

// --- permanent cache ---------------------------------------------------------

// cache/cues.json: { v: 1, cues: { "source:id": record } }. Versioned so a
// future algorithm change bumps CUE_SCHEMA_VERSION and the whole file simply
// reads as empty — every track re-analyzes once, no migration code.
let cueStore = null;            // loaded file, lazy
const memory = new Map();       // key → record for outcomes we DON'T persist
const pending = new Map();      // key → in-flight Promise<record>

export function cueKey(track = {}) {
  if (!track.source || track.id == null || track.id === '') return '';
  return `${track.source}:${track.id}`;
}

function loadStore() {
  if (cueStore) return cueStore;
  try {
    const raw = JSON.parse(fs.readFileSync(CUE_CACHE_FILE, 'utf8'));
    cueStore = raw && raw.v === CUE_SCHEMA_VERSION && raw.cues && typeof raw.cues === 'object'
      ? { v: CUE_SCHEMA_VERSION, cues: raw.cues }
      : { v: CUE_SCHEMA_VERSION, cues: {} };
  } catch {
    cueStore = { v: CUE_SCHEMA_VERSION, cues: {} };
  }
  return cueStore;
}

function saveStore() {
  try {
    const dir = path.dirname(CUE_CACHE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = `${CUE_CACHE_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(loadStore()));
    fs.renameSync(tmp, CUE_CACHE_FILE); // atomic-ish: no torn cues.json
  } catch (e) {
    console.error('[cue] cache save:', e.message);
  }
}

// A record earns permanent storage only when ffmpeg actually measured
// something — a no-ffmpeg machine or a fully failed run (dead stream, double
// timeout) is remembered in-process but retried after a restart.
function persistable(record) {
  return !!record.ffmpeg
    && (record.cueIn != null || record.cueOut != null || record.lufs != null);
}

/** Sync, cache-only read. Returns the cue record if known, else null. */
export function cachedCue(track) {
  const key = cueKey(track);
  if (!key) return null;
  return loadStore().cues[key] || memory.get(key) || null;
}

/**
 * Cue record for a track, analyzing at most once. Concurrent calls for the
 * same track coalesce onto one in-flight analysis. Never throws.
 */
export function ensureCue(track, opts = {}) {
  const key = cueKey(track);
  if (!key) return analyzeTrack(track, opts); // un-keyable → analyze, never cache
  const hit = cachedCue(track);
  if (hit) return Promise.resolve(hit);
  let p = pending.get(key);
  if (p) return p;
  p = analyzeTrack(track, opts)
    .catch(() => emptyRecord(track)) // belt & braces: analyzeTrack never throws
    .then((record) => {
      if (persistable(record)) {
        loadStore().cues[key] = record;
        saveStore();
      } else {
        memory.set(key, record);
      }
      pending.delete(key);
      return record;
    });
  pending.set(key, p);
  return p;
}

/** Test helper: forget the ffmpeg probe, the loaded cache, and in-flight work. */
export function resetCueState() {
  ffmpegCheck = null;
  cueStore = null;
  memory.clear();
  pending.clear();
}
