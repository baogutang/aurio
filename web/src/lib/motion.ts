/** Shared framer-motion presets — Apple-like springs */
export const spring = {
  snappy: { type: 'spring' as const, stiffness: 330, damping: 34, mass: 0.86 },
  gentle: { type: 'spring' as const, stiffness: 230, damping: 30, mass: 1 },
  sheet: { type: 'spring' as const, stiffness: 300, damping: 36, mass: 0.95 },
  soft: { type: 'spring' as const, stiffness: 170, damping: 28, mass: 1.1 },
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
