import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { spring } from '../lib/motion';
import { useI18n } from '../context/PreferencesContext';

interface Props {
  netease?: boolean;
  navidrome?: boolean;
  qqmusic?: boolean;
  weather?: boolean;
  connected?: boolean;
}

export default function BootLog({ netease, navidrome, qqmusic, weather, connected }: Props) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(0);
  const prevConnected = useRef<boolean | undefined>(undefined);

  const lines = [
    { text: t('bootReady'), ok: true },
    { text: t('bootSync'), ok: null },
    { text: t('bootWaiting'), ok: null },
  ];

  const services = [
    { ok: netease, label: t('serviceNetease') },
    { ok: navidrome, label: t('serviceNavidrome') },
    { ok: qqmusic, label: t('serviceQQ') },
    { ok: weather, label: t('serviceWeather') },
  ];

  const total = lines.length + services.length + 1;

  useEffect(() => {
    const shouldAnimate = prevConnected.current === undefined
      || (connected === true && prevConnected.current === false);
    prevConnected.current = !!connected;

    if (!shouldAnimate) {
      setVisible(total);
      return;
    }

    setVisible(0);
    let i = 0;
    const timer = setInterval(() => {
      i += 1;
      setVisible(i);
      if (i >= total) clearInterval(timer);
    }, 180);
    return () => clearInterval(timer);
  }, [connected, total]);

  let idx = 0;

  return (
    <div className="space-y-2 font-mono text-[11px] leading-relaxed">
      {lines.map((line) => {
        const my = idx++;
        if (visible <= my) return null;
        return (
          <motion.p
            key={line.text}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={spring.soft}
            className="text-[var(--text-muted)]"
          >
            {line.text}
          </motion.p>
        );
      })}
      {services.map((s) => {
        const my = idx++;
        if (visible <= my) return null;
        return (
          <motion.div
            key={s.label}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center gap-2"
          >
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{
                background: s.ok ? 'rgb(var(--hi-rgb))' : 'var(--text-muted)',
                boxShadow: s.ok ? '0 0 8px rgba(var(--hi-rgb), 0.6)' : undefined,
                opacity: s.ok ? 1 : 0.35,
              }}
            />
            <span style={{ color: s.ok ? 'rgb(var(--hi-rgb))' : 'var(--text-muted)' }}>{s.label}</span>
          </motion.div>
        );
      })}
      {visible > idx && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-[var(--text-muted)] pt-1"
        >
          {connected ? t('bootConnected') : t('bootConnecting')}
        </motion.p>
      )}
    </div>
  );
}
