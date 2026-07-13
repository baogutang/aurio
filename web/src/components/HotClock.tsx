import { useEffect, useMemo, useRef, useState } from 'react';
import { MatrixTime } from './DotMatrixClock';
import { api } from '../lib/api';
import { angleOfTime, clockArcs, describeArc, polar, type ClockSpan, type ClockArc } from '../lib/hotClock';
import { planArcs, quietTickAngles, PLAN_TONES, type DayPlan } from '../lib/plan';
import { programmeAt, startOf, audibleEndOf, type ProgrammeItem } from '../lib/programme';
import { parseTapeItems } from '../lib/tape';
import { useI18n, usePreferences } from '../context/PreferencesContext';

// 播出钟 — the one design thesis (RADIO_AUDIT「UI 与动效」): a ring, a sweep
// hand driven by the REAL wall clock, an ON AIR light, and coloured arc
// segments that ARE the programme log of the surrounding hour. Aired history
// (dimmed, behind the hand) comes from /api/tape; a server without the
// endpoint degrades to forward arcs only. No neon, no glow — the dial speaks
// dot-matrix like the rest of the hardware face.

const C = 130;            // viewBox center
const R_PLAN = 127;       // 今日节目单 ring — thin outer layer (P5-C)
const R_TICKS = 122;      // minute-dot ring
const R_ARC = 110;        // programme arcs
const R_VOICE_IN = 102;   // voice tick inner radius
const R_VOICE_OUT = 117;  // voice tick outer radius
const R_HAND = 115;       // sweep hand length

interface Props {
  /** "HH:MM" for the centre digits (already locale-formatted). */
  time: string;
  weekday: string;
  dateLine: string;
  airLabel: string;
  live: boolean;
  /** Station wall clock (Date.now() + skew). */
  serverNow: () => number;
  /** The live programme slice (current + upNext). */
  programme: ProgrammeItem[];
  /** Open the tape view (aired arcs / the rewind pill). Hidden when absent. */
  onOpenTape?: () => void;
  /** 今日节目单 (P5-C): the day plan; null hides the outer ring entirely. */
  plan?: DayPlan | null;
}

const spanOfItem = (it: ProgrammeItem): ClockSpan | null => {
  const s = startOf(it);
  if (s == null) return null;
  return { id: it.id, type: it.type, start: s, end: audibleEndOf(it) };
};

const ARC_STYLE: Record<ClockArc['state'], { opacity: number; accent: boolean }> = {
  aired: { opacity: 0.16, accent: false },
  played: { opacity: 0.34, accent: true },
  ahead: { opacity: 0.92, accent: true },
  upnext: { opacity: 0.4, accent: false },
};

function arcColor(arc: ClockArc): { stroke: string; opacity: number } {
  if (arc.kind === 'voice') {
    return { stroke: 'rgb(var(--hi-rgb))', opacity: arc.state === 'aired' ? 0.3 : 0.85 };
  }
  const st = ARC_STYLE[arc.state];
  return { stroke: st.accent ? 'rgb(var(--accent-rgb))' : 'var(--matrix-fg)', opacity: st.opacity };
}

