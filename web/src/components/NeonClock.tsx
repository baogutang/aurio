import { motion } from 'framer-motion';

interface Props {
  time: string;
  weekday: string;
  dateLine: string;
  airLabel: string;
  live: boolean;
}

/** Cyberpunk neon-glow clock — flickering tube digits over a synthwave grid. */
export default function NeonClock({ time, weekday, dateLine, airLabel, live }: Props) {
  const safe = /^\d{2}:\d{2}$/.test(time) ? time : '--:--';
  const [hh, mm] = safe.split(':');

  return (
    <div className="neon-display">
      <div className="neon-grid" aria-hidden />
      <div className="neon-scan" aria-hidden />

      <div className="neon-time-row" aria-label={time}>
        <motion.span
          className="neon-time"
          animate={{ opacity: [1, 0.82, 1, 0.92, 1] }}
          transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut', times: [0, 0.12, 0.2, 0.7, 1] }}
        >
          {hh}
        </motion.span>
        <motion.span
          className="neon-sep"
          animate={{ opacity: [1, 0.15, 1] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
        >
          :
        </motion.span>
        <motion.span
          className="neon-time neon-time--alt"
          animate={{ opacity: [1, 0.9, 1, 0.8, 1] }}
          transition={{ duration: 3.3, repeat: Infinity, ease: 'easeInOut', times: [0, 0.5, 0.6, 0.66, 1] }}
        >
          {mm}
        </motion.span>
      </div>

      <p className="neon-weekday">{weekday}</p>
      <p className="neon-date">{dateLine}</p>

      <div className="neon-status">
        <motion.span
          className="neon-live-dot"
          animate={live ? { opacity: [1, 0.35, 1], scale: [1, 1.25, 1] } : { opacity: 0.4 }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
        />
        <span className="neon-status-text">{airLabel}</span>
      </div>
    </div>
  );
}
