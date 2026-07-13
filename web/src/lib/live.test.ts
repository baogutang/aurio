import { describe, it, expect } from 'vitest';
import { formatWallClock, airPositionMs, uptimeParts, fillTemplate, transcriptTime } from './live';

// TZ pinned to UTC in vitest.config.ts.
const T = Date.UTC(2026, 6, 10, 21, 47, 32);

describe('formatWallClock', () => {
  it('renders hh:mm:ss', () => {
    expect(formatWallClock(T)).toBe('21:47:32');
  });
  it('can drop seconds', () => {
    expect(formatWallClock(T, { seconds: false })).toBe('21:47');
  });
  it('pads small fields', () => {
    expect(formatWallClock(Date.UTC(2026, 6, 10, 5, 3, 7))).toBe('05:03:07');
  });
});

describe('airPositionMs', () => {
  it('maps a media position back to broadcast wall-clock time', () => {
    // item started at T, cueIn 1500 ms; media at 61.5 s → 60 s of air time
    expect(airPositionMs(T, 1500, 61.5)).toBe(T + 60_000);
  });
  it('position at cueIn is the air start itself', () => {
    expect(airPositionMs(T, 1500, 1.5)).toBe(T);
  });
});

describe('uptimeParts', () => {
  const started = Date.UTC(2026, 6, 10, 9, 0, 0);
  it('splits uptime into hours and minutes', () => {
    expect(uptimeParts(started, started + 3 * 3_600_000 + 12 * 60_000 + 30_000))
      .toEqual({ hours: 3, minutes: 12 });
  });
  it('reads zero honestly right after sign-on', () => {
    expect(uptimeParts(started, started + 5_000)).toEqual({ hours: 0, minutes: 0 });
  });
  it('hides when the field is missing or nonsense (graceful degradation)', () => {
    expect(uptimeParts(null, T)).toBeNull();
    expect(uptimeParts(undefined, T)).toBeNull();
    expect(uptimeParts(0, T)).toBeNull();
    expect(uptimeParts(Number.NaN, T)).toBeNull();
    expect(uptimeParts(T + 1000, T)).toBeNull(); // future start = clock skew lie
  });
});

describe('transcriptTime', () => {
  it('renders HH:MM for a transcript line', () => {
    expect(transcriptTime(T)).toBe('21:47');
  });
  it('hides the stamp for legacy lines without a timestamp', () => {
    expect(transcriptTime(undefined)).toBeNull();
    expect(transcriptTime(null)).toBeNull();
    expect(transcriptTime(0)).toBeNull();
    expect(transcriptTime(Number.NaN)).toBeNull();
  });
});

describe('fillTemplate', () => {
  it('fills named placeholders', () => {
    expect(fillTemplate('已连续直播 {h} 小时 {m} 分', { h: 3, m: 12 })).toBe('已连续直播 3 小时 12 分');
  });
  it('leaves unknown placeholders intact', () => {
    expect(fillTemplate('{n} of {x}', { n: 2 })).toBe('2 of {x}');
  });
});
