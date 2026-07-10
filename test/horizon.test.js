// The ensureHorizon keeper (server/playout/horizon.js): onHorizonLow drives
// refills, the cost gate decides brain vs recommend, failures back off, and a
// cold start self-starts the station.
import { describe, it, expect, vi } from 'vitest';
import { createHorizonKeeper, wireHorizonKeeper } from '../server/playout/horizon.js';
import { makeClock } from './helpers/clock.js';

const flush = () => new Promise((r) => setTimeout(r, 0));

function rig({ horizonMs = 5000, hasListener = () => true } = {}) {
  const clock = makeClock(0);
  let remainingMs = 0;
  const compose = vi.fn(async () => { remainingMs += 10000; return 4; });
  const fallback = vi.fn(async () => { remainingMs += 10000; return 4; });
  const keeper = createHorizonKeeper({
    remaining: () => remainingMs,
    horizonMs,
    hasListener,
    compose,
    fallback,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  return {
    clock, keeper, compose, fallback,
    drain: (ms) => { remainingMs = Math.max(0, remainingMs - ms); },
    remaining: () => remainingMs,
  };
}

describe('horizon keeper', () => {
  it('fills exactly once per starvation when the listener is present', async () => {
    const r = rig();
    r.keeper.poke();
    await flush();
    expect(r.compose).toHaveBeenCalledTimes(1);
    expect(r.fallback).not.toHaveBeenCalled();
    // horizon satisfied — further pokes are no-ops
    r.keeper.poke();
    await flush();
    expect(r.compose).toHaveBeenCalledTimes(1);
  });

  it('uses recommend() with nobody listening — zero LLM spend', async () => {
    const r = rig({ hasListener: () => false });
    r.keeper.poke();
    await flush();
    expect(r.compose).not.toHaveBeenCalled();
    expect(r.fallback).toHaveBeenCalledTimes(1);
  });

  it('falls back to recommend() when the brain path adds nothing', async () => {
    const r = rig();
    r.compose.mockImplementation(async () => 0);
    r.keeper.poke();
    await flush();
    expect(r.fallback).toHaveBeenCalledTimes(1);
    expect(r.remaining()).toBeGreaterThanOrEqual(5000);
  });

  it('retries with backoff when both paths fail, then succeeds', async () => {
    const r = rig();
    r.compose.mockImplementationOnce(async () => 0);
    r.fallback.mockImplementationOnce(async () => 0);
    r.keeper.poke();
    await flush();
    expect(r.remaining()).toBe(0);
    // the retry timer fires and the second round succeeds
    r.clock.tick(5001);
    await flush();
    expect(r.remaining()).toBeGreaterThanOrEqual(5000);
  });

  it('gives up after the fail streak but a reset poke revives it', async () => {
    const r = rig();
    r.compose.mockImplementation(async () => 0);
    r.fallback.mockImplementation(async () => 0);
    r.keeper.poke();
    await flush();
    for (let i = 0; i < 8; i++) { r.clock.tick(30000); await flush(); }
    const attempts = r.fallback.mock.calls.length;
    r.clock.tick(120000);
    await flush();
    expect(r.fallback.mock.calls.length).toBe(attempts); // parked

    // a listener connects: reset clears the streak and it tries again
    r.compose.mockImplementation(async () => { r.drain(-10000); return 4; });
    r.keeper.poke({ reset: true });
    await flush();
    expect(r.compose.mock.calls.length + r.fallback.mock.calls.length).toBeGreaterThan(attempts);
    expect(r.remaining()).toBeGreaterThanOrEqual(5000);
  });

  it('keeps filling until the horizon is satisfied', async () => {
    const r = rig({ horizonMs: 25000 });
    r.keeper.poke();
    await flush();
    // each compose adds 10s; 25s horizon needs three rounds
    expect(r.compose).toHaveBeenCalledTimes(3);
    expect(r.remaining()).toBeGreaterThanOrEqual(25000);
  });

  it('rotation: a small deterministic pool never starves the station', async () => {
    // An unconfigured instance sees the same short public chart every call.
    const pool = ['a', 'b', 'c'].map((id) => ({ source: 'qqmusic', id, title: id }));
    const appended = [];
    const fakeStation = {
      horizonRemaining: () => (appended.length ? 10 * 60000 : 0),
      items: () => appended.map((t) => ({ track: t })),
      appendTracks: (tracks) => { appended.push(...tracks); return tracks.map((t) => ({ track: t })); },
    };
    const keeper = wireHorizonKeeper({
      station: fakeStation,
      runSegment: async () => ({ error: 'no brain' }),
      recommend: async () => pool.map((t) => ({ ...t })),
      playbackUrl: async () => '/api/qq/stream/x',
      hasListener: () => false,
    });
    keeper.poke();
    await flush();
    expect(appended.map((t) => t.id)).toEqual(['a', 'b', 'c']);

    // The whole pool is now "recent" — the next starvation rotates repeats
    // back in instead of parking the station in dead air.
    appended.length = 0;
    appended.push(...pool.map((t) => ({ ...t }))); // simulate: all aired recently
    const before = appended.length;
    fakeStation.horizonRemaining = () => (appended.length > before ? 10 * 60000 : 0);
    keeper.poke({ reset: true });
    await flush();
    expect(appended.length).toBeGreaterThan(before); // repeats rotated in
    keeper.stop();
  });

  it('coalesces concurrent pokes into one running fill', async () => {
    const r = rig();
    let release;
    r.compose.mockImplementation(() => new Promise((res) => {
      release = () => { r.drain(-10000); res(4); };
    }));
    r.keeper.poke();
    r.keeper.poke();
    r.keeper.poke();
    await flush();
    expect(r.compose).toHaveBeenCalledTimes(1);
    release();
    await flush();
  });
});
