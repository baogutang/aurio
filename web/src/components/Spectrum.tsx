import { useEffect, useRef } from 'react';
import { getMusicAnalyser } from '../lib/audioGraph';
import { usePreferences } from '../context/PreferencesContext';

interface Props {
  audioRef: React.RefObject<HTMLAudioElement>;
  height?: number;
}

type RGB = [number, number, number];

function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}
function cssRGB(name: string, fallback: RGB): RGB {
  const raw = cssVar(name, '');
  if (!raw) return fallback;
  const parts = raw.split(',').map((n) => parseFloat(n));
  return parts.length === 3 && parts.every((n) => !Number.isNaN(n)) ? (parts as RGB) : fallback;
}

/**
 * Dot-matrix LED spectrum — same dot language as the clock so it reads like
 * part of the same hardware display. Columns light bottom-up by band energy,
 * each topped with a slowly-falling peak-hold dot in the brand accent.
 */
export default function Spectrum({ audioRef, height = 104 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const valRef = useRef<number[]>([]);
  const peakRef = useRef<number[]>([]);
  const { resolved } = usePreferences();

  useEffect(() => {
    const audio = audioRef.current;
    const canvas = canvasRef.current;
    if (!audio || !canvas) return;
    const c2d = canvas.getContext('2d');
    if (!c2d) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const dotCss = 2.1;
    const gapCss = 1.1;

    let cols = 0;
    let rows = 0;
    let D = 0;
    let pitch = 0;
    let offX = 0;
    let baseY = 0;

    const resize = () => {
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
      D = dotCss * dpr;
      pitch = (dotCss + gapCss) * dpr;
      cols = Math.max(8, Math.floor((canvas.width + gapCss * dpr) / pitch));
      rows = Math.max(4, Math.floor((canvas.height + gapCss * dpr) / pitch));
      const gridW = cols * pitch - gapCss * dpr;
      const gridH = rows * pitch - gapCss * dpr;
      offX = (canvas.width - gridW) / 2;
      baseY = (canvas.height - gridH) / 2 + gridH - D / 2;
      if (valRef.current.length !== cols) {
        valRef.current = new Array(cols).fill(0);
        peakRef.current = new Array(cols).fill(0);
      }
    };
    resize();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    ro?.observe(canvas);
    window.addEventListener('resize', resize);

    const dot = (cx: number, cy: number, color: string, radius = D / 2) => {
      c2d.fillStyle = color;
      c2d.beginPath();
      c2d.arc(cx, cy, radius, 0, Math.PI * 2);
      c2d.fill();
    };

    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const w = canvas.width;
      const h = canvas.height;
      if (!w || !h) return;
      c2d.clearRect(0, 0, w, h);

      const fg = cssVar('--matrix-fg', '#ffffff');
      const accent = cssRGB('--accent-rgb', [255, 106, 61]);
      const accentStr = `rgb(${accent[0]},${accent[1]},${accent[2]})`;

      const g = getMusicAnalyser();
      const playing = !audio.paused;
      if (g && playing) g.an.getByteFrequencyData(g.data as Uint8Array<ArrayBuffer>);

      const val = valRef.current;
      const peak = peakRef.current;
      const bins = g ? g.data.length : 0;
      const now = Date.now();

      for (let i = 0; i < cols; i++) {
        let raw: number;
        if (g && playing && bins) {
          const lo = Math.floor(Math.pow(i / cols, 1.7) * bins * 0.8);
          const hi = Math.max(lo + 1, Math.floor(Math.pow((i + 1) / cols, 1.7) * bins * 0.8));
          let m = 0;
          for (let k = lo; k < hi && k < bins; k++) m = Math.max(m, g.data[k]);
          raw = Math.pow(m / 255, 0.9);
        } else {
          const ph = now / 780 + i * 0.5;
          raw = 0.04 + 0.05 * (Math.sin(ph) * 0.5 + 0.5);
        }
        val[i] += raw > val[i] ? (raw - val[i]) * 0.5 : (raw - val[i]) * 0.14;
        if (val[i] > peak[i]) peak[i] = val[i];
        else peak[i] = Math.max(val[i], peak[i] - (playing ? 0.012 : 0.02));
      }

      for (let i = 0; i < cols; i++) {
        const cx = offX + i * pitch + D / 2;
        const lit = Math.round(val[i] * (rows - 1));
        for (let r = 0; r <= lit; r++) dot(cx, baseY - r * pitch, fg);

        const pr = Math.round(peak[i] * (rows - 1));
        if (pr > 0) dot(cx, baseY - pr * pitch, accentStr, D * 0.4);
      }
    };

    const start = () => { if (!raf) draw(); };
    const stop = () => { if (raf) { cancelAnimationFrame(raf); raf = 0; } };
    const onVisibility = () => { if (document.hidden) stop(); else start(); };
    document.addEventListener('visibilitychange', onVisibility);
    if (!document.hidden) start();

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      ro?.disconnect();
      window.removeEventListener('resize', resize);
    };
  }, [audioRef, height, resolved]);

  return <canvas ref={canvasRef} className="w-full block" style={{ height }} aria-hidden />;
}
