import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import PressButton from './PressButton';
import PixelPet, { type PetState } from './PixelPet';
import { IconClose } from './icons';
import { api } from '../lib/api';
import { deriveStyleTags } from '../lib/stationCard';
import { uptimeParts, fillTemplate } from '../lib/live';
import { spring } from '../lib/motion';
import { useI18n } from '../context/PreferencesContext';
import { CALL_SIGN, type StationTuning } from '../lib/station';

// 台卡 (station profile card, P5-D) — the station's face. Avatar, callsign +
// dial frequency, a bio in the station's own voice, the honest stat line and
// the style tags it has learned about you. Everything degrades: no profile →
// a quiet "still getting to know you" note, no uptime field → line hidden.

interface Props {
  open: boolean;
  onClose: () => void;
  station: StationTuning;
  petState: PetState;
  /** Honest listener count (self included); floors at 1 — you are here. */
  listeners: number;
  stationStartedAt?: number | null;
  serverNow?: () => number;
}

export default function StationCard({
  open, onClose, station, petState, listeners, stationStartedAt = null, serverNow,
}: Props) {
  const { t } = useI18n();
  const [tags, setTags] = useState<string[] | null>(null); // null = loading

  useEffect(() => {
    if (!open) return;
    let stop = false;
    setTags(null);
    api.profile()
      .then((r) => { if (!stop) setTags(deriveStyleTags(r?.exists ? r.profile : '')); })
      .catch(() => { if (!stop) setTags([]); });
    return () => { stop = true; };
  }, [open]);

  const uptime = uptimeParts(stationStartedAt, (serverNow ?? Date.now)());
  const statLine = fillTemplate(t('stationStatLine'), {
    g: tags?.length ? tags.length : '∞',
    n: Math.max(1, listeners),
  });

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
            aria-label={t('stationCardTitle')}
            className="fixed left-0 right-0 bottom-0 z-40 mx-auto max-w-[460px]
              rounded-t-[28px] overflow-hidden glass-card
              flex flex-col max-h-[82vh]"
          >
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full opacity-30" style={{ background: 'var(--text-muted)' }} />
            </div>

            <div className="px-5 pb-3 flex justify-between items-center">
              <div>
                <h2 className="text-[16px] font-semibold">{t('stationCardTitle')}</h2>
                <p className="text-[11px] text-[var(--text-muted)] font-mono mt-0.5">{t('stationCardSubtitle')}</p>
              </div>
              <PressButton variant="icon" ariaLabel={t('ariaClose')} onClick={onClose} className="!w-9 !h-9">
                <IconClose size={18} />
              </PressButton>
            </div>

            <div className="overflow-y-auto overscroll-contain scroll-panel px-5 pb-6">
              {/* Identity block: the mascot IS the avatar; the dial line IS the name. */}
              <div className="panel-dot p-4 flex items-center gap-3.5">
                <div className="header-avatar !w-[4.2rem] !h-[4.2rem] shrink-0" aria-hidden>
                  <PixelPet state={petState} cell={5} />
                </div>
                <div className="min-w-0">
                  <p className="font-matrix text-[22px] leading-none lowercase text-[var(--matrix-fg)] tracking-[0.02em]">
                    {CALL_SIGN.toLowerCase()}
                  </p>
                  <p className="mt-1.5 font-mono text-[11px] tracking-[0.14em] text-[var(--text-muted)]">
                    {CALL_SIGN} {station.freq} FM
                  </p>
                </div>
                <span
                  className="ml-auto shrink-0 font-mono text-[9px] uppercase tracking-[0.2em]"
                  style={{ color: 'rgb(var(--hi-rgb))' }}
                >
                  {t('onAir')}
                </span>
              </div>

              {/* Bio — brand copy, in the station's own voice. */}
              <p className="mt-4 text-[14px] leading-relaxed text-[var(--text-secondary)]">
                {t('stationBio')}
              </p>

              {/* Stat line + honest uptime. 曲库 N is not exposed by any API
                  yet, so the middle stat is GENRES (vision §六B-D). */}
              <p className="mt-4 font-mono text-[10px] tracking-[0.14em] text-[var(--text-muted)] uppercase">
                {statLine}
              </p>
              {uptime && (
                <p className="mt-1 font-mono text-[9px] text-[var(--text-muted)] tracking-[0.08em]">
                  {fillTemplate(t('uptimeLine'), { h: uptime.hours, m: uptime.minutes })}
                </p>
              )}

              {/* Style tags from the taste profile; an empty answer is honest. */}
              <div className="mt-4 pt-3 border-t" style={{ borderColor: 'var(--glass-border)' }}>
                <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-[var(--text-muted)] mb-2">
                  {t('stationTagsLabel')}
                </p>
                {tags === null ? (
                  <p className="text-[11px] font-mono text-[var(--text-muted)]">…</p>
                ) : tags.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {tags.map((tag) => (
                      <span key={tag} className="header-pill !cursor-default !normal-case !tracking-[0.04em]">
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-[12px] leading-relaxed text-[var(--text-muted)]">
                    {t('stationTagsEmpty')}
                  </p>
                )}
              </div>
            </div>
          </motion.section>
        </>
      )}
    </AnimatePresence>
  );
}
