import { motion, AnimatePresence } from 'framer-motion';
import ClockDisplay from './ClockDisplay';
import BootLog from './BootLog';
import Spectrum from './Spectrum';
import Lyrics from './Lyrics';
import UpNext from './UpNext';
import { renderSay } from '../lib/highlight';
import { spring } from '../lib/motion';
import { usePreferences } from '../context/PreferencesContext';
import type { NowDisplay } from '../lib/dateFormat';
import type { Track } from '../lib/types';
import type { MusicServices } from '../lib/musicSource';

interface Props {
  track: Track | null;
  progress: number;
  cur: string;
  dur: string;
  say: string;
  now: NowDisplay;
  playing: boolean;
  conn: 'on' | 'busy' | '';
  onSeek: (e: React.MouseEvent<HTMLDivElement>) => void;
  audioRef: React.RefObject<HTMLAudioElement>;
  services?: MusicServices & { weather: boolean };
  queue?: Track[];
  queueIndex?: number;
  onPick?: (index: number) => void;
  onReorder?: (next: Track[]) => void;
  onRemove?: (index: number) => void;
  onClear?: () => void;
}

export default function MainCard({
  track, progress, cur, dur, say, now, playing, conn, onSeek, audioRef, services,
  queue = [], queueIndex = -1, onPick, onReorder, onRemove, onClear,
}: Props) {
  const { clock, tr: t } = usePreferences();
  const live = conn === 'on' || conn === 'busy';
  const airLabel = conn === 'on' ? t('onAir') : conn === 'busy' ? t('busy') : t('standby');
  const upNext = queue.slice(queueIndex + 1);
  const sourceLabel = track?.source === 'navidrome'
    ? t('sourceNas')
    : track?.source === 'qqmusic'
      ? t('sourceQQ')
      : t('sourceNetease');

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
            <Spectrum audioRef={audioRef} height={108} />

            <motion.h1
              key={track.title}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-3 text-[1.18rem] font-semibold leading-snug line-clamp-2 text-[var(--text-primary)]"
            >
              {track.title}
            </motion.h1>
            <p className="mt-0.5 text-xs text-[var(--text-muted)] truncate">
              {[track.artist, track.album].filter(Boolean).join(' · ')}
            </p>

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
              <p className="text-[13px] leading-relaxed text-[var(--text-secondary)]">
                {renderSay(say, 'dark')}
                {conn === 'busy' && (
                  <motion.span
                    className="inline-block w-1 h-3.5 ml-1 rounded-sm align-middle"
                    style={{ background: 'rgb(var(--accent-rgb))' }}
                    animate={{ opacity: [1, 0.2, 1] }}
                    transition={{ duration: 0.9, repeat: Infinity }}
                  />
                )}
              </p>
            </div>

            {onPick && onReorder && onRemove && onClear && (
              <UpNext
                items={upNext}
                baseIndex={queueIndex + 1}
                onPick={onPick}
                onReorder={onReorder}
                onRemove={onRemove}
                onClear={onClear}
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
          className="main-card main-card--clock scroll-panel"
        >
          <ClockDisplay
            time={now.time}
            weekday={now.weekday}
            dateLine={now.dateLine}
            airLabel={airLabel}
            live={live && conn === 'on'}
            style={clock}
          />

          <div className="panel-dot p-3.5 mt-2.5 max-h-[156px] min-h-[84px] scroll-panel">
            <BootLog
              netease={services?.netease}
              navidrome={services?.navidrome}
              qqmusic={services?.qqmusic}
              weather={services?.weather}
              connected={live}
            />
          </div>

          <div className="panel-dot p-3.5 mt-2.5">
            <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-[var(--text-muted)] mb-1.5">{t('djSay')}</p>
            <p className="text-[13px] leading-relaxed text-[var(--text-secondary)]">
              {renderSay(say, 'dark')}
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
