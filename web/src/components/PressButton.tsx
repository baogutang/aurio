import { useState, useCallback, ReactNode, MouseEvent } from 'react';
import { motion } from 'framer-motion';
import { spring } from '../lib/motion';

interface Ripple {
  id: number;
  x: number;
  y: number;
}

interface Props {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
  ariaLabel?: string;
  variant?: 'default' | 'play' | 'ghost' | 'icon' | 'bar';
}

export default function PressButton({
  children, onClick, className = '', disabled, ariaLabel, variant = 'default',
}: Props) {
  const [ripples, setRipples] = useState<Ripple[]>([]);

  const handleClick = useCallback((e: MouseEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const id = Date.now();
    setRipples((r) => [...r, { id, x: e.clientX - rect.left, y: e.clientY - rect.top }]);
    setTimeout(() => setRipples((r) => r.filter((x) => x.id !== id)), 600);
    onClick?.();
  }, [disabled, onClick]);

  const base =
    variant === 'play' ? 'play-btn relative overflow-hidden' :
    variant === 'icon' ? 'relative overflow-hidden w-10 h-10 rounded-xl flex items-center justify-center transition-colors text-[var(--text-muted)] hover:text-[var(--text-primary)]' :
    variant === 'ghost' ? 'relative overflow-hidden transport' :
    variant === 'bar' ? 'input-bar relative overflow-hidden w-full text-left' :
    'relative overflow-hidden';

  return (
    <motion.button
      type="button"
      disabled={disabled}
      aria-label={ariaLabel}
      onClick={handleClick}
      className={`${base} ${className}`}
      style={variant === 'icon' ? { background: 'var(--inset-bg)', border: '1px solid var(--glass-border)' } : undefined}
      whileHover={disabled ? undefined : { scale: variant === 'play' ? 1.06 : variant === 'bar' ? 1.01 : 1.05 }}
      whileTap={disabled ? undefined : { scale: variant === 'play' ? 0.92 : variant === 'bar' ? 0.98 : 0.94 }}
      transition={spring.snappy}
    >
      {ripples.map((r) => (
        <motion.span
          key={r.id}
          className="absolute rounded-full pointer-events-none"
          style={{
            left: r.x,
            top: r.y,
            width: 8,
            height: 8,
            marginLeft: -4,
            marginTop: -4,
            background: variant === 'play' ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.25)',
          }}
          initial={{ scale: 0, opacity: 0.8 }}
          animate={{ scale: 12, opacity: 0 }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        />
      ))}
      <span className="relative z-10 flex items-center justify-center gap-2 w-full">{children}</span>
    </motion.button>
  );
}
