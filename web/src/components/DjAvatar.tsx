import { motion } from 'framer-motion';

interface Props {
  size?: 'sm' | 'md';
  pulse?: boolean;
}

export default function DjAvatar({ size = 'sm', pulse = false }: Props) {
  const dim = size === 'sm' ? 'w-7 h-7' : 'w-9 h-9';
  const text = size === 'sm' ? 'text-[11px]' : 'text-sm';

  return (
    <motion.div
      className={`relative flex-none ${dim} rounded-full bg-gradient-to-br from-accent to-[#ff8f6b] flex items-center justify-center shadow-[0_0_16px_rgba(255,106,61,.35)]`}
      animate={pulse ? { scale: [1, 1.06, 1] } : undefined}
      transition={pulse ? { duration: 2, repeat: Infinity, ease: 'easeInOut' } : undefined}
    >
      <span className={`${text} select-none`}>🎙</span>
      {pulse && (
        <span className="absolute inset-0 rounded-full border border-accent/40 animate-pulse-glow" />
      )}
    </motion.div>
  );
}
