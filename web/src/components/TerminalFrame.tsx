import { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { spring } from '../lib/motion';

interface Props {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
  variant?: 'glass' | 'light';
  delay?: number;
}

/** Premium glass / light card shell — Apple-like rounded rect */
export default function TerminalFrame({
  title, subtitle, children, className = '', variant = 'glass', delay = 0,
}: Props) {
  const shell = variant === 'light' ? 'glass-light' : 'glass-card';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ ...spring.gentle, delay }}
      className={`${shell} overflow-hidden ${className}`}
    >
      {title && (
        <div className={`px-5 pt-4 pb-1 ${variant === 'light' ? 'text-inksoft' : 'text-white/45'}`}>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em]">{title}</p>
          {subtitle && (
            <p className={`text-[13px] mt-0.5 font-medium ${variant === 'light' ? 'text-ink' : 'text-white/80'}`}>
              {subtitle}
            </p>
          )}
        </div>
      )}
      <div className="p-5 pt-3">{children}</div>
    </motion.div>
  );
}
