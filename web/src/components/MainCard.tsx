import { motion, AnimatePresence } from 'framer-motion';
import HotClock from './HotClock';
import Spectrum from './Spectrum';
import VoiceStrip from './VoiceStrip';
import Lyrics from './Lyrics';
import UpNext from './UpNext';
import { renderSay } from '../lib/highlight';
import { spring } from '../lib/motion';
import { uptimeParts, fillTemplate } from '../lib/live';
import { usePreferences } from '../context/PreferencesContext';
import type { NowDisplay } from '../lib/dateFormat';
import type { Track } from '../lib/types';
import type { StationMood } from '../lib/station';
import type { ProgrammeItem } from '../lib/programme';
import type { DayPlan } from '../lib/plan';

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
  audioRef: React.RefObject<HTMLAudioElement>;
  /** The station's upcoming programme — read-only (the timeline is server-side). */
  upNext?: Track[];
  /** The raw programme slice for the hot clock's forward arcs. */
  programme?: ProgrammeItem[];
  /** Station wall clock (Date.now() + skew). */
  serverNow?: () => number;
  /** hh:mm:ss wall-clock of the broadcast position; null falls back to media time. */
  airClock?: string | null;
  /** ms epoch of station sign-on (newer servers); null hides the uptime line. */
  stationStartedAt?: number | null;
  /** True while the player is time-shifted onto the tape. */
  tapeMode?: boolean;
  onOpenTape?: () => void;
  onBackToLive?: () => void;
  onSteer?: (text: string, mood: StationMood) => void;
  onTrigger?: (kind: string) => void;
  onResume?: () => void;
  controlsDisabled?: boolean;
  tasteLine?: string;
  /** Legacy one-line plan note (/api/plan/today) — shown only without `plan`. */
  planNote?: string;
  /** 今日节目单 (P5-C): the structured day plan; null hides all plan chrome. */
  plan?: DayPlan | null;
  onOpenPlan?: () => void;
  queueTotal?: number;
}

export default function MainCard({
  track, progress, cur, dur, say, sayReveal = null, now, playing, talking = false,
  conn, audioRef, upNext = [], programme = [], serverNow,
  airClock = null, stationStartedAt = null, tapeMode = false, onOpenTape, onBackToLive,
  onSteer, onTrigger, onResume, controlsDisabled = false,
  tasteLine = '', planNote = '', plan = null, onOpenPlan, queueTotal = 0,
}: Props) {
  const { tr: t, resolved, reducedMotion } = usePreferences();
  const sayTheme = resolved === 'light' ? 'card' : 'dark';
  const airLabel = tapeMode
    ? t('tapeMode')
    : conn === 'on' ? t('onAir') : conn === 'busy' ? t('busy') : t('standby');
  const stationNow = serverNow ?? Date.now;
  const uptime = !tapeMode ? uptimeParts(stationStartedAt, stationNow()) : null;
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

  const steerRow = onSteer && (
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
            <span className="flex items-center gap-2">
              {!tapeMode && onOpenTape && (
                <button
                  type="button"
                  className="font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  onClick={onOpenTape}
                  aria-label={t('tapeTitle')}
                >
                  ◂◂ {t('tapeRewind')}
                </button>
              )}
              {tapeMode && onOpenTape ? (
                <button
                  type="button"
                  className="font-mono text-[9px] uppercase tracking-[0.2em]"
                  style={{ color: 'rgb(var(--accent-rgb))' }}
                  onClick={onOpenTape}
                  aria-label={t('tapeTitle')}
                >
                  ◂◂ {airLabel}
                </button>
              ) : (
                <span
                  className="font-mono text-[9px] uppercase tracking-[0.2em]"
                  style={{ color: 'rgb(var(--hi-rgb))' }}
                >
                  {airLabel}
                </span>
              )}
            </span>
          </div>

          <div className="play-card-scroll scroll-panel">
            {tasteLine && (
              <p className="mb-2 text-[10px] font-mono text-[rgb(var(--hi-rgb))] px-2 py-1 rounded-lg"
                style={{ background: 'var(--inset-bg)', border: '1px solid var(--glass-border)' }}>
                {t('tasteLearning')}: {tasteLine}
              </p>
            )}
            {/* The spectrum area. While the DJ voice airs the music display
                yields (the same `talking` that drives the audio sidechain)
                and the Speaking strip cuts in over it — one 250ms ease each
                way, reset instantly by the talking-state rollbacks. */}
            <div className="relative">
              <Spectrum audioRef={audioRef} height={108} dimmed={talking} />
              <VoiceStrip active={talking} />
            </div>

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
              {/* LIVE: the bar shows where the broadcast is — it is not a
                  scrubber. The station's clock cannot be dragged. The left
                  time is the wall clock of what you are HEARING: live it is
                  now, paused it freezes, on tape it is the original air time. */}
              <div className="progress-track" role="progressbar" aria-valuenow={progress}>
                <div className="progress-fill" style={{ width: `${progress}%` }} />
              </div>
              <div className="flex justify-between mt-1.5 font-mono text-[10px] text-[var(--text-muted)] tabular-nums">
                <span style={tapeMode ? { color: 'rgb(var(--accent-rgb))' } : undefined}>
                  {airClock ?? cur}
                </span>
                <span>{dur}</span>
              </div>
              {!tapeMode && uptime && (
                <p className="mt-1 font-mono text-[9px] text-[var(--text-muted)] tracking-[0.08em]">
                  {fillTemplate(t('uptimeLine'), { h: uptime.hours, m: uptime.minutes })}
                </p>
              )}
              {tapeMode && onBackToLive && (
                <button
                  type="button"
                  className="mt-2 w-full rounded-xl py-2 text-[12px] font-medium"
                  style={{ background: 'rgba(var(--hi-rgb), 0.14)', color: 'rgb(var(--hi-rgb))' }}
                  onClick={onBackToLive}
                >
                  ● {t('backToLive')}
                </button>
              )}
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

            <UpNext items={upNext} />
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
          <div className="clock-card-scroll scroll-panel">
          <HotClock
            time={now.time}
            weekday={now.weekday}
            dateLine={now.dateLine}
            airLabel={airLabel}
            live={conn === 'on'}
            serverNow={stationNow}
            programme={programme}
            onOpenTape={onOpenTape}
            plan={plan}
          />

          <div className="panel-dot p-3.5 mt-2.5">
            {/* 今日节目单 (P5-C): with a structured plan the note line becomes
                the rundown's opener; older servers keep the plain note. When
                neither exists, nothing renders — no empty chrome. */}
            {plan && onOpenPlan ? (
              <button
                type="button"
                className="plan-note-line mb-2"
                onClick={onOpenPlan}
                aria-label={t('ariaPlanOpen')}
              >
                <span className="plan-note-chip">▤ {t('planChip')}</span>
                {plan.note && <span className="plan-note-text">{plan.note}</span>}
              </button>
            ) : planNote ? (
              <p className="mb-2 text-[10px] font-mono text-[var(--text-muted)]">
                {t('planToday')}: {planNote}
              </p>
            ) : null}
            <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-[var(--text-muted)] mb-1.5">{t('djSay')}</p>
            <p className="text-[13px] leading-relaxed text-[var(--text-secondary)]" aria-live="polite">
              {renderSay(say, sayTheme, sayReveal)}
            </p>
            {steerRow}
            {onTrigger && (
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
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
