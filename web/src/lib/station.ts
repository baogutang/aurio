import type { MusicSourceMode } from './musicSource';

// The pseudo-FM dial. ONE place maps what the station is currently doing —
// the active music source (the band you tune) plus the latest steer (a small
// nudge along the dial) — to a display frequency. A future server-driven show
// schedule can replace this table wholesale and everything downstream keeps
// rendering `AURIO <freq>`.

/** Steer chips the listener can press; each nudges the dial inside the band. */
export type StationMood = 'calm' | 'energy' | 'similar' | 'ban';

export interface StationTuning {
  /** Formatted pseudo-FM frequency, e.g. "88.7". */
  freq: string;
  /** Full station line as shown in the UI, e.g. "AURIO 88.7". */
  line: string;
}

const CALL_SIGN = 'AURIO';

// Base frequency per music source — each source is its own band on the dial.
const SOURCE_FREQ: Record<MusicSourceMode, number> = {
  combined: 88.7,
  netease: 91.5,
  navidrome: 96.3,
  qqmusic: 101.7,
};

// Steering the programming retunes to a nearby sub-frequency inside the band.
const MOOD_OFFSET: Record<StationMood, number> = {
  calm: -0.4,
  energy: 0.6,
  similar: 0.2,
  ban: -0.2,
};

// Keep the dial on the real FM band so the number always reads plausible.
const FM_MIN = 87.5;
const FM_MAX = 108.0;

export function formatFreq(mhz: number): string {
  const clamped = Math.min(FM_MAX, Math.max(FM_MIN, mhz));
  return (Math.round(clamped * 10) / 10).toFixed(1);
}

export function tuneStation(source: MusicSourceMode, mood?: StationMood | null): StationTuning {
  const base = SOURCE_FREQ[source] ?? SOURCE_FREQ.combined;
  const offset = mood ? MOOD_OFFSET[mood] ?? 0 : 0;
  const freq = formatFreq(base + offset);
  return { freq, line: `${CALL_SIGN} ${freq}` };
}
