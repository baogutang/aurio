import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolate cache/cues.json into a temp dir. Import happens in beforeAll, AFTER
// the env var is set, so config.js picks up the temp DATA_ROOT (same pattern
// as detectors.test.js).
let tmpDir;
let cue;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurio-cue-'));
  process.env.AURIO_DATA_DIR = tmpDir;
  cue = await import('../server/music/cue.js');
});

afterAll(() => {
  delete process.env.AURIO_DATA_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  cue.resetCueState();
  fs.rmSync(cue.CUE_CACHE_FILE, { force: true });
});

// ---------------------------------------------------------------------------
// Fixtures: real ffmpeg 8.1.2 stderr, captured from
//   ffmpeg -hide_banner -nostats -nostdin -t 40 -i <file> -map a:0 \
//     -af "silencedetect=noise=-45dB:d=0.5,ebur128=framelog=quiet" -f null -
// against a 120s synthesized tone (2.5s leading silence, fade 100→110s, then
// silence to EOF) and a 90s cold-ending tone. Formats reproduced verbatim.
// ---------------------------------------------------------------------------

// Head 40s of the fade file: leading silence 0→2.5s, then tone.
const HEAD_FADE = `Input #0, mp3, from 'fade-end.mp3':
  Metadata:
    encoder         : Lavf62.12.102
  Duration: 00:02:00.00, start: 0.025057, bitrate: 64 kb/s
  Stream #0:0: Audio: mp3 (mp3float), 44100 Hz, mono, fltp, 64 kb/s, start 0.025057
Stream mapping:
  Stream #0:0 -> #0:0 (mp3 (mp3float) -> pcm_s16le (native))
Output #0, null, to 'pipe:':
  Metadata:
    encoder         : Lavf62.12.102
  Stream #0:0: Audio: pcm_s16le, 44100 Hz, mono, s16, 705 kb/s
    Metadata:
      encoder         : Lavc62.28.102 pcm_s16le
[Parsed_silencedetect_0 @ 0x14ad04ce0] silence_start: 0
[Parsed_silencedetect_0 @ 0x14ad04ce0] silence_end: 2.50771 | silence_duration: 2.50771
[Parsed_ebur128_1 @ 0x14ad04e30] Summary:

  Integrated loudness:
    I:         -22.2 LUFS
    Threshold: -32.2 LUFS

  Loudness range:
    LRA:         0.0 LU
    Threshold: -42.3 LUFS
    LRA low:   -22.2 LUFS
    LRA high:  -22.2 LUFS
[out#0/null @ 0x14ac04bd0] video:0KiB audio:3445KiB subtitle:0KiB other streams:0KiB global headers:0KiB muxing overhead: unknown
size=N/A time=00:00:40.00 bitrate=N/A speed=1.4e+03x elapsed=0:00:00.02`;

// Tail 40s (-sseof -40 → window starts at 80s) of the fade file: the fade dips
// below −45dB at ≈109.55s absolute = 29.55s RELATIVE to the seek point, and
// this ffmpeg flushes a final silence_end at the stream end (40 relative).
const TAIL_FADE = `Input #0, mp3, from 'fade-end.mp3':
  Metadata:
    encoder         : Lavf62.12.102
  Duration: 00:02:00.00, start: 0.025057, bitrate: 64 kb/s
  Stream #0:0: Audio: mp3 (mp3float), 44100 Hz, mono, fltp, 64 kb/s, start 0.025057
Stream mapping:
  Stream #0:0 -> #0:0 (mp3 (mp3float) -> pcm_s16le (native))
Output #0, null, to 'pipe:':
  Metadata:
    encoder         : Lavf62.12.102
  Stream #0:0: Audio: pcm_s16le, 44100 Hz, mono, s16, 705 kb/s
    Metadata:
      encoder         : Lavc62.28.102 pcm_s16le
[Parsed_silencedetect_0 @ 0x101306920] silence_start: 29.551723
[Parsed_silencedetect_0 @ 0x101306920] silence_end: 40 | silence_duration: 10.448277
[Parsed_ebur128_1 @ 0x101306ad0] Summary:

  Integrated loudness:
    I:         -22.9 LUFS
    Threshold: -33.3 LUFS

  Loudness range:
    LRA:         9.8 LU
    Threshold: -43.5 LUFS
    LRA low:   -32.0 LUFS
    LRA high:  -22.2 LUFS
[out#0/null @ 0x11e613eb0] video:0KiB audio:3445KiB subtitle:0KiB other streams:0KiB global headers:0KiB muxing overhead: unknown
size=N/A time=00:00:40.00 bitrate=N/A speed=1.63e+03x elapsed=0:00:00.02`;

