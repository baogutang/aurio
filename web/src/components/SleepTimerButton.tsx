import { useEffect, useRef, useState } from 'react';
import PressButton from './PressButton';
import { IconMoon } from './icons';
import { fadeMasterTo, setMasterGain } from '../lib/audioGraph';
import {
  nextSleepMinutes, sleepRemainingMs, sleepPhase, sleepFadeSeconds, formatSleepCountdown,
} from '../lib/sleepTimer';
import { fillTemplate } from '../lib/live';
import { useI18n } from '../context/PreferencesContext';

// 睡眠定时器 — a quiet transport-row control. Pressing cycles
// off → 15 → 30 → 60 → 90 → off; the countdown replaces the crescent while
// armed. The final 30 s fade the master bus to silence, then LOCAL playback
// pauses — the station keeps running, and play rejoins the live edge as
// always. Nothing persists across reloads.

interface Props {
  /** Pause local playback (the App's pauseLocal). */
  onSleep: () => void;
  /** Surface a one-line hint (the App's feedback line). */
  onHint?: (text: string) => void;
}

export default function SleepTimerButton({ onSleep, onHint }: Props) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<number | null>(null);
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [, setTick] = useState(0);
  const fadeArmedRef = useRef(false);
  const onSleepRef = useRef(onSleep);
  onSleepRef.current = onSleep;

  useEffect(() => {
    if (endsAt == null) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      const phase = sleepPhase(endsAt, now);
      if (phase === 'fading' && !fadeArmedRef.current) {
        fadeArmedRef.current = true;
        fadeMasterTo(0, sleepFadeSeconds(endsAt, now));
      }
      if (phase === 'done') {
        fadeArmedRef.current = false;
        setSelected(null);
        setEndsAt(null);
        onSleepRef.current();
        // Restore the bus AFTER pausing so the next wake is audible.
        setMasterGain(1);
        return;
      }
      setTick((v) => v + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [endsAt]);

  // Unmounting with a fade in flight must not leave the bus silent.
  useEffect(() => () => {
    if (fadeArmedRef.current) {
      fadeArmedRef.current = false;
      setMasterGain(1);
    }
  }, []);

  const cycle = () => {
    const next = nextSleepMinutes(selected);
    if (fadeArmedRef.current) {
      fadeArmedRef.current = false;
      setMasterGain(1);
    }
    setSelected(next);
    if (next == null) {
      setEndsAt(null);
      onHint?.(t('sleepOff'));
    } else {
      setEndsAt(Date.now() + next * 60_000);
      onHint?.(fillTemplate(t('sleepSet'), { m: next }));
    }
  };

  const active = endsAt != null;
  return (
    <PressButton
      variant="ghost"
      ariaLabel={t('ariaSleep')}
      onClick={cycle}
      className={active ? 'is-liked' : ''}
    >
      <span className="transport-glyph">
        {active ? (
          <span className="font-mono text-[9px] tabular-nums leading-none">
            {formatSleepCountdown(sleepRemainingMs(endsAt, Date.now()))}
          </span>
        ) : (
          <IconMoon />
        )}
      </span>
    </PressButton>
  );
}
