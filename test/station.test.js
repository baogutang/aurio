// The station wiring (server/playout/station.js) — the P3 cutover's
// integration seams, pinned with a fake clock:
//   · the cursor advances with ZERO clients connected;
//   · join() mid-song returns the correct media offset;
//   · skip is a log operation that retimes for everyone;
//   · voice tracking pre-synthesizes upcoming lines only when someone listens;
//   · the persisted log restores mid-show.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeClock, memStore, memPrefs } from './helpers/clock.js';

const synthesizeBackground = vi.fn();
vi.mock('../server/tts/index.js', () => ({
  synthesizeBackground,
  cachedSynthesis: vi.fn(() => null),
}));

const { initStation, station, setListenerGate, toLogItem, itemToTrack, STATION_STARTED_PREF } = await import('../server/playout/station.js');
const { eventBus } = await import('../server/runtime/event-bus.js');
const { db } = await import('../server/store.js');

const track = (id, extra = {}) => ({
  source: 'netease', id: String(id), title: `Song ${id}`, artist: 'Artist',
  duration: 10, // seconds → 10s items: segue at 8000, audible end at 10000
  url: `/api/ncm/stream/${id}`,
  ...extra,
});

const HOUR = 60 * 60 * 1000;

let clock;
let store;
let prefs;

function rig({ horizonMs = 1, storeData = null, startAt = 0, prefsData = {}, ...extra } = {}) {
  clock = makeClock(startAt);
  store = memStore(storeData);
  prefs = memPrefs(prefsData);
  initStation({
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    horizonMs,
    store,
    prefs,
    cue: null,
    ...extra, // e.g. quiet / voiceParams seams
  });
  return { clock, store, prefs };
}

beforeEach(() => {
  synthesizeBackground.mockReset();
  setListenerGate(() => false);
});

describe('toLogItem / itemToTrack', () => {
  it('maps a resolved track to a LogItem (sec → ms, url → streamUrl)', () => {
    rig();
    const item = toLogItem(track('a', { year: 2001, album: 'X' }));
    expect(item.duration).toBe(10000);
    expect(item.streamUrl).toBe('/api/ncm/stream/a');
    expect(item.track).toMatchObject({ source: 'netease', id: 'a', year: 2001, album: 'X' });
    expect(item.type).toBe('song');
  });

  it('falls back to a believable duration when the track lies', () => {
    rig();
    expect(toLogItem(track('a', { duration: 0 })).duration).toBe(4 * 60000);
    expect(toLogItem(track('a', { duration: undefined })).duration).toBe(4 * 60000);
  });

  it('round-trips the voice as segue fields for legacy read paths', () => {
    rig();
    const item = toLogItem(track('a'), { voice: { text: '接下来这首', ttsUrl: '/tts/x.mp3' } });
    const t = itemToTrack(item);
    expect(t.segue).toBe('接下来这首');
    expect(t.segueTtsUrl).toBe('/tts/x.mp3');
    expect(t.url).toBe('/api/ncm/stream/a');
  });
});

describe('the cursor advances with zero clients', () => {
  it('appends self-anchor at now, start plays through the log unattended', () => {
    rig();
    station.appendTracks([track('a'), track('b'), track('c')]);
    station.start();
    expect(station.current()?.track.id).toBe('a');

    clock.tick(8000);   // a's segue point → b starts
    expect(station.current()?.track.id).toBe('b');

    clock.tick(8000);   // 16000 → c starts
    expect(station.current()?.track.id).toBe('c');

    clock.tick(10000);  // c's audible end → dead air, cursor honest about it
    expect(station.current()).toBeNull();
    // history was stamped — nobody was connected the whole time
    const items = station.items();
    expect(items.map((it) => it.airStart)).toEqual([0, 8000, 16000]);
  });

  it('a suspended process resyncs on wake without N catch-up events', () => {
    rig();
    station.appendTracks([track('a'), track('b'), track('c'), track('d')]);
    station.start();
    clock.sleep(17000); // lid closed through a and b
    station.wake();
    expect(station.current()?.track.id).toBe('c');
    expect(station.join().offsetMs).toBe(1000); // 17000 − c.start(16000)
  });
});