// Tail 40s of the 90s cold-ending tone: audible right up to EOF — zero
// silencedetect lines, only the loudness summary.
const TAIL_COLD = `Input #0, mp3, from 'cold-end.mp3':
  Metadata:
    encoder         : Lavf62.12.102
  Duration: 00:01:30.00, start: 0.025057, bitrate: 64 kb/s
  Stream #0:0: Audio: mp3 (mp3float), 44100 Hz, mono, fltp, 64 kb/s, start 0.025057
Stream mapping:
  Stream #0:0 -> #0:0 (mp3 (mp3float) -> pcm_s16le (native))
Output #0, null, to 'pipe:':
  Metadata:
    encoder         : Lavf62.12.102
  Stream #0:0: Audio: pcm_s16le, 44100 Hz, mono, s16, 705 kb/s
    Metadata:
      encoder         : Lavc62.28.102 pcm_s16le
[Parsed_ebur128_1 @ 0x127f06e60] Summary:

  Integrated loudness:
    I:         -22.2 LUFS
    Threshold: -32.2 LUFS

  Loudness range:
    LRA:         0.0 LU
    Threshold: -42.2 LUFS
    LRA low:   -22.2 LUFS
    LRA high:  -22.2 LUFS
[out#0/null @ 0x117e043c0] video:0KiB audio:3445KiB subtitle:0KiB other streams:0KiB global headers:0KiB muxing overhead: unknown
size=N/A time=00:00:40.00 bitrate=N/A speed=1.58e+03x elapsed=0:00:00.02`;

// Without framelog=quiet, ebur128 logs a progress line per 100ms that ALSO
// contains "I: … LUFS" (captured verbatim) — the parser must not read those.
const EBUR_FRAMELOG_ONLY = `[Parsed_ebur128_1 @ 0x151e057f0] t: 2.599977   TARGET:-23 LUFS    M: -28.6 S:-120.7     I: -28.6 LUFS       LRA:   0.0 LU
[Parsed_ebur128_1 @ 0x151e057f0] t: 2.699977   TARGET:-23 LUFS    M: -25.4 S:-120.7     I: -26.7 LUFS       LRA:   0.0 LU`;

const VERSION_OUT = { code: 0, stderr: 'ffmpeg version 8.1.2 Copyright (c) 2000-2026 the FFmpeg developers\n' };

// Fake runner: routes on the args ffmpeg would receive. `calls` records every
// invocation so tests can assert coalescing / caching skipped re-runs.
function fakeExec({ head = HEAD_FADE, tail = TAIL_FADE, version = VERSION_OUT } = {}) {
  const calls = [];
  const exec = async (bin, args) => {
    calls.push(args);
    if (args.includes('-version')) {
      if (version instanceof Error) throw version;
      return version;
    }
    const out = args.includes('-sseof') ? tail : head;
    if (out instanceof Error) throw out;
    return { code: 0, stderr: out };
  };
  exec.calls = calls;
  return exec;
}

const noLyrics = async () => '';

// ---------------------------------------------------------------------------

describe('parseSilence', () => {
  it('pairs silence_start/silence_end from a real transcript (bare-integer values included)', () => {
    expect(cue.parseSilence(HEAD_FADE)).toEqual([{ start: 0, end: 2.50771 }]);
    expect(cue.parseSilence(TAIL_FADE)).toEqual([{ start: 29.551723, end: 40 }]);
  });

  it('returns [] when the transcript has no silencedetect lines', () => {
    expect(cue.parseSilence(TAIL_COLD)).toEqual([]);
  });

  it('leaves a silence still open at EOF with end null (older ffmpeg does not flush it)', () => {
    const stderr = '[Parsed_silencedetect_0 @ 0x1] silence_start: 29.551723\n';
    expect(cue.parseSilence(stderr)).toEqual([{ start: 29.551723, end: null }]);
  });

  it('clamps the tiny negative silence_start codecs report at file start', () => {
    const stderr = '[Parsed_silencedetect_0 @ 0x1] silence_start: -0.00443311\n'
      + '[Parsed_silencedetect_0 @ 0x1] silence_end: 1.5 | silence_duration: 1.504433\n';
    expect(cue.parseSilence(stderr)).toEqual([{ start: 0, end: 1.5 }]);
  });

  it('parses comma decimals from a localized build', () => {
    const stderr = '[Parsed_silencedetect_0 @ 0x1] silence_start: 0\n'
      + '[Parsed_silencedetect_0 @ 0x1] silence_end: 2,50771 | silence_duration: 2,50771\n';
    expect(cue.parseSilence(stderr)).toEqual([{ start: 0, end: 2.50771 }]);
  });
});

