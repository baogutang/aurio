import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The stitched hourly station ID (server/imaging.js): sonic logo → 0.3s gap →
// voice, one ffmpeg pass, cached per hour keyed by the voice clip's identity.
// The ffmpeg runner is seamed (opts.exec/opts.available) — no real ffmpeg here.

const hasActiveSession = vi.fn(() => true);
const currentIndex = vi.fn(() => 0);
vi.mock('../server/radio.js', () => ({ hasActiveSession, currentIndex }));

// Real store/queue against a temp data dir; TTS mocked to a stable cached url
// whose file THESE tests place in the (temp) cache themselves.
vi.mock('../server/tts/index.js', async () => {
  const { default: nodePath } = await import('node:path');
  return {
    TTS_CACHE_DIR: nodePath.join(process.env.AURIO_DATA_DIR, 'cache', 'tts'),
    synthesizeBackground: vi.fn(() => ({ url: '/tts/hourly-voice.mp3', cached: true })),
  };
});

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurio-imaging-id-'));
process.env.AURIO_DATA_DIR = tmpDir;

const { makeClock, memStore } = await import('./helpers/clock.js');
const { TTS_CACHE_DIR } = await import('../server/tts/index.js');
const { initStation, station } = await import('../server/playout/station.js');
const imaging = await import('../server/imaging.js');

const TEXT = '早上七点整，Aurio。';

function primeVoice(name, bytes = Buffer.from('fake voice payload')) {
  fs.mkdirSync(TTS_CACHE_DIR, { recursive: true });
  fs.writeFileSync(path.join(TTS_CACHE_DIR, name), bytes);
  return `/tts/${name}`;
}

// Emulates a successful ffmpeg run: writes the output (last arg) and exits 0.
const okExec = vi.fn(async (bin, args) => {
  fs.writeFileSync(args[args.length - 1], Buffer.from('stitched-mp3'));
  return { code: 0, stderr: '' };
});
const seams = { exec: okExec, available: async () => true };

function idFiles() {
  try {
    return fs.readdirSync(imaging.IMAGING_CACHE_DIR).filter((f) => f.startsWith('id-'));
  } catch {
    return [];
  }
}

beforeEach(() => {
  okExec.mockClear();
  hasActiveSession.mockReturnValue(true);
  currentIndex.mockReturnValue(0);
  fs.rmSync(imaging.IMAGING_CACHE_DIR, { recursive: true, force: true });
  initStation({ store: memStore(), cue: null });
});

