import { useEffect, useRef } from 'react';
import { usePreferences } from '../context/PreferencesContext';
import { readThemeRgb } from '../lib/themeColors';

interface Props {
  playing?: boolean;
  className?: string;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  a: number;
  hue: 0 | 1;
}

export default function ParticleField({ playing = false, className = '' }: Props) {
  const { resolved } = usePreferences();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playingRef = useRef(playing);
  playingRef.current = playing;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    let w = 0;
    let h = 0;
    let particles: Particle[] = [];
    let raf = 0;
    let tick = 0;

    const init = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const count = Math.floor((w * h) / 7500);
      particles = Array.from({ length: Math.min(110, Math.max(50, count)) }, (_, i) => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        r: Math.random() * 2 + 0.5,
        a: Math.random() * 0.5 + 0.1,
        hue: (i % 2) as 0 | 1,
      }));
    };

    init();
    window.addEventListener('resize', init);

    const draw = () => {
      raf = requestAnimationFrame(draw);
      tick++;
      ctx.clearRect(0, 0, w, h);

      const energy = playingRef.current ? 2.2 : 1;
      const rgbA = readThemeRgb('--particle-a-rgb', '167,139,250');
      const rgbB = readThemeRgb('--particle-b-rgb', '77,212,255');
      const rgbAccent = readThemeRgb('--accent-rgb', '255,106,61');

      // Ambient radial
      const t = Date.now() / 1000;
      const pulse = 0.03 + Math.sin(t * 1.5) * 0.015;
      const g = ctx.createRadialGradient(w * 0.5, h * 0.3, 0, w * 0.5, h * 0.5, w * 0.6);
      g.addColorStop(0, playingRef.current
        ? `rgba(${rgbAccent},${pulse * 2})`
        : `rgba(${rgbB},${pulse})`);
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);

      for (const p of particles) {
        p.x += p.vx * energy;
        p.y += p.vy * energy;
        if (p.x < 0) p.x = w;
        if (p.x > w) p.x = 0;
        if (p.y < 0) p.y = h;
        if (p.y > h) p.y = 0;

        const rgb = playingRef.current ? rgbAccent : (p.hue ? rgbB : rgbA);
        const alpha = p.a * (playingRef.current ? 1.4 : 1);

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * (playingRef.current ? 1.4 : 1), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${rgb},${alpha})`;
        ctx.fill();

        // Trail streak every few frames
        if (playingRef.current && tick % 3 === 0) {
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * energy * 8, p.y - p.vy * energy * 8);
          ctx.strokeStyle = `rgba(${rgb},${alpha * 0.3})`;
          ctx.lineWidth = p.r * 0.6;
          ctx.stroke();
        }
      }

      const maxDist = playingRef.current ? 12000 : 7200;
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = dx * dx + dy * dy;
          if (dist < maxDist) {
            const alpha = (1 - dist / maxDist) * (playingRef.current ? 0.14 : 0.07);
            const rgb = playingRef.current ? rgbAccent : rgbA;
            ctx.strokeStyle = `rgba(${rgb},${alpha})`;
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.stroke();
          }
        }
      }

      // Scan sweep
      const scanY = ((t * 35 + tick * 0.2) % (h + 60)) - 30;
      const sg = ctx.createLinearGradient(0, scanY - 15, 0, scanY + 15);
      sg.addColorStop(0, 'transparent');
      sg.addColorStop(0.5, `rgba(${rgbB},0.06)`);
      sg.addColorStop(1, 'transparent');
      ctx.fillStyle = sg;
      ctx.fillRect(0, scanY - 15, w, 30);
    };

    draw();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', init);
    };
  }, [resolved]);

  return (
    <canvas
      ref={canvasRef}
      className={`absolute inset-0 w-full h-full pointer-events-none ${className}`}
      aria-hidden
    />
  );
}
