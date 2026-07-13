import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { renderSay } from '../lib/highlight';
import { spring } from '../lib/motion';
import { transcriptTime } from '../lib/live';
import { cardState } from '../lib/songCards';
import { useI18n } from '../context/PreferencesContext';
import PressButton from './PressButton';
import { IconClose, IconSend } from './icons';
import type { ChatMsg, SongCard, Track } from '../lib/types';

interface Props {
  open: boolean;
  onClose: () => void;
  messages: ChatMsg[];
  onSend: (text: string) => void;
  onTrigger: (kind: string) => void;
  busy?: boolean;
  onGoAir?: () => void;
  isObserver?: boolean;
  /** Hotline state line (点歌已记下) shown under the latest reply. */
  notice?: string | null;
  /** Fired when the user focuses or types in the input — cancels auto-close. */
  onInputActivity?: () => void;
  /** On-air track + upcoming programme, for song-card states (P5-D). */
  currentTrack?: Track | null;
  upNext?: Track[];
  /** Tap a song card = 「现在就放这首」 (the urgent hotline channel). */
  onPlayCard?: (card: SongCard) => void;
}

// One DJ line as a studio-logbook row: mono HH:MM stamp, quiet text, and the
// tracks the reply landed rendered as tappable cards (P5-D 转写流 / 对话歌卡).
function TranscriptRow({ msg, busy, currentTrack, upNext, onPlayCard }: {
  msg: ChatMsg;
  busy: boolean;
  currentTrack: Track | null;
  upNext: Track[];
  onPlayCard?: (card: SongCard) => void;
}) {
  const { t } = useI18n();
  const time = transcriptTime(msg.ts);
  return (
    <div className="transcript-row">
      <span className="transcript-time" aria-hidden>{time ?? ''}</span>
      <div className="transcript-body min-w-0 flex-1">
        {msg.text && (
          <p className="text-[13px] leading-relaxed text-[var(--text-secondary)]">
            {renderSay(msg.text, 'dark')}
          </p>
        )}
        {!!msg.tracks?.length && (
          <div className={`space-y-1 ${msg.text ? 'mt-1.5' : ''}`}>
            {msg.tracks.map((card, i) => {
              const state = cardState(card, currentTrack, upNext);
              const tappable = !!onPlayCard && state !== 'playing' && !busy;
              return (
                <button
                  key={`${card.source}-${card.id}-${i}`}
                  type="button"
                  disabled={!tappable}
                  title={tappable ? t('songCardTapHint') : undefined}
                  aria-label={`${card.title} · ${card.artist}${tappable ? ` — ${t('songCardTapHint')}` : ''}`}
                  className={`song-card ${state === 'playing' ? 'is-playing' : ''}`}
                  onClick={() => onPlayCard?.(card)}
                >
                  <span className="truncate text-[13px] text-[var(--text-primary)] flex-1 min-w-0">
                    {card.title}
                  </span>
                  {card.artist && (
                    <span className="truncate text-[11px] text-[var(--text-muted)] max-w-[36%] shrink-0">
                      {card.artist}
                    </span>
                  )}
                  <span
                    className="song-card-state shrink-0"
                    style={state === 'playing' ? { color: 'rgb(var(--hi-rgb))' } : undefined}
                  >
                    {state === 'playing' ? t('onAir') : state === 'queued' ? t('songCardQueued') : '▸'}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ChatSheet({
  open, onClose, messages, onSend, onTrigger, busy = false, onGoAir, isObserver = false,
  notice = null, onInputActivity, currentTrack = null, upNext = [], onPlayCard,
}: Props) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const quick = [
    { kind: 'morning', label: t('quickMorning') },
    { kind: 'plan', label: t('quickPlan') },
    { kind: 'mood', label: t('quickMood') },
    { kind: 'station', label: t('quickStation') },
  ];

  useEffect(() => {
    const el = scrollRef.current;
    if (!open || !el || !stickToBottom.current) return;
    el.scrollTop = el.scrollHeight;
  }, [open, messages, busy, notice]);

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
              {messages.length === 0 && !busy ? (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="py-10 text-center"
                >
                  <div className="w-14 h-14 mx-auto rounded-2xl flex items-center justify-center text-2xl mb-3" style={{ background: 'var(--inset-bg)' }}>💬</div>
                  <p className="text-sm text-[var(--text-muted)] max-w-[240px] mx-auto leading-relaxed">
                    {t('chatEmpty')}
                  </p>
                  {onGoAir && (
                    <button
                      type="button"
                      className="mt-4 px-5 py-2 rounded-2xl text-[12px] font-medium"
                      style={{ background: 'rgb(var(--accent-rgb) / 0.12)', color: 'rgb(var(--accent-rgb))' }}
                      onClick={onGoAir}
                    >
                      {t('goOnAir')}
                    </button>
                  )}
                </motion.div>
              ) : (
                <>
                {messages.map((m, i) => (
                  m.role === 'user' ? (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 12, scale: 0.96 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ ...spring.gentle, delay: Math.min(i * 0.03, 0.15) }}
                      className="chat-bubble-user self-end ml-auto max-w-[88%] px-4 py-2.5 text-sm leading-relaxed"
                    >
                      {m.text}
                    </motion.div>
                  ) : (
                    // DJ lines read as a broadcast logbook, not chat bubbles.
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ ...spring.gentle, delay: Math.min(i * 0.03, 0.15) }}
                    >
                      <TranscriptRow
                        msg={m}
                        busy={busy}
                        currentTrack={currentTrack}
                        upNext={upNext}
                        onPlayCard={isObserver ? undefined : onPlayCard}
                      />
                    </motion.div>
                  )
                ))}
                {busy && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={spring.gentle}
                    className="transcript-row"
                  >
                    <span className="transcript-time" aria-hidden />
                    <div className="transcript-body text-[13px] leading-relaxed text-[var(--text-secondary)]">
                      <span>{t('chatThinking')}</span>
                      <span className="typing-dots ml-2" aria-hidden>
                        <span />
                        <span />
                        <span />
                      </span>
                    </div>
                  </motion.div>
                )}
                {notice && !busy && (
                  <motion.p
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={spring.gentle}
                    className="text-center text-[11px] font-mono py-1"
                    style={{ color: 'rgb(var(--accent-rgb))' }}
                    role="status"
                  >
                    {notice}
                  </motion.p>
                )}
                </>
              )}
            </div>

            <div className="p-4 border-t space-y-3" style={{ borderColor: 'var(--glass-border)', background: 'var(--inset-bg)' }}>
              {isObserver ? (
                <p className="text-[12px] text-[var(--text-muted)] text-center py-2">{t('chatObserver')}</p>
              ) : (
              <>
              <div className="flex gap-2 flex-wrap">
                {quick.map((q) => (
                  <PressButton key={q.kind} onClick={() => onTrigger(q.kind)} disabled={busy} className="pill-btn !py-1.5 !text-[12px] disabled:opacity-40">
                    {q.label}
                  </PressButton>
                ))}
              </div>
              <div className="flex gap-2 items-center">
                <input
                  value={text}
                  onChange={(e) => { setText(e.target.value); onInputActivity?.(); }}
                  onFocus={() => onInputActivity?.()}
                  onKeyDown={(e) => { if (e.key === 'Enter') send(); if (e.key === 'Escape') onClose(); }}
                  placeholder={t('chatPlaceholder')}
                  className="field flex-1"
                  autoFocus
                />
                <PressButton
                  variant="play"
                  ariaLabel={t('ariaSend')}
                  onClick={send}
                  disabled={busy || !text.trim()}
                  className="!w-11 !h-11 !min-w-[44px] disabled:opacity-35"
                >
                  <IconSend size={16} />
                </PressButton>
              </div>
              </>
              )}
            </div>
          </motion.section>
        </>
      )}
    </AnimatePresence>
  );
}
