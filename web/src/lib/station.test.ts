import { describe, it, expect } from 'vitest';
import { tuneStation, formatFreq, type StationMood } from './station';
import type { MusicSourceMode } from './musicSource';

const SOURCES: MusicSourceMode[] = ['combined', 'netease', 'navidrome', 'qqmusic'];
const MOODS: StationMood[] = ['calm', 'energy', 'similar', 'ban'];

describe('tuneStation', () => {
  it('assigns every source a distinct base frequency', () => {
    const freqs = SOURCES.map((s) => tuneStation(s).freq);
    expect(new Set(freqs).size).toBe(SOURCES.length);
  });

  it('is deterministic and total over source × mood', () => {
    for (const source of SOURCES) {
      for (const mood of [...MOODS, null, undefined] as const) {
        const a = tuneStation(source, mood);
        const b = tuneStation(source, mood);
        expect(a).toEqual(b);
        expect(a.freq).toMatch(/^\d{2,3}\.\d$/);
        expect(a.line).toBe(`AURIO ${a.freq}`);
      }
    }
  });

  it('nudges the dial when the listener steers, staying inside the band', () => {
    const base = tuneStation('combined').freq;
    for (const mood of MOODS) {
      const tuned = tuneStation('combined', mood).freq;
      expect(tuned).not.toBe(base);
      expect(Math.abs(parseFloat(tuned) - parseFloat(base))).toBeLessThanOrEqual(1);
    }
  });

  it('falls back to the combined band for an unknown source', () => {
    const bogus = 'spotify' as MusicSourceMode;
    expect(tuneStation(bogus).freq).toBe(tuneStation('combined').freq);
  });
});

describe('formatFreq', () => {
  it('formats to one decimal', () => {
    expect(formatFreq(88.65)).toBe('88.7');
    expect(formatFreq(101)).toBe('101.0');
  });

  it('clamps to the FM band', () => {
    expect(formatFreq(3)).toBe('87.5');
    expect(formatFreq(500)).toBe('108.0');
  });
});
