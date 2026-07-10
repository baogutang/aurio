import { motion } from 'framer-motion';
import { usePreferences } from '../context/PreferencesContext';

interface Props {
  time: string;
  weekday: string;
  dateLine: string;
  airLabel: string;
  live: boolean;
}

/* 5×7 dot-matrix font — rounded, hardware-LED style (clean '0'). */
const GLYPHS: Record<string, string[]> = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  '-': ['00000', '00000', '00000', '01110', '00000', '00000', '00000'],
};

function Digit({ char }: { char: string }) {
  const rows = GLYPHS[char] ?? GLYPHS['-'];
  return (
    <div
      className="matrix-digit"
      style={{ display: 'grid', gridTemplateColumns: 'repeat(5, var(--md))', gap: 'var(--mg)' }}
    >
      {rows.flatMap((row, r) =>
        row.split('').map((bit, c) => (
          <span key={`${r}-${c}`} className={`matrix-pixel${bit === '1' ? ' on' : ''}`} />
        )),
      )}
    </div>
  );
}

function Colon({ still }: { still: boolean }) {
  return (
    <motion.div
      className="matrix-colon"
      style={{ display: 'grid', gridTemplateRows: 'repeat(7, var(--md))', gap: 'var(--mg)' }}
      animate={still ? { opacity: 1 } : { opacity: [1, 0.25, 1] }}
      transition={still ? { duration: 0 } : { duration: 2, repeat: Infinity, ease: 'easeInOut', times: [0, 0.5, 1] }}
    >
      {Array.from({ length: 7 }, (_, r) => (
        <span key={r} className={`matrix-pixel${r === 2 || r === 4 ? ' on' : ''}`} />
      ))}
    </motion.div>
  );
}

/** LED dot-matrix hardware clock — each digit is a real 5×7 grid of dots. */
export default function DotMatrixClock({ time, weekday, dateLine, airLabel, live }: Props) {
  const { reducedMotion } = usePreferences();
  const safe = /^\d{2}:\d{2}$/.test(time) ? time : '--:--';
  const [hh, mm] = safe.split(':');

  return (
    <div className="matrix-display">
      <div className="matrix-time-row" aria-label={time}>
        <div className="matrix-grid">
          {hh.split('').map((d, i) => <Digit key={`h${i}`} char={d} />)}
          <Colon still={reducedMotion} />
          {mm.split('').map((d, i) => <Digit key={`m${i}`} char={d} />)}
        </div>
      </div>

      <p className="matrix-weekday">{weekday}</p>
      <p className="matrix-date">{dateLine}</p>

      <div className="matrix-status">
        <motion.span
          className="matrix-live-dot"
          style={{ background: live ? 'rgb(var(--hi-rgb))' : 'var(--text-muted)' }}
          animate={live && !reducedMotion
            ? { opacity: [1, 0.45, 1], scale: [1, 1.15, 1] }
            : { opacity: live ? 1 : 0.35 }}
          transition={live && !reducedMotion
            ? { duration: 2.2, repeat: Infinity, ease: 'easeInOut' }
            : { duration: 0 }}
        />
        <span className="matrix-status-text">{airLabel}</span>
      </div>
    </div>
  );
}
