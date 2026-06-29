import { motion } from 'framer-motion';
import { useI18n } from '../context/PreferencesContext';
import { labelForSource, availableSourceModes, hintForSources, type MusicSourceMode, type MusicServices } from '../lib/musicSource';

export interface StatusStripProps {
  conn: 'on' | 'busy' | '';
  playing: boolean;
  hasTrack: boolean;
  services: MusicServices;
  musicSource: MusicSourceMode;
  queueTotal: number;
  queueRemaining: number;
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

export default function StatusStrip({
  conn, playing, hasTrack, services, musicSource, queueTotal, queueRemaining, onCycleSource,
}: StatusStripProps) {
  const { t } = useI18n();

  const sourceLive = !!(services.netease || services.navidrome || services.qqmusic);
  const sourceValue = labelForSource(musicSource, services, t);
  const canSwitch = sourceLive && availableSourceModes(services).length > 1 && !!onCycleSource;
  const sourceHint = canSwitch ? hintForSources(services, t) : undefined;

  let airValue = t('connOff');
  let airLive = false;
  if (conn === 'busy') {
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
  );
}