describe('parseIntegratedLufs', () => {
  it('reads I: from the summary block of a real transcript', () => {
    expect(cue.parseIntegratedLufs(HEAD_FADE)).toBe(-22.2);
    expect(cue.parseIntegratedLufs(TAIL_FADE)).toBe(-22.9);
  });

  it('never mistakes per-frame progress lines for the verdict', () => {
    expect(cue.parseIntegratedLufs(EBUR_FRAMELOG_ONLY)).toBe(null);
    // …and with both present, only the summary wins
    expect(cue.parseIntegratedLufs(`${EBUR_FRAMELOG_ONLY}\n${HEAD_FADE}`)).toBe(-22.2);
  });

  it('treats the −70 gating floor (no measurable signal) as null', () => {
    const stderr = '  Integrated loudness:\n    I:         -70.0 LUFS\n    Threshold: -80.0 LUFS\n';
    expect(cue.parseIntegratedLufs(stderr)).toBe(null);
  });

  it('returns null when there is no summary at all', () => {
    expect(cue.parseIntegratedLufs('')).toBe(null);
  });
});

describe('parseDurationSec', () => {
  it('reads the input header Duration', () => {
    expect(cue.parseDurationSec(HEAD_FADE)).toBe(120);
    expect(cue.parseDurationSec(TAIL_COLD)).toBe(90);
  });

  it('returns null for N/A or missing duration', () => {
    expect(cue.parseDurationSec('  Duration: N/A, bitrate: 64 kb/s\n')).toBe(null);
    expect(cue.parseDurationSec('')).toBe(null);
  });
});

describe('headCueIn', () => {
  it('cues in where leading silence ends', () => {
    expect(cue.headCueIn(cue.parseSilence(HEAD_FADE))).toBe(2.51);
  });

  it('is 0 when the track starts hot', () => {
    expect(cue.headCueIn([])).toBe(0);
  });

  it('ignores silence that is not at the head (a mid-intro break)', () => {
    expect(cue.headCueIn([{ start: 5.2, end: 6.9 }])).toBe(0);
  });

  it('caps absurd leading silence at 15s', () => {
    expect(cue.headCueIn([{ start: 0, end: 22.4 }])).toBe(15);
    expect(cue.headCueIn([{ start: 0, end: null }])).toBe(15); // silent whole window
  });
});

describe('tailCues', () => {
  it('classifies a long trailing fade and pulls the segue to where the level dies', () => {
    // relative events from the real tail transcript, window = [80s, 120s]
    const out = cue.tailCues(cue.parseSilence(TAIL_FADE), 120);
    expect(out.endType).toBe('fade');
    expect(out.cueOut).toBeCloseTo(109.55, 1);
    expect(out.seguePoint).toBeCloseTo(107.55, 1); // cueOut − 2s crossfade
  });

  it('no trailing silence at all → cold ender, hard cut at EOF', () => {
    expect(cue.tailCues(cue.parseSilence(TAIL_COLD), 90))
      .toEqual({ cueOut: 90, endType: 'cold', seguePoint: 90 });
  });

  it('trailing silence starting <1s before EOF → still a cold ender', () => {
    // 90s track, window starts at 50: silence 39.6→40 relative = 89.6→90 abs
    const out = cue.tailCues([{ start: 39.6, end: 40 }], 90);
    expect(out).toEqual({ cueOut: 89.6, endType: 'cold', seguePoint: 89.6 });
  });

  it('a mid-window silence with audio resuming to EOF is not a trailing silence', () => {
    // silence 20→25 relative = 100→105 abs, then audio to 120 → cold at EOF
    const out = cue.tailCues([{ start: 20, end: 25 }], 120);
    expect(out).toEqual({ cueOut: 120, endType: 'cold', seguePoint: 120 });
  });

  it('a trailing silence left open at EOF (older ffmpeg) still classifies as fade', () => {
    const out = cue.tailCues([{ start: 29.55, end: null }], 120);
    expect(out.endType).toBe('fade');
    expect(out.cueOut).toBeCloseTo(109.55, 1);
  });

  it('is honest (all null) when the duration is unknown', () => {
    expect(cue.tailCues(cue.parseSilence(TAIL_FADE), null))
      .toEqual({ cueOut: null, endType: null, seguePoint: null });
  });
});