describe('join in progress', () => {
  it('returns the on-air item with the correct media offset', () => {
    rig();
    station.appendTracks([track('a'), track('b')]);
    station.start();
    clock.tick(3500);
    const snap = station.join();
    expect(snap.current.track.id).toBe('a');
    expect(snap.offsetMs).toBe(3500);
    expect(snap.serverNow).toBe(3500);
    expect(snap.upNext.map((it) => it.track.id)).toEqual(['b']);
  });

  it('exposes the outgoing item during the crossfade window', () => {
    rig();
    station.appendTracks([track('a'), track('b')]);
    station.start();
    clock.tick(9000); // b started at 8000; a still audible until 10000
    const snap = station.join();
    expect(snap.current.track.id).toBe('b');
    expect(snap.offsetMs).toBe(1000);
    expect(snap.ending?.track.id).toBe('a');
    expect(snap.ending?.offsetMs).toBe(9000);
  });
});

describe('skip is a server log operation', () => {
  it('shortens the on-air item to end now and starts the next immediately', () => {
    rig();
    station.appendTracks([track('a'), track('b')]);
    station.start();
    clock.tick(3000);
    const next = station.skip();
    expect(next?.track.id).toBe('b');
    expect(station.join().offsetMs).toBe(0);
    // history is honest: a aired 3s and its cue was cut cold at 3000
    const a = station.items()[0];
    expect(a.airStart).toBe(0);
    expect(a.cueOut).toBe(3000);
    expect(a.endType).toBe('cold');
    // b was retimed to start at the skip instant
    expect(station.items()[1].airStart).toBe(3000);
  });

  it('skips into dead air when nothing follows', () => {
    rig();
    station.appendTracks([track('a')]);
    station.start();
    clock.tick(3000);
    expect(station.skip()).toBeNull();
    expect(station.current()).toBeNull();
  });

  it('is a no-op during dead air', () => {
    rig();
    station.start();
    expect(station.skip()).toBeNull();
  });
});

describe('steer', () => {
  it('keeps aired history and the on-air item, replaces the future', () => {
    rig();
    station.appendTracks([track('a'), track('b'), track('c')]);
    station.start();
    clock.tick(3000);
    station.steerTracks([track('x'), track('y')]);
    const ids = station.items().map((it) => it.track.id);
    expect(ids).toEqual(['a', 'x', 'y']);
    expect(station.current()?.track.id).toBe('a'); // still playing
    clock.tick(5000); // a segues at 8000
    expect(station.current()?.track.id).toBe('x');
  });
});