afterAll(() => {
  delete process.env.AURIO_DATA_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('concat command shape', () => {
  it('feeds logo, a 0.3s silent breath, and voice through one resample-and-concat pass into mp3', () => {
    const args = imaging.concatIdArgs('/cache/logo.wav', '/cache/voice.mp3', '/cache/out.mp3.tmp');
    const joined = args.join(' ');
    // input order defines air order: logo, gap, voice
    expect(joined).toContain('-i /cache/logo.wav -f lavfi -t 0.3 -i anullsrc=r=44100:cl=mono -i /cache/voice.mp3');
    const fc = args[args.indexOf('-filter_complex') + 1];
    expect(fc).toContain('concat=n=3:v=0:a=1');
    // every leg resampled to one rate/format — TTS output varies by provider
    expect(fc.match(/aresample=44100/g)).toHaveLength(3);
    expect(fc.match(/channel_layouts=mono/g)).toHaveLength(3);
    expect(args).toContain('libmp3lame');
    // explicit container, because the output lands in a .tmp first
    expect(args.slice(-3)).toEqual(['-f', 'mp3', '/cache/out.mp3.tmp']);
    // never block on a prompt, never write over the terminal
    expect(args).toContain('-nostdin');
    expect(args).toContain('-y');
  });
});

describe('cache keying', () => {
  it('caches per hour + voice identity; a second call reuses the file without ffmpeg', async () => {
    const voiceUrl = primeVoice('voiceA.mp3');
    const first = await imaging.stationIdClip(7, TEXT, voiceUrl, seams);
    expect(first).toMatch(/^\/imaging\/id-07-[0-9a-f]{12}\.mp3$/);
    expect(okExec).toHaveBeenCalledTimes(1);
    // the stitch ran against a .tmp, then landed atomically under the real name
    expect(okExec.mock.calls[0][1][okExec.mock.calls[0][1].length - 1]).toMatch(/\.tmp$/);
    expect(fs.readFileSync(path.join(tmpDir, 'cache', 'imaging', path.basename(first)), 'utf8')).toBe('stitched-mp3');

    expect(await imaging.stationIdClip(7, TEXT, voiceUrl, seams)).toBe(first);
    expect(okExec).toHaveBeenCalledTimes(1); // cache hit — no second run
  });

  it('a different hour, text, or voice file regenerates', async () => {
    const a = imaging.stationIdFileName(7, TEXT, 'voiceA.mp3');
    expect(a).toMatch(/^id-07-[0-9a-f]{12}\.mp3$/);
    expect(imaging.stationIdFileName(8, '早上八点整，Aurio。', 'voiceA.mp3')).not.toBe(a);
    expect(imaging.stationIdFileName(7, TEXT, 'voiceB.mp3')).not.toBe(a); // provider/voice change = new tts hash
    expect(imaging.stationIdFileName(7, '换了词。', 'voiceA.mp3')).not.toBe(a);
    expect(imaging.stationIdFileName(7, TEXT, 'voiceA.mp3')).toBe(a); // deterministic
  });
});

describe('fallback paths (exactly today\'s voice-only behavior)', () => {
  it('no ffmpeg on the machine → the voice url ships untouched', async () => {
    const voiceUrl = primeVoice('voiceNo.mp3');
    const url = await imaging.stationIdClip(7, TEXT, voiceUrl, { exec: okExec, available: async () => false });
    expect(url).toBe(voiceUrl);
    expect(okExec).not.toHaveBeenCalled();
  });

  it('a failed stitch falls back and caches nothing', async () => {
    const voiceUrl = primeVoice('voiceFail.mp3');
    const badExec = vi.fn(async () => ({ code: 1, stderr: 'boom' }));
    const url = await imaging.stationIdClip(7, TEXT, voiceUrl, { exec: badExec, available: async () => true });
    expect(url).toBe(voiceUrl);
    expect(idFiles()).toEqual([]);
  });

  it('a run that exits 0 but writes no audio falls back too', async () => {
    const voiceUrl = primeVoice('voiceEmpty.mp3');
    const noopExec = vi.fn(async () => ({ code: 0, stderr: '' }));
    const url = await imaging.stationIdClip(7, TEXT, voiceUrl, { exec: noopExec, available: async () => true });
    expect(url).toBe(voiceUrl);
    expect(idFiles()).toEqual([]);
  });

  it('a voice clip that is not a local /tts/ cache file ships as-is', async () => {
    expect(await imaging.stationIdClip(7, TEXT, 'https://cdn.example/x.mp3', seams)).toBe('https://cdn.example/x.mp3');
    expect(await imaging.stationIdClip(7, TEXT, '/tts/never-made.mp3', seams)).toBe('/tts/never-made.mp3');
    expect(await imaging.stationIdClip(7, TEXT, '/tts/../escape.mp3', seams)).toBe('/tts/../escape.mp3');
    expect(okExec).not.toHaveBeenCalled();
  });
});

describe('corrupted cache', () => {
  it('an empty cached clip is regenerated, not aired', async () => {
    const voiceUrl = primeVoice('voiceC.mp3');
    const name = imaging.stationIdFileName(9, TEXT, 'voiceC.mp3');
    fs.mkdirSync(imaging.IMAGING_CACHE_DIR, { recursive: true });
    fs.writeFileSync(path.join(imaging.IMAGING_CACHE_DIR, name), '');

    const url = await imaging.stationIdClip(9, TEXT, voiceUrl, seams);
    expect(url).toBe(`/imaging/${name}`);
    expect(okExec).toHaveBeenCalledTimes(1); // it did NOT trust the empty file
    expect(fs.statSync(path.join(imaging.IMAGING_CACHE_DIR, name)).size).toBeGreaterThan(0);
  });
});

describe('end to end through hourlyStationId', () => {
  const track = (id) => ({ source: 'netease', id: String(id), title: `Song ${id}`, artist: 'Artist', duration: 240 });

  // Seed a programme in progress on the station log: first item on air, the
  // second upcoming — the hourly ID lands as the upcoming item's voice.
  function seedProgramme() {
    const clock = makeClock(0);
    initStation({
      store: memStore(), cue: null,
      now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer,
    });
    station.appendTracks([track(1), track(2)]);
    station.start();
  }

  const upcomingVoice = () => station.join({ upNext: 5 }).upNext[0]?.voice;

  it('airs the stitched clip on the upcoming free item', async () => {
    primeVoice('hourly-voice.mp3'); // matches the mocked synthesizeBackground url
    seedProgramme();
    const date = new Date();
    date.setHours(9, 0, 0, 0);
    expect(imaging.hourlyStationId(date, seams)).toBe(true);
    await vi.waitFor(() => {
      expect(upcomingVoice()?.ttsUrl).toMatch(/^\/imaging\/id-09-[0-9a-f]{12}\.mp3$/);
    });
    expect(upcomingVoice()?.kind).toBe('id');
    station.stop();
  });

  it('falls back to the voice clip when ffmpeg is missing', async () => {
    primeVoice('hourly-voice.mp3');
    seedProgramme();
    const date = new Date();
    date.setHours(9, 0, 0, 0);
    expect(imaging.hourlyStationId(date, { exec: okExec, available: async () => false })).toBe(true);
    await vi.waitFor(() => {
      expect(upcomingVoice()?.ttsUrl).toBe('/tts/hourly-voice.mp3');
    });
    station.stop();
  });
});