describe('gainFor / combineLufs', () => {
  it('targets −16 LUFS', () => {
    expect(cue.gainFor(-22.9)).toBe(6.9);
    expect(cue.gainFor(-16)).toBe(0);
  });

  it('clamps to ±12 dB', () => {
    expect(cue.gainFor(-35)).toBe(12);
    expect(cue.gainFor(-1)).toBe(-12);
  });

  it('null in, null out', () => {
    expect(cue.gainFor(null)).toBe(null);
    expect(cue.gainFor(NaN)).toBe(null);
  });

  it('averages head+tail in the energy domain, not in dB', () => {
    expect(cue.combineLufs(-22.2, -22.9)).toBe(-22.5);
    expect(cue.combineLufs(-22.2, null)).toBe(-22.2);
    expect(cue.combineLufs(null, null)).toBe(null);
  });
});

describe('introFromLrc', () => {
  // Invented lyrics — not quotes from real songs.
  it('takes the first sung line timestamp as the vocal entry', () => {
    const lrc = '[00:00.00]作词 : 测试词人\n[00:00.50]作曲 : 测试曲人\n[00:13.20]路灯替我数着没睡的人\n';
    expect(cue.introFromLrc(lrc)).toBe(13.2);
  });

  it('skips a 《title》 header line and still finds the entry', () => {
    const lrc = '[00:00.00]《虚构的歌》\n[00:12.00]潮水退了就回家\n';
    expect(cue.introFromLrc(lrc)).toBe(12);
  });

  it('rejects a first-line timestamp ≤1s (a header parked at 00:00)', () => {
    expect(cue.introFromLrc('[00:00.50]潮水退了就回家\n')).toBe(null);
  });

  it('rejects a first-line timestamp >60s (timing is probably garbage)', () => {
    expect(cue.introFromLrc('[01:15.00]潮水退了就回家\n')).toBe(null);
  });

  it('returns null for empty / untimed / credits-only lyrics', () => {
    expect(cue.introFromLrc('')).toBe(null);
    expect(cue.introFromLrc('潮水退了就回家\n只是没有时间轴\n')).toBe(null);
    expect(cue.introFromLrc('[00:00.00]作词 : 测试词人\n[00:01.00]作曲 : 测试曲人\n')).toBe(null);
  });
});

describe('analyzeTrack', () => {
  const track = { source: 'netease', id: '42', streamUrl: 'http://127.0.0.1:8080/api/ncm/stream/42', durationSec: 120 };

  it('assembles the full cue record from head+tail transcripts', async () => {
    const exec = fakeExec();
    const rec = await cue.analyzeTrack(track, { exec, lyrics: noLyrics });
    expect(rec).toMatchObject({
      v: 1,
      source: 'netease',
      id: '42',
      durationSec: 120,
      cueIn: 2.51,
      endType: 'fade',
      lufs: -22.5,
      gainDb: 6.5,
      introSec: null,
      ffmpeg: true,
    });
    expect(rec.cueOut).toBeCloseTo(109.55, 1);
    expect(rec.seguePoint).toBeCloseTo(107.55, 1);
    // head + tail, plus the one cached -version probe
    expect(exec.calls.filter((a) => !a.includes('-version')).length).toBe(2);
  });

  it('runs ffmpeg only on the head 40s and tail 40s, never the whole file', async () => {
    const exec = fakeExec();
    await cue.analyzeTrack(track, { exec, lyrics: noLyrics });
    const [head, tail] = exec.calls.filter((a) => !a.includes('-version'));
    expect(head.join(' ')).toContain('-t 40');
    expect(tail.join(' ')).toContain('-sseof -40');
  });

  it('falls back to the stderr Duration header when the caller has no durationSec', async () => {
    const rec = await cue.analyzeTrack({ ...track, durationSec: undefined }, { exec: fakeExec(), lyrics: noLyrics });
    expect(rec.durationSec).toBe(120);
    expect(rec.endType).toBe('fade');
  });

  it('pulls introSec from lyrics, applying the sanity rules', async () => {
    const lyrics = async () => '[00:00.00]作词 : 测试词人\n[00:13.20]路灯替我数着没睡的人\n';
    const rec = await cue.analyzeTrack(track, { exec: fakeExec(), lyrics });
    expect(rec.introSec).toBe(13.2);
  });

  it('classifies a cold ender from the cold tail transcript', async () => {
    const rec = await cue.analyzeTrack(
      { source: 'navidrome', id: 'x', streamUrl: 'http://127.0.0.1:8080/api/stream/x', durationSec: 90 },
      { exec: fakeExec({ tail: TAIL_COLD }), lyrics: noLyrics },
    );
    expect(rec.endType).toBe('cold');
    expect(rec.cueOut).toBe(90);
    expect(rec.seguePoint).toBe(90);
  });

  it('one timed-out run nulls only its own fields', async () => {
    const exec = fakeExec({ tail: new Error('ffmpeg timed out after 10000ms') });
    const rec = await cue.analyzeTrack(track, { exec, lyrics: noLyrics });
    expect(rec.cueIn).toBe(2.51);         // head survived
    expect(rec.cueOut).toBe(null);        // tail honest nulls
    expect(rec.endType).toBe(null);
    expect(rec.seguePoint).toBe(null);
    expect(rec.lufs).toBe(-22.2);         // head-only loudness
  });

  it('a nonzero ffmpeg exit is a failure, not a source of garbage cues', async () => {
    const exec = fakeExec();
    const failing = async (bin, args) => {
      const r = await exec(bin, args);
      return args.includes('-version') ? r : { code: 1, stderr: r.stderr };
    };
    const rec = await cue.analyzeTrack(track, { exec: failing, lyrics: noLyrics });
    expect(rec.cueIn).toBe(null);
    expect(rec.lufs).toBe(null);
  });
});

