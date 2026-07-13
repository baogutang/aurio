import { motion, AnimatePresence } from 'framer-motion';
import PressButton from './PressButton';
import { IconClose } from './icons';
import { planRows, segmentAt, PLAN_TONES, type DayPlan } from '../lib/plan';
import { spring } from '../lib/motion';
import { useI18n } from '../context/PreferencesContext';

// 今日节目单 (P5-C) — the morning plan as a permanent broadcast rundown, not a
// todo list: the day note on top, then every segment (time range, label,
// reason) with its dial tone, quiet windows called out inline
// (「10:50–11:30 静默 · 11:00 的会」), and the segment on air right now
// highlighted. Same sheet conventions as TapeSheet. Only ever opened when a
// plan exists — no empty chrome on servers without /api/plan.

interface Props {
  open: boolean;
  onClose: () => void;
  plan: DayPlan | null;
  /** Station wall clock (Date.now() + skew). */
  serverNow: () => number;
}

export default function PlanSheet({ open, onClose, plan, serverNow }: Props) {
  const { t } = useI18n();
  const rows = plan ? planRows(plan) : [];
  const nowSeg = open ? segmentAt(plan, serverNow()) : null;

  return (
    <AnimatePresence>
      {open && plan && (
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
                <h2 className="text-[16px] font-semibold">{t('planSheetTitle')}</h2>
                <p className="text-[11px] text-[var(--text-muted)] font-mono mt-0.5">
                  {plan.date ? `${plan.date} · ` : ''}{t('planSheetSubtitle')}
                </p>
              </div>
              <PressButton variant="icon" ariaLabel={t('ariaClose')} onClick={onClose} className="!w-9 !h-9">
                <IconClose size={18} />
              </PressButton>
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain scroll-panel px-4 pb-4 min-h-[160px]">
              {plan.note && (
                <p className="plan-note mb-2.5">{plan.note}</p>
              )}

              {rows.length === 0 && (
                <p className="py-10 text-center text-[12px] text-[var(--text-muted)] max-w-[260px] mx-auto leading-relaxed">
                  {t('planEmptySegments')}
                </p>
              )}

              <div className="space-y-1">
                {rows.map((row, i) => {
                  if (row.type === 'quiet') {
                    const w = row.win;
                    return (
                      <div key={`q-${i}`} className="plan-row plan-row--quiet">
                        <span className="tape-row-time">{w.start}–{w.end}</span>
                        <span className="min-w-0 flex-1 text-[12px] text-[var(--text-muted)]">
                          <span className="plan-quiet-ring" aria-hidden />
                          {t('planQuietLabel')}
                          {w.reason && <span> · {w.reason}</span>}
                        </span>
                      </div>
                    );
                  }
                  const seg = row.seg;
                  const tone = PLAN_TONES[seg.kind];
                  const isNow = nowSeg === seg;
                  return (
                    <div
                      key={`s-${i}`}
                      className="plan-row"
                      style={isNow ? { borderColor: 'rgba(var(--accent-rgb), 0.55)' } : undefined}
                    >
                      <span className="tape-row-time">{seg.start}–{seg.end}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-[var(--text-primary)]">
                          <span
                            className="plan-kind-dot"
                            style={{ background: tone.dashed ? 'transparent' : tone.stroke, borderColor: tone.stroke, opacity: Math.min(1, tone.opacity + 0.25) }}
                            aria-hidden
                          />
                          {seg.label || seg.kind}
                        </span>
                        {seg.reason && (
                          <span className="block text-[11px] leading-snug text-[var(--text-muted)] tape-row-say">
                            {seg.reason}
                          </span>
                        )}
                      </span>
                      {isNow && (
                        <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.18em]" style={{ color: 'rgb(var(--accent-rgb))' }}>
                          {t('planNowTag')}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.section>
        </>
      )}
    </AnimatePresence>
  );
}
