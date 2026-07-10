import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import PressButton from './PressButton';
import { IconClose } from './icons';
import { api } from '../lib/api';
import { parseTapeItems, tapePlayUrl, type TapeItem } from '../lib/tape';
import { formatWallClock } from '../lib/live';
import { spring } from '../lib/motion';
import { useI18n } from '../context/PreferencesContext';

// 磁带回放 — the aired-programme ledger. Read-only history: time, what
// played, and the DJ's actual spoken lines. Tapping a playable row starts a
// LOCAL time-shift (the station keeps broadcasting); 「回到直播」 is always
// one tap away.

type Status = 'loading' | 'ok' | 'unavailable';

interface Props {
  open: boolean;
  onClose: () => void;
  /** True while the player is time-shifted. */
  tapeMode: boolean;
  /** Tape item currently playing (highlighted row). */
  activeId: string | null;
  onPlay: (item: TapeItem, items: TapeItem[]) => void;
  onBackToLive: () => void;
}

export default function TapeSheet({ open, onClose, tapeMode, activeId, onPlay, onBackToLive }: Props) {
  const { t } = useI18n();
  const [status, setStatus] = useState<Status>('loading');
  const [items, setItems] = useState<TapeItem[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let stop = false;
    setStatus('loading');
    api.tape(6)
      .then((r) => {
        if (stop) return;
        setItems(parseTapeItems(r));
        setStatus('ok');
      })
      .catch(() => { if (!stop) setStatus('unavailable'); });
    return () => { stop = true; };
  }, [open]);

  // The newest entry is the closest to the live edge — start there.
  useEffect(() => {
    if (!open || status !== 'ok') return;
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    });
  }, [open, status, items.length]);

  const label = (it: TapeItem): string => {
    if (it.type === 'song') return it.track?.title ?? '—';
    if (it.type === 'voicetrack') return t('tapeVoiceLabel');
    return t('tapeIdLabel');
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-30 backdrop-blur-md"
            style={{ background: 'var(--modal-overlay)' }}
            onClick={onClose}
          />
          <motion.section
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={spring.sheet}
            className="fixed left-0 right-0 bottom-0 z-40 mx-auto max-w-[460px]
              rounded-t-[28px] overflow-hidden glass-card
              flex flex-col max-h-[82vh]"
          >
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full opacity-30" style={{ background: 'var(--text-muted)' }} />
            </div>

            <div className="px-5 pb-3 flex justify-between items-center">
              <div>
                <h2 className="text-[16px] font-semibold">{t('tapeTitle')}</h2>
                <p className="text-[11px] text-[var(--text-muted)] font-mono mt-0.5">{t('tapeSubtitle')}</p>
              </div>
              <PressButton variant="icon" ariaLabel={t('ariaClose')} onClick={onClose} className="!w-9 !h-9">
                <IconClose size={18} />
              </PressButton>
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain scroll-panel px-4 pb-3 min-h-[200px]">
              {status === 'loading' && (
                <p className="py-10 text-center text-[12px] font-mono text-[var(--text-muted)]">{t('tapeLoading')}</p>
              )}
              {status === 'unavailable' && (
                <p className="py-10 text-center text-[12px] text-[var(--text-muted)] max-w-[260px] mx-auto leading-relaxed">
                  {t('tapeUnavailable')}
                </p>
              )}
              {status === 'ok' && items.length === 0 && (
                <p className="py-10 text-center text-[12px] text-[var(--text-muted)] max-w-[260px] mx-auto leading-relaxed">
                  {t('tapeEmpty')}
                </p>
              )}
              {status === 'ok' && items.length > 0 && (
                <div className="space-y-1">
                  {items.map((it) => {
                    const playable = !!tapePlayUrl(it);
                    const active = tapeMode && it.id === activeId;
                    return (
                      <button
                        key={it.id}
                        type="button"
                        disabled={!playable}
                        onClick={() => onPlay(it, items)}
                        className="tape-row w-full text-left"
                        style={{
                          opacity: playable ? 1 : 0.45,
                          borderColor: active ? 'rgba(var(--accent-rgb), 0.55)' : 'var(--glass-border)',
                          cursor: playable ? 'pointer' : 'default',
                        }}
                      >
                        <span className="tape-row-time">{formatWallClock(it.airStart, { seconds: false })}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] text-[var(--text-primary)]">
                            {label(it)}
                            {it.type === 'song' && it.track?.artist && (
                              <span className="text-[var(--text-muted)]"> · {it.track.artist}</span>
                            )}
                          </span>
                          {it.voice?.text && (
                            <span className="block text-[11px] leading-snug text-[var(--text-muted)] tape-row-say">
                              {it.voice.text}
                            </span>
                          )}
                        </span>
                        {active && (
                          <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.18em]" style={{ color: 'rgb(var(--accent-rgb))' }}>
                            {t('tapeMode')}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {tapeMode && (
              <div className="p-4 border-t" style={{ borderColor: 'var(--glass-border)', background: 'var(--inset-bg)' }}>
                <button
                  type="button"
                  className="w-full rounded-2xl py-2.5 text-[13px] font-medium"
                  style={{ background: 'rgba(var(--hi-rgb), 0.14)', color: 'rgb(var(--hi-rgb))' }}
                  onClick={onBackToLive}
                >
                  ● {t('backToLive')}
                </button>
              </div>
            )}
          </motion.section>
        </>
      )}
    </AnimatePresence>
  );
}
