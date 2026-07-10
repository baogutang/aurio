import { motion, AnimatePresence } from 'framer-motion';
import { useI18n, usePreferences } from '../context/PreferencesContext';
import { labelForSource, availableSourceModes, hintForSources, type MusicSourceMode, type MusicServices } from '../lib/musicSource';
import { spring } from '../lib/motion';
import { fillTemplate } from '../lib/live';
import type { StationTuning } from '../lib/station';

export interface StatusStripProps {
  conn: 'on' | 'busy' | '';
  playing: boolean;
  hasTrack: boolean;
  services: MusicServices;
  musicSource: MusicSourceMode;
  queueTotal: number;
  queueRemaining: number;
  station: StationTuning;
  /** Honest listener count (self included); shown only when > 1. */
  listeners?: number;
  /** Time-shifted: the tuning line dims — this device is off the live dial. */
  tapeMode?: boolean;
  onCycleSource?: () => void;
}

function Dot({ live }: { live: boolean }) {
  return (
    <span
      className="inline-block w-1.5 h-1.5 rounded-full shrink-0 mr-1.5"
      style={{
        background: live ? 'rgb(var(--hi-rgb))' : 'var(--text-muted)',
        opacity: live ? 1 : 0.35,
        boxShadow: live ? '0 0 6px rgba(var(--hi-rgb), 0.7)' : undefined,
      }}
    />
  );
}

// The station line: `AURIO 88.7 FM`. The frequency digits slide like a dial
// when the tuning changes (a real user action drives every change); under
// reduced motion the number swaps in place.
function StationLine({ station, dimmed }: { station: StationTuning; dimmed?: boolean }) {
  const { reducedMotion } = usePreferences();
  return (
    <div className={`station-line${dimmed ? ' is-tape' : ''}`} aria-label={`${station.line} FM`}>
      <span className="station-call">AURIO</span>
      <span className="station-freq-window">
        {reducedMotion ? (
          <span className="station-freq">{station.freq}</span>
        ) : (
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={station.freq}
              className="station-freq"
              initial={{ y: 9, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -9, opacity: 0 }}
              transition={spring.snappy}
            >
              {station.freq}
            </motion.span>
          </AnimatePresence>
        )}
      </span>
      <span className="station-band">FM</span>
    </div>
  );
}

export default function StatusStrip({
  conn, playing, hasTrack, services, musicSource, queueTotal, queueRemaining, station,
  listeners = 0, tapeMode = false, onCycleSource,
}: StatusStripProps) {
  const { t } = useI18n();

  const sourceLive = !!(services.netease || services.navidrome || services.qqmusic);
  const sourceValue = labelForSource(musicSource, services, t);
  const canSwitch = sourceLive && availableSourceModes(services).length > 1 && !!onCycleSource;
  const sourceHint = canSwitch ? hintForSources(services, t) : undefined;

  let airValue = t('connOff');
  let airLive = false;
  if (tapeMode) {
    airValue = t('tapeMode');
  } else if (conn === 'busy') {
    airValue = t('statusArranging');
  } else if (conn === '') {
    airValue = t('connOff');
  } else if (playing) {
    airValue = t('onAir');
    airLive = true;
  } else if (hasTrack) {
    airValue = t('statusPaused');
  } else {
    airValue = t('standby');
  }

  const queueValue = queueTotal === 0
    ? '0'
    : hasTrack
      ? String(queueRemaining)
      : String(queueTotal);

  const items = [
    {
      key: 'source',
      label: t('statSource'),
      value: sourceValue,
      live: sourceLive,
      clickable: canSwitch,
      title: sourceHint,
      onClick: canSwitch ? onCycleSource : undefined,
    },
    {
      key: 'air',
      label: t('statAir'),
      value: airValue,
      live: airLive,
      clickable: false,
    },
    {
      key: 'queue',
      label: t('statQueue'),
      value: queueValue,
      live: queueTotal > 0,
      clickable: false,
      title: t('statQueueHint'),
    },
  ];

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <StationLine station={station} dimmed={tapeMode} />
        {/* Honest 听众数 — only when another device really is tuned in. */}
        {listeners > 1 && (
          <span className="font-mono text-[9px] text-[var(--text-muted)] tracking-[0.08em] pr-1 pb-1.5 shrink-0">
            {fillTemplate(t('listenersLine'), { n: listeners })}
          </span>
        )}
      </div>
      <div className="status-strip">
        {items.map((item, i) => {
          const Tag = item.clickable ? 'button' : 'div';
          return (
            <motion.div
              key={item.key}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
            >
              <Tag
                type={item.clickable ? 'button' : undefined}
                onClick={item.onClick}
                className={`status-cell w-full text-left ${item.clickable ? 'status-cell-btn' : ''}`}
                title={item.title}
              >
                <span className="status-cell-label">{item.label}</span>
                <span className="status-cell-value flex items-center">
                  <Dot live={item.live} />
                  <span className="truncate">{item.value}</span>
                </span>
              </Tag>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
