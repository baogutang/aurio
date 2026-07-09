export type RGB = [number, number, number];

/**
 * Pull one vibrant, mid-bright colour out of an already-loaded image.
 *
 * A naive average is always mud, because the bulk of most covers is dark or
 * near-grey and drowns out the one colour a listener actually reads. Instead we
 * weight every pixel by saturation × (1 − |2·luma − 1|) — high for colours that
 * are both saturated and mid-bright, zero for black, white, and grey — and
 * average only the top decile by that weight.
 *
 * The image must be same-origin (see lib/cover.ts): getImageData on a canvas
 * tainted by a cross-origin draw throws SecurityError, so it is wrapped and
 * returns null rather than crashing. Returns null when there is no colour worth
 * surfacing (a greyscale cover), so callers can fall back to the brand accent.
 */
export function extractSwatch(img: HTMLImageElement): RGB | null {
  const S = 32;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  try {
    ctx.drawImage(img, 0, 0, S, S);
  } catch {
    return null;
  }

  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, S, S).data;
  } catch {
    return null;
  }

  const scored: { r: number; g: number; b: number; w: number }[] = [];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 125) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    const sat = max === 0 ? 0 : (max - min) / max;
    const w = sat * (1 - Math.abs(2 * luma - 1));
    if (w > 0) scored.push({ r, g, b, w });
  }
  if (!scored.length) return null;

  scored.sort((p, q) => q.w - p.w);
  const take = Math.max(1, Math.round(scored.length * 0.1));
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let sw = 0;
  for (let i = 0; i < take; i++) {
    const p = scored[i];
    sr += p.r * p.w;
    sg += p.g * p.w;
    sb += p.b * p.w;
    sw += p.w;
  }
  if (sw < 0.02) return null;
  return [Math.round(sr / sw), Math.round(sg / sw), Math.round(sb / sw)];
}

/**
 * Nudge a colour toward a target relative luma (0–1), keeping its hue, so one
 * swatch stays legible on both the dark and the light theme.
 */
export function towardLuma([r, g, b]: RGB, target: number): RGB {
  const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  if (target > luma) {
    const t = (target - luma) / (1 - luma || 1);
    return [
      Math.round(r + (255 - r) * t),
      Math.round(g + (255 - g) * t),
      Math.round(b + (255 - b) * t),
    ];
  }
  const t = (luma - target) / (luma || 1);
  return [Math.round(r * (1 - t)), Math.round(g * (1 - t)), Math.round(b * (1 - t))];
}
