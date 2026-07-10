import { motion, AnimatePresence } from 'framer-motion';
import DotMatrixClock from './DotMatrixClock';
import Spectrum from './Spectrum';
import Lyrics from './Lyrics';
import UpNext from './UpNext';
import { renderSay } from '../lib/highlight';
import { spring } from '../lib/motion';
import { usePreferences } from '../context/PreferencesContext';
import type { NowDisplay } from '../lib/dateFormat';
import type { Track } from '../lib/types';
import type { StationMood } from '../lib/station';

interface Props {
  track: Track | null;
  progress: number;
  cur: string;
  dur: string;
  say: string;
  /** 0..1 fraction of the say text revealed while the DJ voice plays; null shows it whole. */
  sayReveal?: number | null;
  now: NowDisplay;
  playing: boolean;
  talking?: boolean;
  conn: 'on' | 'busy' | '';
  onSeek: (e: React.MouseEvent<HTMLDivElement>) => void;
  audioRef: React.RefObject<HTMLAudioElement>;
  queue?: Track[];
  queueIndex?: number;
  onPick?: (index: number) => void;
  onReorder?: (next: Track[]) => void;
  onRemove?: (index: number) => void;
  onClear?: () => void;
  onSteer?: (text: string, mood: StationMood) => void;
  onTrigger?: (kind: string) => void;
  onResume?: () => void;
  isObserver?: boolean;
  controlsDisabled?: boolean;
  tasteLine?: string;
  planNote?: string;
  queueTotal?: number;
}

