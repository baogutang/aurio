import { describe, it, expect } from 'vitest';
import {
  angleOfTime, clockArcs, polar, describeArc,
  LOOK_BACK_MS, LOOK_AHEAD_MS, type ClockSpan,
} from './hotClock';

// TZ is pinned to UTC in vitest.config.ts, so epoch arithmetic is exact.
const HOUR = 3_600_000;
const MIN = 60_000;
// 2026-07-10 12:00:00 UTC
const T0 = Date.UTC(2026, 6, 10, 12, 0, 0);

const span = (id: string, start: number, end: number, type = 'song'): ClockSpan =>
  ({ id, type, start, end });

describe('angleOfTime', () => {
  it('maps the minute-of-hour onto the dial (0° = :00, clockwise)', () => {
    expect(angleOfTime(T0)).toBe(0);
    expect(angleOfTime(T0 + 15 * MIN)).toBe(90);
    expect(angleOfTime(T0 + 30 * MIN)).toBe(180);
    expect(angleOfTime(T0 + 45 * MIN)).toBe(270);
    expect(angleOfTime(T0 + HOUR)).toBe(0); // wraps every hour
  });

  it('moves with seconds — the hand is the real wall clock', () => {
    expect(angleOfTime(T0 + 30_000)).toBeCloseTo(3, 5); // 30 s = half a minute = 3°
  });
});

describe('clockArcs', () => {
  it('splits the on-air item at the hand into played/ahead', () => {
    const now = T0 + 10 * MIN;
    const arcs = clockArcs({
      aired: [],
      programme: [span('cur', T0 + 6 * MIN, T0 + 14 * MIN)],
      currentId: 'cur',
      now,
    });
    expect(arcs).toHaveLength(2);
    const [played, ahead] = arcs;
    expect(played.state).toBe('played');
    expect(played.a0).toBeCloseTo(36, 5);   // :06
    expect(played.a1).toBeCloseTo(60, 5);   // :10 (the hand)
    expect(ahead.state).toBe('ahead');
    expect(ahead.a0).toBeCloseTo(60, 5);
    expect(ahead.a1).toBeCloseTo(84, 5);    // :14
  });

  it('marks history aired and the rest upnext; voice types are voice arcs', () => {
    const now = T0 + 10 * MIN;
    const arcs = clockArcs({
      aired: [span('old', T0 + 2 * MIN, T0 + 5 * MIN)],
      programme: [
        span('cur', T0 + 8 * MIN, T0 + 12 * MIN),
        span('v1', T0 + 12 * MIN, T0 + 12 * MIN + 8000, 'liner'),
        span('n1', T0 + 12 * MIN + 8000, T0 + 16 * MIN),
      ],
      currentId: 'cur',
      now,
    });
    expect(arcs.map((a) => a.state)).toEqual(['aired', 'played', 'ahead', 'upnext', 'upnext']);
    expect(arcs.find((a) => a.id === 'v1')?.kind).toBe('voice');
    expect(arcs.find((a) => a.id === 'n1')?.kind).toBe('song');
  });

  it('clips to the surrounding hour and drops spans outside it', () => {
    const now = T0;
    const arcs = clockArcs({
      aired: [
        span('gone', now - 2 * HOUR, now - HOUR),               // fully outside
        span('edge', now - LOOK_BACK_MS - 5 * MIN, now - 25 * MIN), // clipped at back edge
      ],
      programme: [
        span('far', now + LOOK_AHEAD_MS + MIN, now + LOOK_AHEAD_MS + 10 * MIN), // outside
        span('long', now + 20 * MIN, now + 50 * MIN),           // clipped at front edge
      ],
      currentId: null,
      now,
    });
    expect(arcs.map((a) => a.id)).toEqual(['edge', 'long']);
    const edge = arcs[0];
    // clipped start = now - 30 min = :30 of the previous hour → 180°
    expect(edge.a0).toBeCloseTo(180, 5);
    expect(edge.a1 - edge.a0).toBeCloseTo(5 * 6, 5); // 5 minutes survive
    const long = arcs[1];
    expect(long.a1 - long.a0).toBeCloseTo(10 * 6, 5); // 20→30 min ahead survives
  });

  it('an upcoming span that wraps past :00 keeps a monotonic a0→a1', () => {
    const now = T0 + 55 * MIN;
    const arcs = clockArcs({
      aired: [],
      programme: [span('wrap', T0 + 56 * MIN, T0 + 64 * MIN)],
      currentId: null,
      now,
    });
    expect(arcs[0].a0).toBeCloseTo(336, 5);
    expect(arcs[0].a1).toBeCloseTo(384, 5); // 24° past the top
  });

  it('dedupes: the live slice wins over a tape copy of the same item', () => {
    const now = T0 + 10 * MIN;
    const cur = span('cur', T0 + 8 * MIN, T0 + 12 * MIN);
    const arcs = clockArcs({
      aired: [cur],
      programme: [cur],
      currentId: 'cur',
      now,
    });
    expect(arcs.map((a) => a.state)).toEqual(['played', 'ahead']);
  });

  it('handles the empty station honestly — no arcs at all', () => {
    expect(clockArcs({ aired: [], programme: [], currentId: null, now: T0 })).toEqual([]);
  });
});

describe('svg helpers', () => {
  it('polar places 0° at the top, 90° at the right', () => {
    expect(polar(100, 100, 50, 0).x).toBeCloseTo(100, 5);
    expect(polar(100, 100, 50, 0).y).toBeCloseTo(50, 5);
    expect(polar(100, 100, 50, 90).x).toBeCloseTo(150, 5);
    expect(polar(100, 100, 50, 90).y).toBeCloseTo(100, 5);
  });

  it('describeArc uses the large-arc flag only past 180°', () => {
    expect(describeArc(100, 100, 50, 0, 90)).toContain(' 0 0 1 ');
    expect(describeArc(100, 100, 50, 0, 270)).toContain(' 0 1 1 ');
  });
});
