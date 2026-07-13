import { useEffect, useRef } from 'react';
import { getVoiceAnalyser } from '../lib/audioGraph';
import { voiceBars, staticBars, smoothBars } from '../lib/voiceStrip';
import { useI18n, usePreferences } from '../context/PreferencesContext';

// 「Speaking…」时刻 (P5-C, RADIO_VISION §六B-C) — the station cutting to the
// mic. While the DJ voice airs, this strip overlays the music spectrum with a
// REAL waveform off the voice bus analyser (audioGraph exposes it; no new
// nodes) — symmetric dot-matrix bars around a centre line, the shape of a
// tape machine's mono meter, clearly distinct from the music's bottom-up
// columns dimmed underneath.
//
// Mount it permanently and drive it with `active` (the app's talking state,
// set/reset by the voice element's own play/pause/ended/error events): entry
// and exit ride one 250ms ease, and any interruption that resets talking
// rolls the strip back instantly with no animation state of its own.

interface Props {
  /** True while the DJ voice is actually airing (the app's talking state). */
  active: boolean;
}

const DOT_CSS = 2.1; // same dot pitch as Spectrum — one hardware display
const GAP_CSS = 1.1;

export default function VoiceStrip({ active }: Props) {
  const { t } = useI18n();
  const { reducedMotion } = usePreferences();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const barsRef = useRef<number[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !active) return;
    const c2d = canvas.getContext('2d');
    if (!c2d) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let cols = 0;
    let rows = 0;
    let D = 0;
    let pitch = 0;
    let offX = 0;
    let midY = 0;

    const resize = () => {
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
      D = DOT_CSS * dpr;
      pitch = (DOT_CSS + GAP_CSS) * dpr;
      cols = Math.max(8, Math.floor((canvas.width + GAP_CSS * dpr) / pitch));
      rows = Math.max(5, Math.floor((canvas.height + GAP_CSS * dpr) / pitch));
      if (rows % 2 === 0) rows -= 1; // odd row count: a true centre line
      const gridW = cols * pitch - GAP_CSS * dpr;
      offX = (canvas.width - gridW) / 2;
      midY = canvas.height / 2;
      if (barsRef.current.length !== cols) barsRef.current = new Array(cols).fill(0);
    };
    resize();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    ro?.observe(canvas);

    const fg = () =>
      getComputedStyle(document.documentElement).getPropertyValue('--matrix-fg').trim() || '#ffffff';

    const paint = (bars: number[]) => {
      const w = canvas.width;
      const h = canvas.height;
      if (!w || !h) return;
      c2d.clearRect(0, 0, w, h);
      c2d.fillStyle = fg();
      const half = (rows - 1) / 2;
      for (let i = 0; i < cols; i++) {
        const cx = offX + i * pitch + D / 2;
        const lit = Math.round((bars[i] ?? 0) * half);
        for (let r = -lit; r <= lit; r++) {
          const centre = r === 0;
          c2d.globalAlpha = centre ? 0.9 : 0.85 - (Math.abs(r) / half) * 0.25;
          c2d.beginPath();
          c2d.arc(cx, midY + r * pitch, centre ? D / 2 : D * 0.42, 0, Math.PI * 2);
          c2d.fill();
        }
      }
      c2d.globalAlpha = 1;
    };

    if (reducedMotion) {
      // Honest stillness: bars parked at mid-height, painted once.
      paint(staticBars(cols));
      return () => { ro?.disconnect(); };
    }

    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const g = getVoiceAnalyser();
      let target: number[];
      if (g) {
        g.an.getByteTimeDomainData(g.data as Uint8Array<ArrayBuffer>);
        target = voiceBars(g.data, cols);
      } else {
        target = staticBars(cols); // no mixer (autoplay/CSP edge) — still visible
      }
      paint(smoothBars(barsRef.current, target));
    };
    draw();
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [active, reducedMotion]);

  // Rendered permanently; `active` swings a single 250ms opacity ease (the
  // same curve the spectrum's yield uses), so an interrupted voice snaps the
  // pair back together with nothing left half-animated.
  // The whole strip is aria-hidden: it is a visualization of the voice whose
  // words the say line already announces (aria-live) — no double narration.
  return (
    <div className="voice-strip" style={{ opacity: active ? 1 : 0 }} aria-hidden>
      <span className="voice-strip-label">
        <span
          className="voice-strip-dot"
          style={reducedMotion ? { animation: 'none' } : undefined}
        />
        {t('speakingLabel')}
      </span>
      <canvas ref={canvasRef} className="voice-strip-canvas" />
    </div>
  );
}
