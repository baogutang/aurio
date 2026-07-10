// 睡眠定时器 — pure countdown/fade math. Client-side only, never persisted:
// the STATION keeps running, only this device goes quiet. The last
// SLEEP_FADE_MS ramp the master gain to silence, then local playback pauses
// (the existing pause semantics apply on wake: play rejoins the live edge).

export const SLEEP_OPTIONS_MIN = [15, 30, 60, 90] as const;
export const SLEEP_FADE_MS = 30_000;

/** Cycle off → 15 → 30 → 60 → 90 → off. */
export function nextSleepMinutes(current: number | null): number | null {
  if (current == null) return SLEEP_OPTIONS_MIN[0];
  const i = SLEEP_OPTIONS_MIN.indexOf(current as typeof SLEEP_OPTIONS_MIN[number]);
  if (i < 0) return SLEEP_OPTIONS_MIN[0];
  return i + 1 < SLEEP_OPTIONS_MIN.length ? SLEEP_OPTIONS_MIN[i + 1] : null;
}

export function sleepRemainingMs(endsAt: number, now: number): number {
  return Math.max(0, endsAt - now);
}

export type SleepPhase = 'running' | 'fading' | 'done';

export function sleepPhase(endsAt: number, now: number): SleepPhase {
  const left = sleepRemainingMs(endsAt, now);
  if (left <= 0) return 'done';
  return left <= SLEEP_FADE_MS ? 'fading' : 'running';
}

/** Seconds the master fade should take when the fade window is entered. */
export function sleepFadeSeconds(endsAt: number, now: number): number {
  return Math.min(SLEEP_FADE_MS, sleepRemainingMs(endsAt, now)) / 1000;
}

/** Countdown label: `29m` far out, `9:59` inside the last ten minutes. */
export function formatSleepCountdown(ms: number): string {
  const left = Math.max(0, ms);
  if (left >= 10 * 60_000) return `${Math.ceil(left / 60_000)}m`;
  const totalSec = Math.ceil(left / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
