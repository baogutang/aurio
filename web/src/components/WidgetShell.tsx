import { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { spring } from '../lib/motion';

interface Props {
  children: ReactNode;
}

/** Floating hardware-widget card — dot-grid shell */
export default function WidgetShell({ children }: Props) {
  return (
    <div className="app-frame">
      <motion.div
        initial={{ opacity: 0, scale: 0.99 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={spring.gentle}
        className="app-card dot-grid-shell"
      >
        <div className="widget-drag flex justify-center pt-2.5 pb-1 shrink-0">
          <div className="w-10 h-0.5 rounded-full opacity-25" style={{ background: 'var(--matrix-fg)' }} />
        </div>

        <div className="app-card-body flex flex-col gap-2.5 px-3 pb-3.5 pt-0.5 flex-1 min-h-0">
          {children}
        </div>
      </motion.div>
    </div>
  );
}