describe('ffmpeg absent', () => {
  const track = { source: 'netease', id: '7', streamUrl: 'http://x/7', durationSec: 200 };
  const enoent = () => Object.assign(new Error('spawn ffmpeg ENOENT'), { code: 'ENOENT' });

  it('degrades to honest nulls without throwing', async () => {
    const exec = async () => { throw enoent(); };
    const rec = await cue.analyzeTrack(track, { exec, lyrics: noLyrics });
    expect(rec.ffmpeg).toBe(false);
    expect(rec.cueIn).toBe(null);
    expect(rec.cueOut).toBe(null);
    expect(rec.endType).toBe(null);
    expect(rec.seguePoint).toBe(null);
    expect(rec.lufs).toBe(null);
    expect(rec.gainDb).toBe(null);
  });

  it('still extracts introSec from lyrics (independent of ffmpeg)', async () => {
    const exec = async () => { throw enoent(); };
    const lyrics = async () => '[00:09.80]风把楼下的椅子挪了半寸\n';
    const rec = await cue.analyzeTrack(track, { exec, lyrics });
    expect(rec.introSec).toBe(9.8);
  });

  it('probes for ffmpeg once per process, not once per track', async () => {
    let probes = 0;
    const exec = async () => { probes += 1; throw enoent(); };
    await cue.analyzeTrack(track, { exec, lyrics: noLyrics });
    await cue.analyzeTrack({ ...track, id: '8' }, { exec, lyrics: noLyrics });
    expect(probes).toBe(1);
  });
});

