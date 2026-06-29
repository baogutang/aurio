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
