/** Shared framer-motion presets — Apple-like springs */
export const spring = {
  snappy: { type: 'spring' as const, stiffness: 420, damping: 32, mass: 0.8 },
  gentle: { type: 'spring' as const, stiffness: 260, damping: 28, mass: 1 },
  sheet: { type: 'spring' as const, stiffness: 340, damping: 36, mass: 0.9 },
  soft: { type: 'spring' as const, stiffness: 180, damping: 26, mass: 1.1 },
};

export const fadeUp = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 },
  transition: spring.gentle,
};

export const stagger = (i: number) => ({
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  transition: { ...spring.gentle, delay: i * 0.06 },
});
