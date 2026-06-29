import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { renderSay } from '../lib/highlight';
import { spring } from '../lib/motion';
import { useI18n } from '../context/PreferencesContext';
import PressButton from './PressButton';
import { IconClose, IconSend } from './icons';
import type { ChatMsg } from '../lib/types';

interface Props {
  open: boolean;
  onClose: () => void;
  messages: ChatMsg[];
  onSend: (text: string) => void;
  onTrigger: (kind: string) => void;
}

export default function ChatSheet({ open, onClose, messages, onSend, onTrigger }: Props) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const quick = [
    { kind: 'morning', label: t('quickMorning') },
    { kind: 'plan', label: t('quickPlan') },
    { kind: 'mood', label: t('quickMood') },
  ];

  useEffect(() => {
    const el = scrollRef.current;
    if (!open || !el || !stickToBottom.current) return;
    el.scrollTop = el.scrollHeight;
  }, [open, messages]);

  useEffect(() => {
    if (!open) return;
    stickToBottom.current = true;
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    });
  }, [open]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  const send = () => {
    const v = text.trim();
    if (!v) return;
    setText('');
    onSend(v);
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
              flex flex-col max-h-[88vh]"
          >
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full opacity-30" style={{ background: 'var(--text-muted)' }} />
            </div>

            <div className="px-5 pb-3 flex justify-between items-center">
              <div>
                <h2 className="text-[16px] font-semibold">{t('chatTitle')}</h2>
                <p className="text-[11px] text-[var(--text-muted)] font-mono mt-0.5">{t('chatSubtitle')}</p>
              </div>
              <PressButton variant="icon" ariaLabel={t('ariaClose')} onClick={onClose} className="!w-9 !h-9">
                <IconClose size={18} />
              </PressButton>
            </div>

            <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto overscroll-contain scroll-panel px-5 py-2 space-y-3 min-h-[240px]">
              {messages.length === 0 ? (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="py-10 text-center"
                >
                  <div className="w-14 h-14 mx-auto rounded-2xl flex items-center justify-center text-2xl mb-3" style={{ background: 'var(--inset-bg)' }}>💬</div>
                  <p className="text-sm text-[var(--text-muted)] max-w-[240px] mx-auto leading-relaxed">
                    {t('chatEmpty')}
                  </p>
                </motion.div>
              ) : (
                messages.map((m, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 12, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ ...spring.gentle, delay: Math.min(i * 0.03, 0.15) }}
                    className={`max-w-[88%] px-4 py-2.5 text-sm leading-relaxed ${
                      m.role === 'user'
                        ? 'chat-bubble-user self-end ml-auto'
                        : 'chat-bubble-dj self-start'
                    }`}
                  >
                    {m.role === 'dj' ? renderSay(m.text, 'dark') : m.text}
                  </motion.div>
                ))
              )}
            </div>

            <div className="p-4 border-t space-y-3" style={{ borderColor: 'var(--glass-border)', background: 'var(--inset-bg)' }}>
              <div className="flex gap-2 flex-wrap">
                {quick.map((q) => (
                  <PressButton key={q.kind} onClick={() => onTrigger(q.kind)} className="pill-btn !py-1.5 !text-[12px]">
                    {q.label}
                  </PressButton>
                ))}
              </div>
              <div className="flex gap-2 items-center">
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') send(); if (e.key === 'Escape') onClose(); }}
                  placeholder={t('chatPlaceholder')}
                  className="field flex-1"
                  autoFocus
                />
                <PressButton
                  variant="play"
                  ariaLabel={t('ariaSend')}
                  onClick={send}
                  disabled={!text.trim()}
                  className="!w-11 !h-11 !min-w-[44px] disabled:opacity-35"
                >
                  <IconSend size={16} />
                </PressButton>
              </div>
            </div>
          </motion.section>
        </>
      )}
    </AnimatePresence>
  );
}