export default function MainCard({
  track, progress, cur, dur, say, sayReveal = null, now, playing, talking = false,
  conn, onSeek, audioRef,
  queue = [], queueIndex = -1, onPick, onReorder, onRemove, onClear,
  onSteer, onTrigger, onResume, isObserver = false, controlsDisabled = false,
  tasteLine = '', planNote = '', queueTotal = 0,
}: Props) {
  const { tr: t, resolved, reducedMotion } = usePreferences();
  const sayTheme = resolved === 'light' ? 'card' : 'dark';
  const live = conn === 'on' || conn === 'busy';
  const airLabel = conn === 'on' ? t('onAir') : conn === 'busy' ? t('busy') : t('standby');
  const upNext = queue.slice(queueIndex + 1);
  const sourceLabel = track?.source === 'navidrome'
    ? t('sourceNas')
    : track?.source === 'qqmusic'
      ? t('sourceQQ')
      : t('sourceNetease');

  const steerChips: { mood: StationMood; label: string; text: string }[] = [
    { mood: 'calm', label: t('steerCalm'), text: t('steerPayloadCalm') },
    { mood: 'energy', label: t('steerEnergy'), text: t('steerPayloadEnergy') },
    { mood: 'similar', label: t('steerSimilar'), text: t('steerPayloadSimilar') },
    { mood: 'ban', label: t('steerBan'), text: t('steerPayloadBan') },
  ];

  const steerRow = onSteer && !isObserver && (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {steerChips.map((chip) => (
        <button
          key={chip.mood}
          type="button"
          className="header-pill text-[10px] disabled:opacity-40"
          disabled={controlsDisabled}
          onClick={() => onSteer(chip.text, chip.mood)}
        >
          {chip.label}
        </button>
      ))}
    </div>
  );

  return (
    <AnimatePresence mode="wait">
      {track ? (
        <motion.div
          key="play"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={spring.gentle}
          className="panel-dot main-card main-card--play"
        >
          <div className="flex items-center justify-between mb-3 shrink-0">
            <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--text-muted)]">
              {sourceLabel}
            </span>
            <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-[rgb(var(--hi-rgb))]">
              {airLabel}
            </span>
          </div>

          <div className="play-card-scroll scroll-panel">
            {tasteLine && (
              <p className="mb-2 text-[10px] font-mono text-[rgb(var(--hi-rgb))] px-2 py-1 rounded-lg"
                style={{ background: 'var(--inset-bg)', border: '1px solid var(--glass-border)' }}>
                {t('tasteLearning')}: {tasteLine}
              </p>
            )}
            {isObserver && (
              <p className="mb-2 text-[11px] font-mono text-[var(--text-muted)] px-2 py-1.5 rounded-xl"
                style={{ background: 'var(--inset-bg)', border: '1px solid var(--glass-border)' }}>
                {t('observerBanner')}
              </p>
            )}
            <Spectrum audioRef={audioRef} height={108} dimmed={talking} />

            <motion.h1
              key={track.title}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-3 font-matrix text-[1.28rem] font-bold leading-snug line-clamp-2 text-[var(--text-primary)] tracking-[0.02em]"
            >
              {track.title}
            </motion.h1>
            <p className="mt-0.5 text-xs text-[var(--text-muted)] truncate">
              {[track.artist, track.album].filter(Boolean).join(' · ')}
            </p>

            <div className="mt-2.5 rounded-xl px-3 py-2 text-[11px] leading-relaxed text-[var(--text-secondary)]"
              style={{ background: 'var(--glass)', border: '1px solid var(--glass-border)' }}>
              <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--text-muted)] block mb-1">{t('whyThis')}</span>
              {track.reason || t('reasonFallback')}
            </div>

            <div className="mt-3">
              <div className="progress-track" onClick={onSeek} role="slider" aria-valuenow={progress}>
                <div className="progress-fill" style={{ width: `${progress}%` }} />
              </div>
              <div className="flex justify-between mt-1.5 font-mono text-[10px] text-[var(--text-muted)] tabular-nums">
                <span>{cur}</span>
                <span>{dur}</span>
              </div>
            </div>

            <div className="mt-2.5">
              <Lyrics track={track} audioRef={audioRef} />
            </div>

            <div className="mt-3 pt-3 border-t" style={{ borderColor: 'var(--glass-border)' }}>
              <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-[var(--text-muted)] mb-1.5">{t('djSay')}</p>
              <p className="text-[13px] leading-relaxed text-[var(--text-secondary)]" aria-live="polite">
                {renderSay(say, sayTheme, sayReveal)}
                {conn === 'busy' && (
                  <motion.span
                    className="inline-block w-1 h-3.5 ml-1 rounded-sm align-middle"
                    style={{ background: 'rgb(var(--accent-rgb))' }}
                    animate={reducedMotion ? { opacity: 1 } : { opacity: [1, 0.2, 1] }}
                    transition={reducedMotion ? { duration: 0 } : { duration: 0.9, repeat: Infinity }}
                  />
                )}
              </p>
            </div>

            {steerRow}

            {onPick && onReorder && onRemove && onClear && (
              <UpNext
                items={upNext}
                baseIndex={queueIndex + 1}
                onPick={onPick}
                onReorder={onReorder}
                onRemove={onRemove}
                onClear={onClear}
                disabled={isObserver || controlsDisabled}
              />
            )}
          </div>
        </motion.div>
      ) : (
        <motion.div
          key="clock"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={spring.gentle}
          className="main-card main-card--clock"
        >
          <DotMatrixClock
            time={now.time}
            weekday={now.weekday}
            dateLine={now.dateLine}
            airLabel={airLabel}
            live={live && conn === 'on'}
          />

          <div className="panel-dot p-3.5 mt-2.5">
            {planNote && (
              <p className="mb-2 text-[10px] font-mono text-[var(--text-muted)]">
                {t('planToday')}: {planNote}
              </p>
            )}
            <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-[var(--text-muted)] mb-1.5">{t('djSay')}</p>
            <p className="text-[13px] leading-relaxed text-[var(--text-secondary)]" aria-live="polite">
              {renderSay(say, sayTheme, sayReveal)}
            </p>
            {steerRow}
            {onTrigger && !isObserver && (
              <button
                type="button"
                className="mt-3 w-full rounded-2xl py-2.5 text-[12px] font-medium disabled:opacity-40"
                style={{ background: 'rgb(var(--accent-rgb) / 0.12)', color: 'rgb(var(--accent-rgb))' }}
                disabled={controlsDisabled}
                onClick={() => (queueTotal > 0 && onResume ? onResume() : onTrigger('station'))}
              >
                {queueTotal > 0 ? t('resumePlay') : t('goOnAir')}
              </button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