describe('cache', () => {
  const track = { source: 'netease', id: '42', streamUrl: 'http://x/42', durationSec: 120 };

  it('ensureCue analyzes once, then serves from the permanent cache', async () => {
    const exec = fakeExec();
    const first = await cue.ensureCue(track, { exec, lyrics: noLyrics });
    const callsAfterFirst = exec.calls.length;
    const second = await cue.ensureCue(track, { exec, lyrics: noLyrics });
    expect(second).toEqual(first);
    expect(exec.calls.length).toBe(callsAfterFirst); // no new ffmpeg work
    expect(cue.cachedCue(track)).toEqual(first);     // sync read hits too
  });

  it('round-trips through cache/cues.json across a process restart', async () => {
    const rec = await cue.ensureCue(track, { exec: fakeExec(), lyrics: noLyrics });
    expect(fs.existsSync(cue.CUE_CACHE_FILE)).toBe(true);
    cue.resetCueState(); // simulate a fresh process (same DATA_ROOT)
    expect(cue.cachedCue(track)).toEqual(rec);
  });

  it('a schema version bump invalidates the whole file', async () => {
    await cue.ensureCue(track, { exec: fakeExec(), lyrics: noLyrics });
    // Rewrite the file as if an older algorithm produced it.
    const stale = JSON.parse(fs.readFileSync(cue.CUE_CACHE_FILE, 'utf8'));
    stale.v = cue.CUE_SCHEMA_VERSION - 1;
    fs.writeFileSync(cue.CUE_CACHE_FILE, JSON.stringify(stale));
    cue.resetCueState();
    expect(cue.cachedCue(track)).toBe(null);
    const exec = fakeExec();
    await cue.ensureCue(track, { exec, lyrics: noLyrics });
    expect(exec.calls.filter((a) => !a.includes('-version')).length).toBe(2); // re-analyzed
  });

  it('survives a corrupt cache file', async () => {
    fs.mkdirSync(path.dirname(cue.CUE_CACHE_FILE), { recursive: true });
    fs.writeFileSync(cue.CUE_CACHE_FILE, '{not json');
    expect(cue.cachedCue(track)).toBe(null);
    const rec = await cue.ensureCue(track, { exec: fakeExec(), lyrics: noLyrics });
    expect(rec.endType).toBe('fade');
  });

  it('does not persist a no-ffmpeg result — a later install gets a real analysis', async () => {
    const exec = async () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); };
    const rec = await cue.ensureCue(track, { exec, lyrics: noLyrics });
    expect(rec.ffmpeg).toBe(false);
    expect(cue.cachedCue(track)).toEqual(rec);       // remembered for this process
    expect(fs.existsSync(cue.CUE_CACHE_FILE)).toBe(false); // …but never written to disk
    cue.resetCueState();                              // "restart" with ffmpeg installed
    const rec2 = await cue.ensureCue(track, { exec: fakeExec(), lyrics: noLyrics });
    expect(rec2.ffmpeg).toBe(true);
    expect(rec2.endType).toBe('fade');
  });

  it('a fully failed analysis is not carved in stone either', async () => {
    const dead = fakeExec({ head: new Error('timeout'), tail: new Error('timeout') });
    const rec = await cue.ensureCue(track, { exec: dead, lyrics: noLyrics });
    expect(rec.ffmpeg).toBe(true);
    expect(rec.cueIn).toBe(null);
    expect(fs.existsSync(cue.CUE_CACHE_FILE)).toBe(false);
  });

  it('a track without source/id is analyzed but never cached', async () => {
    const rec = await cue.ensureCue({ streamUrl: 'http://x/y', durationSec: 120 }, { exec: fakeExec(), lyrics: noLyrics });
    expect(rec.endType).toBe('fade');
    expect(fs.existsSync(cue.CUE_CACHE_FILE)).toBe(false);
  });
});

describe('in-flight coalescing', () => {
  it('concurrent ensureCue calls for one track share a single analysis', async () => {
    const exec = fakeExec();
    const track = { source: 'qqmusic', id: 'z9', streamUrl: 'http://x/z9', durationSec: 120 };
    const [a, b, c] = await Promise.all([
      cue.ensureCue(track, { exec, lyrics: noLyrics }),
      cue.ensureCue(track, { exec, lyrics: noLyrics }),
      cue.ensureCue(track, { exec, lyrics: noLyrics }),
    ]);
    expect(a).toBe(b);
    expect(b).toBe(c);
    // exactly one head + one tail + one -version probe — not three of each
    expect(exec.calls.length).toBe(3);
  });

  it('different tracks do not coalesce', async () => {
    const exec = fakeExec();
    await Promise.all([
      cue.ensureCue({ source: 's', id: '1', streamUrl: 'http://x/1', durationSec: 120 }, { exec, lyrics: noLyrics }),
      cue.ensureCue({ source: 's', id: '2', streamUrl: 'http://x/2', durationSec: 120 }, { exec, lyrics: noLyrics }),
    ]);
    expect(exec.calls.filter((a) => !a.includes('-version')).length).toBe(4);
  });
});

describe('runFfmpeg timeout', () => {
  it('kills an overrunning child and rejects', async () => {
    // `node -e` stands in for a wedged ffmpeg — no ffmpeg needed on this machine.
    const start = Date.now();
    await expect(
      cue.runFfmpeg(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], 200),
    ).rejects.toThrow(/timed out/);
    expect(Date.now() - start).toBeLessThan(5000); // it did not wait for the child
  });

  it('rejects cleanly when the binary does not exist', async () => {
    await expect(
      cue.runFfmpeg('/definitely/not/ffmpeg', ['-version'], 1000),
    ).rejects.toThrow();
  });
});
