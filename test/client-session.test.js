// The listener roster after the P3 cutover: no election, no roles — just who
// is connected, whether anybody is actually listening (the cost gate), and
// the validated playback-position heartbeat the DJ prompt reads.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { clientSessionManager } from '../server/runtime/client-session-manager.js';
import { initStation, station } from '../server/playout/station.js';
import { makeClock, memStore } from './helpers/clock.js';

const fakeWs = () => ({ readyState: 1, send: vi.fn() });
const registered = [];

beforeEach(() => {
  initStation({ store: memStore(), cue: null });
});

afterEach(() => {
  while (registered.length) clientSessionManager.unregister(registered.pop());
});

function connect(heartbeat = null) {
  const { clientId } = clientSessionManager.register(fakeWs());
  registered.push(clientId);
  if (heartbeat) clientSessionManager.onHeartbeat(clientId, heartbeat);
  return clientId;
}

describe('clientSessionManager (roster)', () => {
  it('stores valid positionSec/durationSec from the heartbeat', () => {
    connect({ paused: false, positionSec: 42, durationSec: 200 });
    const c = clientSessionManager.getController();
    expect(c?.positionSec).toBe(42);
    expect(c?.durationSec).toBe(200);
  });

  it('rejects garbage position/duration and a position past the duration', () => {
    const a = connect({ paused: false, positionSec: 'NaN', durationSec: -5 });
    let c = clientSessionManager.getController();
    expect(c?.positionSec).toBeNull();
    expect(c?.durationSec).toBeNull();
    clientSessionManager.onHeartbeat(a, { paused: false, positionSec: 500, durationSec: 200 });
    c = clientSessionManager.getController();
    expect(c?.positionSec).toBeNull();
    expect(c?.durationSec).toBe(200);
  });

  it('hasActiveSession is the cost gate: listening client → true', () => {
    expect(clientSessionManager.hasActiveSession()).toBe(false);
    connect({ paused: false, positionSec: 10, durationSec: 100 });
    expect(clientSessionManager.hasActiveSession()).toBe(true);
  });

  it('a paused-only roster does not open the wallet', () => {
    connect({ paused: true });
    expect(clientSessionManager.hasActiveSession()).toBe(false);
  });

  it('a stale heartbeat stops counting after the TTL', () => {
    vi.useFakeTimers();
    try {
      connect({ paused: false });
      expect(clientSessionManager.hasActiveSession()).toBe(true);
      vi.advanceTimersByTime(46000);
      expect(clientSessionManager.hasActiveSession()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('prefers the freshest listening client as the position source', () => {
    vi.useFakeTimers();
    try {
      const a = connect();
      const b = connect();
      clientSessionManager.onHeartbeat(a, { paused: false, positionSec: 10, durationSec: 100 });
      vi.advanceTimersByTime(5);
      clientSessionManager.onHeartbeat(b, { paused: true, positionSec: 77, durationSec: 100 });
      // b is fresher but paused — the listening one wins.
      expect(clientSessionManager.getController()?.clientId).toBe(a);
    } finally {
      vi.useRealTimers();
    }
  });

  it('remaining() counts items after the on-air one', () => {
    // dead air: everything in the view is "remaining"
    expect(clientSessionManager.remaining(3)).toBe(3);
    // on air: the first view item is the current one
    const clock = makeClock(0);
    initStation({
      store: memStore(), cue: null,
      now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer,
    });
    station.appendTracks([
      { source: 'netease', id: 'a', title: 'A', artist: 'x', duration: 100 },
      { source: 'netease', id: 'b', title: 'B', artist: 'x', duration: 100 },
    ]);
    station.start();
    expect(clientSessionManager.remaining(2)).toBe(1);
    station.stop();
  });

  it('getPlaybackState projects the log view, not client-reported indices', () => {
    const clock = makeClock(0);
    initStation({
      store: memStore(), cue: null,
      now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer,
    });
    station.appendTracks([
      { source: 'netease', id: 'a', title: 'A', artist: 'x', duration: 100 },
    ]);
    station.start();
    const s = clientSessionManager.getPlaybackState();
    expect(s.playingIndex).toBe(0);
    expect(s.queueLen).toBe(1);
    expect(s.currentTrack).toMatchObject({ id: 'a' });
    station.stop();
  });
});
