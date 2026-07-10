// The station wiring (server/playout/station.js) — the P3 cutover's
// integration seams, pinned with a fake clock:
//   · the cursor advances with ZERO clients connected;
//   · join() mid-song returns the correct media offset;
//   · skip is a log operation that retimes for everyone;
//   · voice tracking pre-synthesizes upcoming lines only when someone listens;
//   · the persisted log restores mid-show.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeClock, memStore } from './helpers/clock.js';

const synthesizeBackground = vi.fn();
vi.mock('../server/tts/index.js', () => ({
  synthesizeBackground,
  cachedSynthesis: vi.fn(() => null),
}));

const { initStation, station, setListenerGate, toLogItem, itemToTrack } = await import('../server/playout/station.js');
const { eventBus } = await import('../server/runtime/event-bus.js');
const { db } = await import('../server/store.js');

const track = (id, extra = {}) => ({
  source: 'netease', id: String(id), title: `Song ${id}`, artist: 'Artist',
  duration: 10, // seconds → 10s items: segue at 8000, audible end at 10000
  url: `/api/ncm/stream/${id}`,
  ...extra,
});

let clock;
let store;

function rig({ horizonMs = 1, storeData = null } = {}) {
  clock = makeClock(0);
  store = memStore(storeData);
  initStation({
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    horizonMs,
    store,
    cue: null,
  });
  return { clock, store };
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

  it('prunes aired history so the log stays bounded', () => {
    rig();
    const many = Array.from({ length: 60 }, (_, i) => track(`t${i}`));
    station.appendTracks(many);
    station.start();
    clock.tick(8000 * 55); // deep into the log
    expect(station.items().length).toBeLessThan(60);
    // the on-air anchor and the whole unaired future always survive
    expect(station.current()).toBeTruthy();
    expect(station.items().some((it) => it.airStart == null)).toBe(true);
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
