import { motion, AnimatePresence } from 'framer-motion';
import { spring } from '../lib/motion';
import { usePreferences } from '../context/PreferencesContext';

// Lightweight first-run guide. Each step opens the settings center directly to
// the relevant panel; "完成/跳过" persists the ONBOARDED flag and dismisses.
export type OnboardGroup = 'ai' | 'ncm' | 'fish';

export default function Onboarding({ open, onOpenGroup, onFinish }: {
  open: boolean;
  onOpenGroup: (g: OnboardGroup) => void;
  onFinish: () => void;
}) {
  const { tr: t } = usePreferences();
  const steps: { g: OnboardGroup; title: string; desc: string }[] = [
    { g: 'ai', title: t('obStepAITitle'), desc: t('obStepAIDesc') },
    { g: 'ncm', title: t('obStepMusicTitle'), desc: t('obStepMusicDesc') },
    { g: 'fish', title: t('obStepVoiceTitle'), desc: t('obStepVoiceDesc') },
  ];

  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 backdrop-blur-md flex items-end sm:items-center justify-center z-40 p-4"
          style={{ background: 'var(--modal-overlay)' }}>
          <motion.div initial={{ opacity: 0, y: 40, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 30, scale: 0.97 }} transition={spring.sheet}
            className="glass-card w-full max-w-[400px] rounded-[24px]">
            <div className="p-5 space-y-4">
              <div>
                <h2 className="text-[18px] font-semibold">{t('obWelcome')}</h2>
                <p className="text-[12px] text-[var(--text-muted)] mt-1 leading-relaxed">{t('obSubtitle')}</p>
              </div>

              <div className="space-y-2">
                {steps.map((s) => (
                  <button key={s.g} onClick={() => onOpenGroup(s.g)}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-left transition-all hover:brightness-110"
                    style={{ background: 'var(--inset-bg)', border: '1px solid var(--glass-border)' }}>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-[var(--text-primary)]">{s.title}</p>
                      <p className="text-[11px] text-[var(--text-muted)] mt-0.5 truncate">{s.desc}</p>
                    </div>
                    <span className="text-[11px] font-mono shrink-0" style={{ color: 'rgb(var(--hi-rgb))' }}>{t('obConfigure')}</span>
                  </button>
                ))}
              </div>

              <div className="space-y-2 pt-1">
                <button onClick={onFinish} className="pill-btn pill-btn-active w-full !py-3">{t('obFinish')}</button>
                <button onClick={onFinish} className="w-full text-[12px] text-[var(--text-muted)] hover:text-[var(--text-primary)] py-1">{t('obSkip')}</button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
