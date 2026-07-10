import { describe, it, expect } from 'vitest';
import {
  nextSleepMinutes, sleepRemainingMs, sleepPhase, sleepFadeSeconds,
  formatSleepCountdown, SLEEP_FADE_MS,
} from './sleepTimer';

describe('nextSleepMinutes', () => {
  it('cycles off → 15 → 30 → 60 → 90 → off', () => {
    expect(nextSleepMinutes(null)).toBe(15);
    expect(nextSleepMinutes(15)).toBe(30);
    expect(nextSleepMinutes(30)).toBe(60);
    expect(nextSleepMinutes(60)).toBe(90);
    expect(nextSleepMinutes(90)).toBeNull();
  });
  it('recovers from an unknown value by restarting the cycle', () => {
    expect(nextSleepMinutes(42)).toBe(15);
  });
});

describe('countdown phases', () => {
  const endsAt = 1_000_000;
  it('runs, then fades in the final window, then is done', () => {
    expect(sleepPhase(endsAt, endsAt - 10 * 60_000)).toBe('running');
    expect(sleepPhase(endsAt, endsAt - SLEEP_FADE_MS)).toBe('fading');
    expect(sleepPhase(endsAt, endsAt - 1000)).toBe('fading');
    expect(sleepPhase(endsAt, endsAt)).toBe('done');
    expect(sleepPhase(endsAt, endsAt + 5000)).toBe('done');
  });
  it('remaining never goes negative', () => {
    expect(sleepRemainingMs(endsAt, endsAt + 99)).toBe(0);
  });
  it('the fade ramp covers exactly what is left, capped at the window', () => {
    expect(sleepFadeSeconds(endsAt, endsAt - SLEEP_FADE_MS)).toBe(30);
    expect(sleepFadeSeconds(endsAt, endsAt - 12_000)).toBe(12);
    expect(sleepFadeSeconds(endsAt, endsAt + 1)).toBe(0);
  });
});

describe('formatSleepCountdown', () => {
  it('shows coarse minutes far out', () => {
    expect(formatSleepCountdown(89 * 60_000 + 1)).toBe('90m');
    expect(formatSleepCountdown(15 * 60_000)).toBe('15m');
  });
  it('switches to m:ss inside the last ten minutes', () => {
    expect(formatSleepCountdown(9 * 60_000 + 59_000)).toBe('9:59');
    expect(formatSleepCountdown(42_000)).toBe('0:42');
    expect(formatSleepCountdown(0)).toBe('0:00');
    expect(formatSleepCountdown(-5)).toBe('0:00');
  });
});
