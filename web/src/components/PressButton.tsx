import { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { spring } from '../lib/motion';

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
  const base =
    variant === 'play' ? 'play-btn pressable' :
    variant === 'icon' ? 'pressable w-10 h-10 rounded-xl flex items-center justify-center transition-colors text-[var(--text-muted)] hover:text-[var(--text-primary)]' :
    variant === 'ghost' ? 'pressable transport' :
    variant === 'bar' ? 'pressable input-bar w-full text-left' :
    'pressable';

  return (
    <motion.button
      type="button"
      disabled={disabled}
      aria-label={ariaLabel}
      onClick={disabled ? undefined : onClick}
      className={`${base} ${className}`}
      style={variant === 'icon' ? { background: 'var(--inset-bg)', border: '1px solid var(--glass-border)' } : undefined}
      whileHover={disabled ? undefined : { scale: variant === 'play' ? 1.035 : variant === 'bar' ? 1.006 : 1.025 }}
      whileTap={disabled ? undefined : { scale: variant === 'play' ? 0.965 : variant === 'bar' ? 0.992 : 0.975 }}
      transition={spring.snappy}
    >
      <span className={
        variant === 'bar'
          ? 'relative z-10 flex items-center gap-2 w-full'
          : 'relative z-10 flex items-center justify-center'
      }>{children}</span>
    </motion.button>
  );
}
