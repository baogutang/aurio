import { describe, it, expect } from 'vitest';
import { voiceBars, staticBars, smoothBars } from './voiceStrip';

describe('voiceBars', () => {
  it('maps silence (128s) to zero everywhere', () => {
    const data = new Uint8Array(256).fill(128);
    expect(voiceBars(data, 16)).toEqual(new Array(16).fill(0));
  });

  it('lights only the column containing a transient', () => {
    const data = new Uint8Array(256).fill(128);
    data[40] = 250; // a spike in the second of 8 columns (32-wide slices)
    const bars = voiceBars(data, 8);
    expect(bars[1]).toBeGreaterThan(0.5);
    bars.forEach((v, i) => { if (i !== 1) expect(v).toBe(0); });
  });

  it('clamps a full-scale wave to 1 and never exceeds it', () => {
    const data = new Uint8Array(256);
    for (let i = 0; i < data.length; i++) data[i] = i % 2 ? 255 : 0;
    for (const v of voiceBars(data, 12)) {
      expect(v).toBeGreaterThan(0.9);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('handles degenerate inputs', () => {
    expect(voiceBars(new Uint8Array(0), 8)).toEqual(new Array(8).fill(0));
    expect(voiceBars(new Uint8Array(4).fill(128), 0)).toEqual([]);
    // More columns than samples: no NaN, no crash.
    const bars = voiceBars(new Uint8Array([128, 255]), 8);
    expect(bars).toHaveLength(8);
    bars.forEach((v) => expect(Number.isFinite(v)).toBe(true));
  });
});

describe('staticBars', () => {
  it('parks every bar at mid-height for reduced motion', () => {
    expect(staticBars(10)).toEqual(new Array(10).fill(0.5));
    expect(staticBars(0)).toEqual([]);
  });
});

describe('smoothBars', () => {
  it('attacks faster than it releases', () => {
    const rising = smoothBars([0, 0], [1, 1]);
    const falling = smoothBars([1, 1], [0, 0]);
    expect(rising[0]).toBeGreaterThan(0.5);       // attack 0.55
    expect(1 - falling[0]).toBeLessThan(0.5);     // release 0.25
  });

  it('treats a shorter target frame as silence', () => {
    const state = smoothBars([1, 1], []);
    expect(state[0]).toBeLessThan(1);
  });
});