export default function HotClock({
  time, weekday, dateLine, airLabel, live, serverNow, programme, onOpenTape, plan = null,
}: Props) {
  const { t } = useI18n();
  const { reducedMotion } = usePreferences();

  // The dial ticks on the station's wall clock, once a second.
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    setNow(serverNow());
    const timer = window.setInterval(() => setNow(serverNow()), 1000);
    return () => window.clearInterval(timer);
  }, [serverNow]);

  // Aired history for the back half of the dial — honest degradation: any
  // failure (endpoint missing on older servers) just means no history arcs.
  const [aired, setAired] = useState<ClockSpan[]>([]);
  useEffect(() => {
    let stop = false;
    const load = () => {
      api.tape(1)
        .then((r) => {
          if (stop) return;
          setAired(parseTapeItems(r).map((it) => ({
            id: it.id, type: it.type, start: it.airStart, end: it.airStart + it.duration,
          })));
        })
        .catch(() => { if (!stop) setAired([]); });
    };
    load();
    const timer = window.setInterval(load, 60_000);
    return () => { stop = true; window.clearInterval(timer); };
  }, []);

  const programmeSpans = useMemo(
    () => programme.map(spanOfItem).filter((s): s is ClockSpan => !!s),
    [programme],
  );
  const currentId = programmeAt(programme, now).current?.id ?? null;
  const arcs = clockArcs({ aired, programme: programmeSpans, currentId, now });

  // 今日节目单 (P5-C): the current hour's slice of the day plan as a thin
  // outer ring — kind→tone mapping documented in lib/plan.ts (PLAN_TONES).
  // Quiet windows punch the ring out and leave hollow minute dots. A null
  // plan (old server, cron not run yet) renders nothing at all.
  const dayArcs = planArcs(plan, now);
  const quietDots = quietTickAngles(plan, now);

  // Unwrap the hand angle so the CSS sweep never spins backwards at :00.
  const unwrap = useRef({ last: 0, turns: 0 });
  const rawAngle = angleOfTime(now);
  if (rawAngle < unwrap.current.last - 180) unwrap.current.turns += 1;
  unwrap.current.last = rawAngle;
  const handAngle = rawAngle + unwrap.current.turns * 360;

  const handTip = polar(C, C, R_HAND, 0); // drawn at 0°, rotated via CSS

  return (
    <div className="matrix-display hot-clock-panel">
      <div className="hot-clock" role="img" aria-label={`${t('hotClockAria')} ${time}`}>
        <svg viewBox="0 0 260 260" className="hot-clock-dial" aria-hidden>
          {/* minute dots — the dial's own dot-matrix */}
          {Array.from({ length: 60 }, (_, m) => {
            const p = polar(C, C, R_TICKS, m * 6);
            const five = m % 5 === 0;
            return (
              <circle
                key={m}
                cx={p.x} cy={p.y} r={five ? 1.7 : 1}
                fill="var(--matrix-fg)"
                opacity={five ? 0.3 : 0.12}
              />
            );
          })}

          {/* 今日节目单 — the day's shape around the dial (additive layer) */}
          {dayArcs.map((arc, i) => {
            const tone = PLAN_TONES[arc.kind];
            return (
              <path
                key={`plan-${arc.kind}-${i}`}
                d={describeArc(C, C, R_PLAN, arc.a0, arc.a1)}
                fill="none"
                stroke={tone.stroke}
                strokeOpacity={tone.opacity}
                strokeWidth={2.2}
                strokeDasharray={tone.dashed ? '1.6 3' : undefined}
              />
            );
          })}
          {quietDots.map((deg, i) => {
            const p = polar(C, C, R_PLAN, deg);
            return (
              <circle
                key={`quiet-${i}`}
                cx={p.x} cy={p.y} r={1.4}
                fill="none"
                stroke="var(--matrix-fg)" strokeOpacity={0.55} strokeWidth={0.8}
              />
            );
          })}

          {/* the programme log */}
          {arcs.map((arc, i) => {
            const { stroke, opacity } = arcColor(arc);
            if (arc.kind === 'voice') {
              const p0 = polar(C, C, R_VOICE_IN, arc.a0);
              const p1 = polar(C, C, R_VOICE_OUT, arc.a0);
              return (
                <line
                  key={`${arc.id}-${arc.state}-${i}`}
                  x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y}
                  stroke={stroke} strokeOpacity={opacity} strokeWidth={2}
                />
              );
            }
            return (
              <path
                key={`${arc.id}-${arc.state}-${i}`}
                d={describeArc(C, C, R_ARC, arc.a0, arc.a1)}
                fill="none" stroke={stroke} strokeOpacity={opacity} strokeWidth={7}
              />
            );
          })}

          {/* fat invisible hit areas: tap an aired arc to open the tape */}
          {onOpenTape && arcs.filter((a) => a.state === 'aired').map((arc, i) => (
            <path
              key={`hit-${arc.id}-${i}`}
              d={describeArc(C, C, R_ARC, arc.a0, arc.a1)}
              fill="none" stroke="#000" strokeOpacity={0} strokeWidth={20}
              style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
              onClick={onOpenTape}
            />
          ))}

          {/* the sweep hand — the real wall clock */}
          <g
            style={{
              transform: `rotate(${handAngle}deg)`,
              transformOrigin: `${C}px ${C}px`,
              transition: reducedMotion ? 'none' : 'transform 1s linear',
            }}
          >
            <line
              x1={C} y1={C - 20} x2={handTip.x} y2={handTip.y}
              stroke="var(--matrix-fg)" strokeOpacity={0.8} strokeWidth={1.5}
            />
            <circle cx={handTip.x} cy={handTip.y} r={2.4} fill="var(--matrix-fg)" opacity={0.9} />
          </g>
        </svg>

        <div className="hot-clock-center">
          <MatrixTime time={time} still={reducedMotion} />
          <div className="matrix-status !mt-2">
            <span
              className="matrix-live-dot"
              style={{
                background: live ? 'rgb(var(--hi-rgb))' : 'var(--text-muted)',
                opacity: live ? 1 : 0.35,
                boxShadow: live ? undefined : 'none',
                animation: live && !reducedMotion ? 'hotClockAir 2.2s ease-in-out infinite' : 'none',
              }}
            />
            <span className="matrix-status-text" style={live ? undefined : { color: 'var(--text-muted)' }}>
              {airLabel}
            </span>
          </div>
        </div>
      </div>

      <p className="matrix-date !mt-2">{weekday} · {dateLine}</p>

      {onOpenTape && (
        <button type="button" className="header-pill hot-clock-rewind" onClick={onOpenTape}>
          ◂◂ {t('tapeRewind')}
        </button>
      )}
    </div>
  );
}
