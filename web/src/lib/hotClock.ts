// Pure geometry for the 播出钟 (hot clock) — a 60-minute broadcast dial.
//
// The dial is a REAL minute dial: 12 o'clock is minute :00 of the wall clock,
// and every span (song, voicetrack, liner, station ID) sits at the angle of
// the actual wall-clock minute it aired / will air. The sweep hand is the real
// wall clock. Nothing here is decorative — every arc is a log entry.
//
// The visible window is the surrounding hour: LOOK_BACK behind the hand
// (aired, dimmed) and LOOK_AHEAD in front of it (upcoming). Together they are
// exactly 60 minutes, so no two instants in the window collide on the dial.

export const LOOK_BACK_MS = 30 * 60_000;
export const LOOK_AHEAD_MS = 30 * 60_000;

/** A wall-clock span on the dial (times are station wall-clock ms epoch). */
export interface ClockSpan {
  id: string;
  /** Programme item type; anything that is not 'song' renders as a voice tick. */
  type: string;
  start: number;
  end: number;
}

export type ArcKind = 'song' | 'voice';
export type ArcState = 'aired' | 'played' | 'ahead' | 'upnext';

export interface ClockArc {
  id: string;
  kind: ArcKind;
  state: ArcState;
  /** Start angle in degrees, 0 = top of dial, clockwise. */
  a0: number;
  /** End angle; a1 >= a0 (may exceed 360 when the span wraps past :00). */
  a1: number;
}

/** Angle of a wall-clock instant on the minute dial (0° = :00, clockwise). */
export function angleOfTime(t: number): number {
  const d = new Date(t);
  const sec = d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() / 1000;
  return (sec / 3600) * 360;
}

const kindOf = (type: string): ArcKind => (type === 'song' ? 'song' : 'voice');

/**
 * Lay the programme log onto the dial.
 *
 * `aired` is history (the tape, oldest→newest, may be empty when the server
 * has no /api/tape yet — the dial then only shows the forward arcs).
 * `programme` is the live slice (current + upNext). `currentId` marks the
 * on-air item, which is split at the hand into `played` / `ahead` so the dial
 * shows how much of it is left. Spans outside the surrounding hour are
 * clipped; spans that never started are skipped.
 */
export function clockArcs(opts: {
  aired: ClockSpan[];
  programme: ClockSpan[];
  currentId: string | null;
  now: number;
}): ClockArc[] {
  const { aired, programme, currentId, now } = opts;
  const winStart = now - LOOK_BACK_MS;
  const winEnd = now + LOOK_AHEAD_MS;
  const out: ClockArc[] = [];
  const programmeIds = new Set(programme.map((s) => s.id));

  const push = (span: ClockSpan, state: ArcState, from: number, to: number) => {
    const s = Math.max(from, winStart);
    const e = Math.min(to, winEnd);
    if (!(Number.isFinite(s) && Number.isFinite(e)) || e <= s) return;
    const a0 = angleOfTime(s);
    const sweep = ((e - s) / 3_600_000) * 360;
    out.push({ id: span.id, kind: kindOf(span.type), state, a0, a1: a0 + sweep });
  };

  for (const span of aired) {
    if (programmeIds.has(span.id)) continue; // the live slice wins on overlap
    push(span, 'aired', span.start, span.end);
  }
  for (const span of programme) {
    if (span.id === currentId) {
      push(span, 'played', span.start, Math.min(now, span.end));
      push(span, 'ahead', Math.max(now, span.start), span.end);
    } else if (span.end <= now) {
      push(span, 'aired', span.start, span.end);
    } else {
      push(span, 'upnext', span.start, span.end);
    }
  }
  return out;
}

/** Polar → cartesian on the dial (0° = top, clockwise). */
export function polar(cx: number, cy: number, r: number, deg: number): { x: number; y: number } {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

/** SVG path for a clockwise arc from a0 to a1 degrees at radius r. */
export function describeArc(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const sweep = Math.min(360, Math.max(0, a1 - a0));
  const p0 = polar(cx, cy, r, a0);
  const p1 = polar(cx, cy, r, a0 + sweep);
  const largeArc = sweep > 180 ? 1 : 0;
  const fmt = (n: number) => Number(n.toFixed(2));
  return `M ${fmt(p0.x)} ${fmt(p0.y)} A ${r} ${r} 0 ${largeArc} 1 ${fmt(p1.x)} ${fmt(p1.y)}`;
}
