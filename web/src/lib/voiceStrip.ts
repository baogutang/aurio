// 「Speaking…」时刻 (P5-C, RADIO_VISION §六B-C) — pure math for the voice
// waveform strip. The analyser hands us time-domain bytes (128 = silence);
// this folds them into per-column amplitudes the dot-matrix strip can draw.

/**
 * Per-column amplitudes (0..1) from one time-domain frame. Each column takes
 * the peak deviation of its slice of the buffer, with a mild curve so speech
 * reads tall without clipping every syllable to the rail.
 */
export function voiceBars(data: ArrayLike<number>, cols: number): number[] {
  if (cols <= 0) return [];
  const out = new Array<number>(cols).fill(0);
  const n = data.length;
  if (!n) return out;
  for (let i = 0; i < cols; i++) {
    const lo = Math.floor((i / cols) * n);
    const hi = Math.max(lo + 1, Math.floor(((i + 1) / cols) * n));
    let m = 0;
    for (let k = lo; k < hi && k < n; k++) {
      const v = Math.abs((data[k] - 128) / 128);
      if (v > m) m = v;
    }
    out[i] = m === 0 ? 0 : Math.min(1, Math.pow(m * 1.6, 0.85));
  }
  return out;
}

/** reduced-motion: honest stillness — every bar parked at mid-height. */
export function staticBars(cols: number): number[] {
  return new Array<number>(Math.max(0, cols)).fill(0.5);
}

/**
 * One smoothing step toward the target frame: fast attack (speech onsets
 * snap), slower release (tails breathe out). Mutates and returns `state`.
 */
export function smoothBars(state: number[], target: number[], attack = 0.55, release = 0.25): number[] {
  for (let i = 0; i < state.length; i++) {
    const tgt = target[i] ?? 0;
    const k = tgt > state[i] ? attack : release;
    state[i] += (tgt - state[i]) * k;
  }
  return state;
}
