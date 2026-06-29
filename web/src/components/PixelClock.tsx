import { AnimatePresence, motion } from 'framer-motion';
import { spring } from '../lib/motion';

interface Props {
  time: string;
  className?: string;
}

export function FlipDigits({ time, className = '' }: Props) {
  const safe = /^\d{2}:\d{2}$/.test(time) ? time : '--:--';
  const [hh, mm] = safe.split(':');

  return (
    <div className={`relative select-none py-1 ${className}`}>
      <motion.div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[115%] h-[140%] rounded-[40px] pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse, rgba(var(--hi-rgb), .16) 0%, rgba(var(--accent-rgb), .08) 45%, transparent 72%)',
        }}
        animate={{ scale: [1, 1.03, 1], opacity: [0.65, 1, 0.65] }}
        transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
      />

      <div className="relative flex items-center justify-center gap-1.5">
        {hh.split('').map((d, i) => (
          <DigitCard key={`h${i}`} value={d} />
        ))}
        <Separator />
        {mm.split('').map((d, i) => (
          <DigitCard key={`m${i}`} value={d} />
        ))}
      </div>
    </div>
  );
}

function DigitCard({ value }: { value: string }) {
  return (
    <div className="clock-digit-card">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={value}
          initial={{ y: 18, opacity: 0, rotateX: -70, filter: 'blur(4px)' }}
          animate={{ y: 0, opacity: 1, rotateX: 0, filter: 'blur(0px)' }}
          exit={{ y: -18, opacity: 0, rotateX: 70, filter: 'blur(4px)' }}
          transition={spring.snappy}
          className="clock-digit-inner"
          style={{ transformPerspective: 600 }}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}

function Separator() {
  return (
    <motion.div
      className="flex flex-col gap-2 px-0.5 pb-3 self-center"
      animate={{ opacity: [0.25, 0.85, 0.25] }}
      transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
    >
      <span className="w-1.5 h-1.5 rounded-full shadow-[0_0_10px_rgba(var(--accent-rgb),.55)]" style={{ background: 'rgb(var(--accent-rgb))' }} />
      <span className="w-1.5 h-1.5 rounded-full shadow-[0_0_10px_rgba(var(--accent-rgb),.55)]" style={{ background: 'rgb(var(--accent-rgb))' }} />
    </motion.div>
  );
}

export default function PixelClock({ time }: Props) {
  return <FlipDigits time={time} />;
}
