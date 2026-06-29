import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export type PetState = 'idle' | 'playing' | 'talking';

interface Props {
  state: PetState;
  /** Pixel size (one sprite cell) in px. Sprite is 12 × 13 cells. */
  cell?: number;
}

/* 12×13 pixel sprite for "Auri" — a glowing little radio companion.
   . transparent · B body · S shade · L belly glow · E eye · G glint
   A antenna · T antenna tip · F feet */
const BASE = [
  '......T.....',
  '......A.....',
  '...SSSSSS...',
  '..SBBBBBBS..',
  '.SBBBBBBBBS.',
  '.SBEEBBEEBS.',
  '.SBGEBBGEBS.',
  '.SBBBBBBBBS.',
  '.SBLLLLLLBS.',
  '.SBLLLLLLBS.',
  '.SBBBBBBBBS.',
  '..SBBBBBBS..',
  '...FF..FF...',
];

const COLORS: Record<string, string> = {
  B: 'rgb(var(--accent-rgb))',
  S: 'rgba(var(--accent-rgb),0.42)',
  L: 'rgb(var(--hi-rgb))',
  E: 'rgba(10,7,5,0.82)',
  G: '#ffffff',
  A: 'rgba(var(--hi-rgb),0.85)',
  T: '#eafff2',
  F: 'rgba(var(--accent-rgb),0.42)',
};

function buildFrame(eyesClosed: boolean, mouthOpen: boolean): string[] {
  const rows = [...BASE];
  if (eyesClosed) {
    rows[5] = '.SBBBBBBBBS.';
    rows[6] = '.SBEEBBEEBS.';
  }
  if (mouthOpen) {
    rows[10] = '.SBBBEEBBBS.';
  }
  return rows;
}

export default function PixelPet({ state, cell = 3 }: Props) {
  const [eyesClosed, setEyesClosed] = useState(false);
  const [mouthOpen, setMouthOpen] = useState(false);

  // Occasional blink (paused while talking).
  useEffect(() => {
    if (state === 'talking') { setEyesClosed(false); return; }
    let t: number;
    const loop = () => {
      t = window.setTimeout(() => {
        setEyesClosed(true);
        window.setTimeout(() => setEyesClosed(false), 130);
        loop();
      }, 2400 + Math.random() * 2600);
    };
    loop();
    return () => clearTimeout(t);
  }, [state]);

  // Mouth chatter while talking.
  useEffect(() => {
    if (state !== 'talking') { setMouthOpen(false); return; }
    const id = window.setInterval(() => setMouthOpen((m) => !m), 190);
    return () => clearInterval(id);
  }, [state]);

  const frame = buildFrame(eyesClosed, mouthOpen);

  const cells = useMemo(() => {
    const out: { x: number; y: number; ch: string }[] = [];
    frame.forEach((row, y) =>
      row.split('').forEach((ch, x) => { if (ch !== '.') out.push({ x, y, ch }); }),
    );
    return out;
  }, [frame]);

  const w = 12 * cell;
  const h = 13 * cell;

  const bob =
    state === 'playing'
      ? { animate: { y: [0, -cell * 1.8, 0], scaleY: [1, 0.9, 1] }, transition: { duration: 0.5, repeat: Infinity, ease: 'easeInOut' as const } }
      : state === 'talking'
        ? { animate: { rotate: [-3, 3, -3], y: [0, -cell * 0.5, 0] }, transition: { duration: 0.6, repeat: Infinity, ease: 'easeInOut' as const } }
        : { animate: { y: [0, -cell * 0.9, 0] }, transition: { duration: 2.8, repeat: Infinity, ease: 'easeInOut' as const } };

  return (
    <div style={{ position: 'relative', width: w, height: h }} aria-hidden>
      {/* Sound rings while on air */}
      <AnimatePresence>
        {state === 'talking' && (
          <>
            {[0, 0.5].map((delay) => (
              <motion.span
                key={delay}
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: cell * 0.5,
                  width: cell * 3,
                  height: cell * 3,
                  marginLeft: -cell * 1.5,
                  borderRadius: '50%',
                  border: `${Math.max(1, cell * 0.5)}px solid rgba(var(--hi-rgb),0.6)`,
                }}
                initial={{ scale: 0.3, opacity: 0.7 }}
                animate={{ scale: 2.4, opacity: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 1.1, repeat: Infinity, ease: 'easeOut', delay }}
              />
            ))}
          </>
        )}
      </AnimatePresence>

      {/* Floating note while music plays */}
      <AnimatePresence>
        {state === 'playing' && (
          <motion.span
            style={{
              position: 'absolute',
              right: -cell,
              top: cell,
              width: cell * 1.4,
              height: cell * 1.4,
              borderRadius: 1,
              background: 'rgb(var(--hi-rgb))',
              boxShadow: '0 0 6px rgba(var(--hi-rgb),0.6)',
            }}
            initial={{ y: 0, opacity: 0 }}
            animate={{ y: [-2, -cell * 4], opacity: [0, 1, 0] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: 'easeOut' }}
          />
        )}
      </AnimatePresence>

      <motion.div
        style={{ position: 'absolute', inset: 0 }}
        animate={bob.animate}
        transition={bob.transition}
      >
        {cells.map(({ x, y, ch }) => (
          <span
            key={`${x}-${y}`}
            style={{
              position: 'absolute',
              left: x * cell,
              top: y * cell,
              width: cell + 0.5,
              height: cell + 0.5,
              background: COLORS[ch],
              boxShadow:
                ch === 'T'
                  ? `0 0 ${cell * 1.1}px rgba(var(--hi-rgb),0.85)`
                  : undefined,
            }}
          />
        ))}
      </motion.div>
    </div>
  );
}
