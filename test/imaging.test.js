import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const hasActiveSession = vi.fn(() => true);
const currentIndex = vi.fn(() => 0);
vi.mock('../server/radio.js', () => ({ hasActiveSession, currentIndex }));

// Immediate "cache hit": synthesizeBackground returns a url synchronously and
// never invokes onDone (mirrors the real contract for cached texts).
const synthesizeBackground = vi.fn((text) => ({ url: `/tts/${Buffer.from(text).length}.mp3`, cached: true }));
vi.mock('../server/tts/index.js', () => ({ synthesizeBackground, TTS_CACHE_DIR: '/nonexistent/tts' }));

// No ffmpeg in this file: the hourly ID must ship voice-only (the stitched
// path is covered by imaging-id.test.js against a temp data dir).
vi.mock('../server/music/ffmpeg.js', () => ({
  ffmpegAvailable: vi.fn(async () => false),
  ffmpegBin: () => 'ffmpeg',
  runFfmpeg: vi.fn(async () => ({ code: 1, stderr: '' })),
  FFMPEG_RUN_TIMEOUT_MS: 10000,
}));

// The hourly ID delivers through an async stitch decision even on the
// fallback path; one macrotask flushes it.
const flush = () => new Promise((r) => setTimeout(r, 0));

const { config } = await import('../server/config.js');
const { db } = await import('../server/store.js');
const { queueController } = await import('../server/runtime/queue-controller.js');
const { eventBus } = await import('../server/runtime/event-bus.js');
const imaging = await import('../server/imaging.js');

const track = (id, extra = {}) => ({
  source: 'netease', id: String(id), title: `Song ${id}`, artist: 'Artist', ...extra,
});

beforeEach(() => {
  synthesizeBackground.mockClear();
  hasActiveSession.mockReturnValue(true);
  currentIndex.mockReturnValue(0);
  config.imaging = { enabled: true, linerIntervalMin: 25 };
  db.setQueueImmediate([]);
  db.setPref('imagingRecentLiners', []);
});

afterEach(() => {
  imaging.stopImaging();
  vi.restoreAllMocks();
});

describe('sonic logo', () => {
  it('renders a valid 44.1kHz 16-bit mono RIFF/WAVE of the expected duration', () => {
    const wav = imaging.sonicLogoWav();
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.toString('ascii', 12, 16)).toBe('fmt ');
    expect(wav.readUInt16LE(20)).toBe(1);      // PCM
    expect(wav.readUInt16LE(22)).toBe(1);      // mono
    expect(wav.readUInt32LE(24)).toBe(44100);  // sample rate
    expect(wav.readUInt16LE(34)).toBe(16);     // bit depth
    expect(wav.toString('ascii', 36, 40)).toBe('data');
    const dataSize = wav.readUInt32LE(40);
    expect(dataSize).toBe(Math.round(imaging.LOGO_SECONDS * 44100) * 2);
    expect(wav.length).toBe(44 + dataSize);
    expect(wav.readUInt32LE(4)).toBe(wav.length - 8);
  });

  it('is not silence and ends on (near) zero', () => {
    const pcm = imaging.renderSonicLogo();
    let peak = 0;
    for (const s of pcm) peak = Math.max(peak, Math.abs(s));
    expect(peak).toBeGreaterThan(10000);
    expect(Math.abs(pcm[pcm.length - 1])).toBeLessThan(50);
  });
});

describe('liner manifest and rotation', () => {
  it('liners are short enough to be heard, not read', () => {
    expect(imaging.LINERS.length).toBeGreaterThanOrEqual(14);
    for (const l of imaging.LINERS) {
      expect(l.text.length).toBeLessThanOrEqual(20);
      expect(['any', 'morning', 'day', 'evening', 'late']).toContain(l.daypart);
    }
  });

  it('picks daypart-appropriate liners', () => {
    for (let i = 0; i < 50; i++) {
      expect(['late', 'any']).toContain(imaging.pickLiner(3).daypart);
      expect(['morning', 'any']).toContain(imaging.pickLiner(8).daypart);
      expect(['day', 'any']).toContain(imaging.pickLiner(14).daypart);
      expect(['evening', 'any']).toContain(imaging.pickLiner(20).daypart);
    }
  });

  it('never repeats a liner consecutively', () => {
    let last = null;
    for (let i = 0; i < 100; i++) {
      const l = imaging.pickLiner(23, last ? [last] : []);
      expect(l.id).not.toBe(last);
      last = l.id;
    }
  });

  it('avoids the whole recent window while candidates remain', () => {
    const recent = ['callsign', 'stay', 'host', 'late-quiet'];
    for (let i = 0; i < 50; i++) {
      expect(recent).not.toContain(imaging.pickLiner(23, recent).id);
    }
  });
});

