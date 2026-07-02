import { motion } from 'framer-motion';
import DotMatrixClock from './DotMatrixClock';
import PixelClock from './PixelClock';
import NeonClock from './NeonClock';
import type { ClockStyle } from '../lib/preferences';

interface Props {
  time: string;
  weekday: string;
  dateLine: string;
  airLabel: string;
  live: boolean;
  style: ClockStyle;
}

export default function ClockDisplay({ time, weekday, dateLine, airLabel, live, style }: Props) {
  if (style === 'flip') {
    return (
      <div className="py-2">
        <PixelClock time={time} />
        <p className="text-center text-[11px] text-[var(--text-muted)] mt-3 tracking-wide">{weekday}</p>
        <p className="text-center text-[10px] text-[var(--text-muted)] opacity-70 uppercase tracking-[0.2em]">{dateLine}</p>
        <div className="flex items-center justify-center gap-2 mt-3">
          <motion.span
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ background: live ? 'rgb(var(--hi-rgb))' : 'var(--text-muted)' }}
            animate={live ? { opacity: [1, 0.45, 1], scale: [1, 1.15, 1] } : { opacity: 0.35 }}
            transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
          />
          <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-[var(--text-muted)]">{airLabel}</span>
        </div>
      </div>
    );
  }
  if (style === 'neon') {
    return (
      <NeonClock
        time={time}
        weekday={weekday}
        dateLine={dateLine}
        airLabel={airLabel}
        live={live}
      />
    );
  }
  return (
    <DotMatrixClock
      time={time}
      weekday={weekday}
      dateLine={dateLine}
      airLabel={airLabel}
      live={live}
    />
  );
}
