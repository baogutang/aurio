import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { FlipDigits } from './PixelClock';
import { usePreferences } from '../context/PreferencesContext';
import { readThemeRgb } from '../lib/themeColors';

interface Props {
  time: string;
}

interface Orbiter {
  angle: number;
  speed: number;
  radius: number;
  size: number;
}

/** Premium default: flip digits + sci-fi particle halo */
export default function ParticleClock({ time }: Props) {
  const { resolved, tr } = usePreferences();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const orbitersRef = useRef<Orbiter[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    let w = 0;
    let h = 0;
    let raf = 0;

    const init = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      if (orbitersRef.current.length === 0) {
        orbitersRef.current = Array.from({ length: 36 }, (_, i) => ({
          angle: (i / 36) * Math.PI * 2,
          speed: 0.003 + Math.random() * 0.008,
          radius: 0.42 + Math.random() * 0.12,
          size: 0.8 + Math.random() * 1.6,
        }));
      }
    };

    init();
    window.addEventListener('resize', init);

    const draw = () => {
      raf = requestAnimationFrame(draw);
      ctx.clearRect(0, 0, w, h);

      const cyan = readThemeRgb('--sci-cyan-rgb', '77,212,255');
      const accent = readThemeRgb('--accent-rgb', '255,106,61');
      const hi = readThemeRgb('--hi-rgb', '90,209,154');
      const cx = w / 2;
      const cy = h / 2;
      const baseR = Math.min(w, h) * 0.42;
      const t = Date.now() / 1000;

      // Soft vignette
      const vig = ctx.createRadialGradient(cx, cy, baseR * 0.2, cx, cy, baseR * 1.1);
      vig.addColorStop(0, `rgba(${cyan}, 0.08)`);
      vig.addColorStop(0.6, `rgba(${accent}, 0.03)`);
      vig.addColorStop(1, 'transparent');
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, w, h);

      // Twin orbital rings
      for (let ri = 0; ri < 2; ri++) {
        const r = baseR * (0.72 + ri * 0.18);
        const rot = t * (0.25 + ri * 0.1) * (ri % 2 === 0 ? 1 : -1);
        ctx.beginPath();
        ctx.arc(cx, cy, r, rot, rot + Math.PI * 1.4);
        ctx.strokeStyle = `rgba(${ri === 0 ? cyan : accent}, ${0.22 - ri * 0.06})`;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }

      // Particles orbit the flip clock
      for (let i = 0; i < orbitersRef.current.length; i++) {
        const o = orbitersRef.current[i];
        o.angle += o.speed;
        const r = baseR * o.radius;
        const px = cx + Math.cos(o.angle + t * 0.15) * r;
        const py = cy + Math.sin(o.angle + t * 0.15) * r * 0.55;
        const alpha = 0.25 + Math.sin(o.angle * 2 + t) * 0.2;
        const rgb = i % 3 === 0 ? hi : i % 3 === 1 ? cyan : accent;

        ctx.beginPath();
        ctx.arc(px, py, o.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${rgb}, ${alpha})`;
        ctx.fill();
      }

      // Horizontal scan
      const scanY = ((t * 28) % (h + 30)) - 15;
      const sg = ctx.createLinearGradient(0, scanY - 12, 0, scanY + 12);
      sg.addColorStop(0, 'transparent');
      sg.addColorStop(0.5, `rgba(${cyan}, 0.07)`);
      sg.addColorStop(1, 'transparent');
      ctx.fillStyle = sg;
      ctx.fillRect(0, scanY - 12, w, 24);
    };

    draw();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', init);
    };
  }, [resolved]);

  return (
    <div className="relative w-full select-none overflow-hidden rounded-[20px] py-2">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden />

      <div className="relative z-10 flex flex-col items-center">
        <FlipDigits time={time} />
        <motion.p
          key={time}
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.5 }}
          className="mt-1 font-mono text-[9px] uppercase tracking-[0.4em] text-[rgb(var(--sci-cyan-rgb))]"
        >
          {tr('temporalSync')}
        </motion.p>
      </div>

      <span className="sci-bracket sci-bracket-tl" />
      <span className="sci-bracket sci-bracket-tr" />
      <span className="sci-bracket sci-bracket-bl" />
      <span className="sci-bracket sci-bracket-br" />
    </div>
  );
}