describe('time call', () => {
  it('speaks hours in natural Chinese', () => {
    expect(imaging.timeCallText(0)).toBe('零点整，Aurio。');
    expect(imaging.timeCallText(2)).toBe('凌晨两点整，Aurio。');
    expect(imaging.timeCallText(7)).toBe('早上七点整，Aurio。');
    expect(imaging.timeCallText(10)).toBe('上午十点整，Aurio。');
    expect(imaging.timeCallText(12)).toBe('中午十二点整，Aurio。');
    expect(imaging.timeCallText(15)).toBe('下午三点整，Aurio。');
    expect(imaging.timeCallText(23)).toBe('晚上十一点整，Aurio。');
  });
});

describe('delivery', () => {
  it('patches the first upcoming track without a segue and emits a tts event', () => {
    db.setQueueImmediate([track(1), track(2, { segueTtsUrl: '/tts/dj.mp3' }), track(3)]);
    const events = [];
    const onTts = (e) => events.push(e);
    eventBus.on('tts', onTts);
    try {
      expect(imaging.deliverLiner(Date.now())).toBe(true);
    } finally {
      eventBus.off('tts', onTts);
    }
    const q = db.getQueue();
    expect(q[1].segueTtsUrl).toBe('/tts/dj.mp3');    // DJ's own segue untouched
    expect(q[2].segueTtsUrl).toMatch(/^\/tts\//);     // liner landed on the free slot
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'liner', mode: 'append', track: { id: '3' } });
  });

  it('never patches when every upcoming track already has a segue', () => {
    db.setQueueImmediate([
      track(1),
      track(2, { segueTtsUrl: '/tts/a.mp3' }),
      track(3, { segueTtsUrl: '/tts/b.mp3' }),
      track(4, { segueTtsUrl: '/tts/c.mp3' }),
    ]);
    expect(imaging.deliverLiner(Date.now())).toBe(false);
    expect(synthesizeBackground).not.toHaveBeenCalled();
    expect(db.getQueue()[1].segueTtsUrl).toBe('/tts/a.mp3');
  });

  it('never targets the currently-playing track', () => {
    db.setQueueImmediate([track(1), track(2)]);
    currentIndex.mockReturnValue(0);
    imaging.deliverLiner(Date.now());
    const q = db.getQueue();
    expect(q[0].segueTtsUrl).toBeUndefined();
    expect(q[1].segueTtsUrl).toMatch(/^\/tts\//);
  });

  it('respects the off switch', () => {
    config.imaging = { enabled: false, linerIntervalMin: 25 };
    db.setQueueImmediate([track(1), track(2)]);
    expect(imaging.deliverLiner(Date.now())).toBe(false);
    expect(synthesizeBackground).not.toHaveBeenCalled();
  });

  it('stays silent without an active session', () => {
    hasActiveSession.mockReturnValue(false);
    db.setQueueImmediate([track(1), track(2)]);
    expect(imaging.deliverLiner(Date.now())).toBe(false);
    expect(synthesizeBackground).not.toHaveBeenCalled();
  });
});

describe('hourly station ID', () => {
  it('delivers the templated time call for the hour (voice-only without ffmpeg)', async () => {
    db.setQueueImmediate([track(1), track(2)]);
    const date = new Date();
    date.setHours(23, 0, 0, 0);
    expect(imaging.hourlyStationId(date)).toBe(true);
    expect(synthesizeBackground).toHaveBeenCalledWith('晚上十一点整，Aurio。', expect.any(Function));
    await flush();
    expect(db.getQueue()[1].segueTtsUrl).toMatch(/^\/tts\//);
  });

  it('respects the off switch and session gate', () => {
    db.setQueueImmediate([track(1), track(2)]);
    config.imaging = { enabled: false, linerIntervalMin: 25 };
    expect(imaging.hourlyStationId(new Date())).toBe(false);
    config.imaging = { enabled: true, linerIntervalMin: 25 };
    hasActiveSession.mockReturnValue(false);
    expect(imaging.hourlyStationId(new Date())).toBe(false);
    expect(synthesizeBackground).not.toHaveBeenCalled();
  });
});

describe('rotation interval', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    imaging.stopImaging();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('delivers one liner per interval, not before, and not while disabled', () => {
    db.setQueueImmediate([track(1), track(2), track(3), track(4)]);
    imaging.startImaging();

    vi.advanceTimersByTime(24 * 60000);
    expect(synthesizeBackground).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2 * 60000);
    expect(synthesizeBackground).toHaveBeenCalledTimes(1);

    // Well inside the next interval: still just the one.
    vi.advanceTimersByTime(10 * 60000);
    expect(synthesizeBackground).toHaveBeenCalledTimes(1);

    // A full interval later: the second one.
    vi.advanceTimersByTime(16 * 60000);
    expect(synthesizeBackground).toHaveBeenCalledTimes(2);
  });

  it('the off switch silences the running rotation', () => {
    config.imaging = { enabled: false, linerIntervalMin: 25 };
    db.setQueueImmediate([track(1), track(2)]);
    imaging.startImaging();
    vi.advanceTimersByTime(60 * 60000);
    expect(synthesizeBackground).not.toHaveBeenCalled();
  });
});