describe('voice tracking (the cost gate)', () => {
  it('pre-synthesizes upcoming voice lines when somebody listens', () => {
    rig();
    setListenerGate(() => true);
    synthesizeBackground.mockImplementation((text, onDone) => {
      onDone({ url: `/tts/${text.length}.mp3` });
      return null;
    });
    station.appendTracks([track('a'), track('b')], { voice: { text: '新的一段开始了' } });
    station.start();
    expect(synthesizeBackground).toHaveBeenCalledWith('新的一段开始了', expect.any(Function));
    const a = station.items()[0];
    expect(a.voice.ttsUrl).toMatch(/^\/tts\//);
  });

  it('never spends TTS with no listener — but the cursor still advances', () => {
    rig();
    setListenerGate(() => false);
    station.appendTracks([track('a'), track('b')], { voice: { text: '没人听的那句' } });
    station.start();
    clock.tick(8000);
    expect(synthesizeBackground).not.toHaveBeenCalled();
    expect(station.current()?.track.id).toBe('b'); // advance was free
  });

  it('does not re-request a line that already has a voice', () => {
    rig();
    setListenerGate(() => true);
    synthesizeBackground.mockImplementation((text, onDone) => {
      onDone({ url: '/tts/x.mp3' });
      return null;
    });
    station.appendTracks([track('a')], { voice: { text: '一句', ttsUrl: '/tts/have.mp3' } });
    station.start();
    expect(synthesizeBackground).not.toHaveBeenCalled();
  });

  // P5 workstream B: don't synthesize what won't speak — an item airing inside
  // a day-plan quiet window is skipped by voice tracking (not consumed: the
  // next pass reconsiders if the window moves).
  it('skips pre-synthesis for items airing inside a quiet window', () => {
    // Items are 10s each starting at t=0 with the segue at 8s: 'a' airs at 0,
    // 'b' at 8000. Quiet covers the first five seconds → only b's line is
    // worth money.
    rig({ quiet: (ts) => (ts < 5000 ? { reason: '会议静默' } : null) });
    setListenerGate(() => true);
    synthesizeBackground.mockImplementation((text, onDone) => {
      onDone({ url: `/tts/${Buffer.from(text).length}.mp3` });
      return null;
    });
    station.appendTracks([track('a')], { voice: { text: '静默窗里的话' } });
    station.appendTracks([track('b')], { voice: { text: '窗外的话' } });
    station.start();
    expect(synthesizeBackground).toHaveBeenCalledTimes(1);
    expect(synthesizeBackground.mock.calls[0][0]).toBe('窗外的话');
    expect(station.items()[0].voice.ttsUrl).toBeFalsy(); // skipped, still pending
    expect(station.items()[1].voice.ttsUrl).toMatch(/^\/tts\//);
  });

  // Workstream C: per-show voice params resolve at the item's AIR TIME and
  // ride the synthesis call as the third argument.
  it('threads voice params for the show on air at the item start', () => {
    const voiceParams = vi.fn((ts) => (ts >= 5000 ? { voiceType: 'night', speed: 0.85 } : null));
    rig({ voiceParams });
    setListenerGate(() => true);
    synthesizeBackground.mockImplementation((text, onDone) => {
      onDone({ url: '/tts/v.mp3' });
      return null;
    });
    station.appendTracks([track('a')], { voice: { text: '白天的话' } });   // airs at 0
    station.appendTracks([track('b')], { voice: { text: '深夜的话' } });   // airs at 8s (segue)
    station.start();
    expect(synthesizeBackground).toHaveBeenCalledTimes(2);
    // Default voice: the opts argument is omitted entirely.
    expect(synthesizeBackground.mock.calls[0]).toEqual(['白天的话', expect.any(Function)]);
    // Night show: the per-call params ride along.
    expect(synthesizeBackground.mock.calls[1])
      .toEqual(['深夜的话', expect.any(Function), { voiceType: 'night', speed: 0.85 }]);
  });
});

describe('imaging seam (updateItem)', () => {
  it('patches a voice onto an upcoming item and emits a programme event', () => {
    rig();
    station.appendTracks([track('a'), track('b')]);
    station.start();
    const events = [];
    const onProgramme = (e) => events.push(e.reason);
    eventBus.on('programme', onProgramme);
    try {
      const target = station.join().upNext[0];
      station.updateItem(target.id, { voice: { text: '你在听 Aurio。', ttsUrl: '/tts/liner.mp3', kind: 'liner' } });
      expect(station.getItem(target.id).voice.ttsUrl).toBe('/tts/liner.mp3');
      expect(events).toContain('voice');
    } finally {
      eventBus.off('programme', onProgramme);
    }
  });
});

describe('persistence and restore', () => {
  it('persists every mutation through the store seam', () => {
    rig();
    station.appendTracks([track('a'), track('b')]);
    expect(store.peek().items).toHaveLength(2);
  });

  it('restores a mid-show log: the cursor lands where the wall clock says', () => {
    rig();
    station.appendTracks([track('a'), track('b'), track('c')]);
    station.start();
    clock.tick(1000);
    const persisted = structuredClone(store.peek());

    // "restart" 15.5s later: a fresh station over the same persisted log
    clock = makeClock(16500);
    store = memStore(persisted);
    initStation({
      now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer,
      horizonMs: 1, store, cue: null,
    });
    station.start();
    expect(station.current()?.track.id).toBe('c'); // c started at 16000
    expect(station.join().offsetMs).toBe(500);
  });

  it('keeps ≥6h of aired items for the tape, drops what fell out of the 12h window', () => {
    rig();
    // A realistic broadcast day: 3-min songs, played through for 16 hours.
    const many = Array.from({ length: 340 }, (_, i) => track(`t${i}`, { duration: 180 }));
    station.appendTracks(many);
    station.start();
    clock.tick(16 * HOUR);
    const now = clock.now();
    expect(station.current()).toBeTruthy(); // still mid-log
    const aired = station.items().filter((it) => it.airStart != null);
    // Nothing inside the 12h tape window was lost…
    const audibleEnd = (it) => it.airStart + Math.max(0, it.cueOut - it.cueIn);
    expect(aired.every((it) => audibleEnd(it) >= now - 12 * HOUR)).toBe(true);
    // …so a 6h tape query is fully covered: the retained history reaches back
    // past now−6h with no holes (consecutive aired items stay contiguous).
    const oldest = aired[0];
    expect(oldest.airStart).toBeLessThanOrEqual(now - 6 * HOUR);
    for (let i = 1; i < aired.length; i++) {
      expect(aired[i].airStart).toBeLessThanOrEqual(audibleEnd(aired[i - 1]));
    }
    // and everything older than the window is gone
    expect(aired[0].airStart).toBeGreaterThanOrEqual(now - 12 * HOUR - 180000);
  }, 30000); // long-running by design: ticks through a full 16h broadcast day

  it('the hard item cap bounds the persisted file even with short items', () => {
    rig();
    // Pathologically short items: 90s each → >400 would fit in 12h without a cap.
    const many = Array.from({ length: 560 }, (_, i) => track(`t${i}`, { duration: 90 }));
    station.appendTracks(many);
    station.start();
    clock.tick(13 * HOUR);
    const aired = station.items().filter((it) => it.airStart != null);
    expect(aired.length).toBeLessThanOrEqual(400);
    expect(aired.length).toBeGreaterThan(300); // the cap trims, it doesn't gut
    // the persisted log is the bounded artifact
    expect(JSON.stringify(store.peek()).length).toBeLessThan(500 * 1024);
    // the on-air anchor and the unaired future always survive
    expect(station.current()).toBeTruthy();
    expect(station.items().some((it) => it.airStart == null)).toBe(true);
  }, 30000); // long-running by design: ticks through a 13h day of 90s items

  it('aired items keep their voice {text, ttsUrl} refs for the tape', () => {
    rig();
    setListenerGate(() => true);
    synthesizeBackground.mockImplementation((text, onDone) => {
      onDone({ url: '/tts/deadbeef.mp3' });
      return null;
    });
    station.appendTracks([track('a'), track('b')], { voice: { text: '第一句口播' } });
    station.start();
    clock.tick(9000); // a aired, b on air
    const a = station.items()[0];
    expect(a.airStart).toBe(0);
    expect(a.voice).toMatchObject({ text: '第一句口播', ttsUrl: '/tts/deadbeef.mp3' });
    // and the persisted copy carries them too — replay after restart is free
    expect(store.peek().items[0].voice).toMatchObject({ text: '第一句口播', ttsUrl: '/tts/deadbeef.mp3' });
  });

  it('migrates a pre-cutover client queue into the log once', () => {
    clock = makeClock(0);
    store = memStore(null);
    db.state.queue = [track('legacy1'), track('legacy2')];
    initStation({
      now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer,
      horizonMs: 1, store, cue: null,
    });
    expect(station.items().map((it) => it.track.id)).toEqual(['legacy1', 'legacy2']);
    expect(db.state.queue).toEqual([]);
  });
});

describe('stationStartedAt (uptime of the current on-air run)', () => {
  it('is null before anything airs, anchors at first air, holds across segues', () => {
    rig({ startAt: 1000 });
    expect(station.startedAt()).toBeNull();
    station.appendTracks([track('a'), track('b'), track('c')]);
    station.start();
    expect(station.startedAt()).toBe(1000);
    clock.tick(8000); // a segues into b — same run
    expect(station.current()?.track.id).toBe('b');
    expect(station.startedAt()).toBe(1000);
  });

  it('dead air ends the run; the next airing starts a new one', () => {
    rig({ startAt: 1000 });
    station.appendTracks([track('a')]);
    station.start();
    clock.tick(60000); // a's audible end (11000) long past — dead air
    expect(station.current()).toBeNull();
    expect(station.startedAt()).toBe(1000); // the last run's anchor, still honest
    station.appendTracks([track('b')]);     // pinned at now, airs immediately
    expect(station.current()?.track.id).toBe('b');
    expect(station.startedAt()).toBe(61000);
  });

  it('survives a restart that fast-forwarded through downtime (the log carried through)', () => {
    rig({ startAt: 1000 });
    station.appendTracks([track('a'), track('b'), track('c')]);
    station.start();
    clock.tick(1000);
    const persisted = structuredClone(store.peek());
    const carried = { [STATION_STARTED_PREF]: prefs.peek(STATION_STARTED_PREF) };

    // restart 16.5s in: c (started 17000) is mid-air; the chain has no gap
    rig({ storeData: persisted, startAt: 17500, prefsData: carried });
    station.start();
    expect(station.current()?.track.id).toBe('c');
    expect(station.startedAt()).toBe(1000); // uptime did NOT reset to the boot
  });

  it('a restart that woke into dead air starts a new run at the next airing', () => {
    rig({ startAt: 1000 });
    station.appendTracks([track('a'), track('b')]);
    station.start();
    clock.tick(1000);
    const persisted = structuredClone(store.peek());
    const carried = { [STATION_STARTED_PREF]: prefs.peek(STATION_STARTED_PREF) };

    // the whole schedule (audible through 19000) played out during downtime
    const bootAt = 5 * HOUR;
    rig({ storeData: persisted, startAt: bootAt, prefsData: carried });
    station.start();
    expect(station.current()).toBeNull();
    expect(station.startedAt()).toBe(1000); // dead air still reports the last run
    station.appendTracks([track('x')]);     // the horizon keeper would do this
    expect(station.current()?.track.id).toBe('x');
    expect(station.startedAt()).toBe(bootAt); // gap observed → new run
  });
});
