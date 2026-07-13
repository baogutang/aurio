// 今日节目单 (P5-C, RADIO_VISION §六B) — pure parsing + dial mapping for the
// structured day plan the 07:00 cron produces.
//
// Contract (GET /api/plan):
//   { ok:true, plan: null | {
//       date, generatedAt,
//       segments:    [{ start:"09:00", end:"11:00", kind, label, reason }],
//       quietWindows:[{ start:"10:50", end:"11:30", reason:"11:00 的会" }],
//       note: "一句话的当天基调" } }
//
// Honest degradation is the whole design: a missing endpoint, a null plan or a
// malformed payload all parse to null, and every plan surface (ring, note
// line, sheet) hides completely — no empty chrome on servers without the
// feature.

import { angleOfTime, LOOK_BACK_MS, LOOK_AHEAD_MS } from './hotClock';

export type PlanKind = 'open' | 'focus' | 'energy' | 'winddown' | 'quiet';

export interface PlanSegment {
  /** Original "HH:MM" strings, verbatim for display. */
  start: string;
  end: string;
  /** Minutes since local midnight; endMin > startMin (a span crossing
   *  midnight is stored as endMin + 1440). */
  startMin: number;
  endMin: number;
  kind: PlanKind;
  label: string;
  reason: string;
}

export interface QuietWindow {
  start: string;
  end: string;
  startMin: number;
  endMin: number;
  reason: string;
}

export interface DayPlan {
  date: string;
  generatedAt: number | null;
  segments: PlanSegment[];
  quietWindows: QuietWindow[];
  note: string;
}

/**
 * kind → dial tone. The mapping is deliberately restrained — one warm tone,
 * one green, everything else is the display's own foreground at different
 * intensities, so the ring reads as part of the hardware face:
 *
 *   open     — matrix fg, low opacity        · the day spinning up
 *   focus    — matrix fg, mid opacity        · the neutral working canvas
 *   energy   — brand accent (orange), strong · the one warm tone
 *   winddown — muted green (--hi)            · landing lights
 *   quiet    — matrix fg, faint + dashed     · the station holding its tongue
 *
 * Quiet WINDOWS (calendar-driven 静默窗) are not a tone: the ring is punched
 * out under them (see planArcs) and hollow minute dots take their place.
 */
export const PLAN_TONES: Record<PlanKind, { stroke: string; opacity: number; dashed: boolean }> = {
  open: { stroke: 'var(--matrix-fg)', opacity: 0.3, dashed: false },
  focus: { stroke: 'var(--matrix-fg)', opacity: 0.55, dashed: false },
  energy: { stroke: 'rgb(var(--accent-rgb))', opacity: 0.8, dashed: false },
  winddown: { stroke: 'rgb(var(--hi-rgb))', opacity: 0.55, dashed: false },
  quiet: { stroke: 'var(--matrix-fg)', opacity: 0.2, dashed: true },
};

const KINDS = new Set<PlanKind>(['open', 'focus', 'energy', 'winddown', 'quiet']);

/** "HH:MM" → minutes since midnight; null for anything malformed. */
export function hhmmToMin(s: unknown): number | null {
  if (typeof s !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min > 0)) return null; // allow 24:00 as an end
  return h * 60 + min;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

interface RawSpan { start?: unknown; end?: unknown }

// Shared start/end parsing for segments and quiet windows. A span whose end
// is at-or-before its start crosses midnight (23:00–01:00) and unwraps to
// endMin + 1440 so downstream interval math stays monotonic.
function parseSpan(raw: RawSpan): { start: string; end: string; startMin: number; endMin: number } | null {
  const startMin = hhmmToMin(raw.start);
  const endMin = hhmmToMin(raw.end);
  if (startMin == null || endMin == null || endMin === startMin) return null; // incl. zero-length
  const unwrappedEnd = endMin > startMin ? endMin : endMin + 1440;
  return { start: str(raw.start), end: str(raw.end), startMin, endMin: unwrappedEnd };
}

/**
 * Parse the raw /api/plan response. Returns null when there is nothing to
 * show — including a structurally valid plan that is entirely empty, so an
 * early server that answers `{ plan: { segments: [] } }` still hides cleanly.
 * An unknown kind from a newer server degrades to the neutral 'focus' tone.
 */
export function parsePlan(resp: unknown): DayPlan | null {
  if (!resp || typeof resp !== 'object') return null;
  const plan = (resp as { plan?: unknown }).plan;
  if (!plan || typeof plan !== 'object') return null;
  const p = plan as Record<string, unknown>;

  const segments: PlanSegment[] = [];
  if (Array.isArray(p.segments)) {
    for (const raw of p.segments) {
      if (!raw || typeof raw !== 'object') continue;
      const span = parseSpan(raw as RawSpan);
      if (!span) continue;
      const rawKind = str((raw as { kind?: unknown }).kind) as PlanKind;
      segments.push({
        ...span,
        kind: KINDS.has(rawKind) ? rawKind : 'focus',
        label: str((raw as { label?: unknown }).label),
        reason: str((raw as { reason?: unknown }).reason),
      });
    }
  }
  segments.sort((a, b) => a.startMin - b.startMin);

  const quietWindows: QuietWindow[] = [];
  if (Array.isArray(p.quietWindows)) {
    for (const raw of p.quietWindows) {
      if (!raw || typeof raw !== 'object') continue;
      const span = parseSpan(raw as RawSpan);
      if (!span) continue;
      quietWindows.push({ ...span, reason: str((raw as { reason?: unknown }).reason) });
    }
  }
  quietWindows.sort((a, b) => a.startMin - b.startMin);

  const note = str(p.note);
  if (!segments.length && !quietWindows.length && !note) return null;

  const generatedAt = Number(p.generatedAt);
  return {
    date: str(p.date),
    generatedAt: Number.isFinite(generatedAt) && generatedAt > 0 ? generatedAt : null,
    segments,
    quietWindows,
    note,
  };
}

// --- dial mapping ------------------------------------------------------------
// The hot clock shows the surrounding hour (LOOK_BACK behind the hand,
// LOOK_AHEAD in front — see hotClock.ts). The plan ring uses the exact same
// window, so the day's shape and the programme log always agree on where a
// minute sits. Minutes-of-day anchor to local midnight; across a DST jump the
// ring can be off by the shifted hour for that one day — an accepted fuzziness
// for a planning layer (the programme arcs underneath stay exact).

export interface EpochSpan { from: number; to: number }

/** Local-midnight epoch of the day containing t. */
function dayStartOf(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * All epoch ranges where a minutes-of-day span intersects the dial's visible
 * window around `now`. Checks the span anchored to yesterday, today and (when
 * the window crosses midnight) tomorrow, so 23:00–01:00 shows both sides.
 */
export function spanInWindow(
  startMin: number,
  endMin: number,
  now: number,
  lookBackMs = LOOK_BACK_MS,
  lookAheadMs = LOOK_AHEAD_MS,
): EpochSpan[] {
  const winStart = now - lookBackMs;
  const winEnd = now + lookAheadMs;
  const today = dayStartOf(winStart);
  const anchors = new Set<number>([
    dayStartOf(today - 12 * 3_600_000), // yesterday (a wrapped span may reach in)
    today,
    dayStartOf(winEnd),
  ]);
  const out: EpochSpan[] = [];
  for (const d0 of anchors) {
    const from = Math.max(d0 + startMin * 60_000, winStart);
    const to = Math.min(d0 + endMin * 60_000, winEnd);
    if (to > from) out.push({ from, to });
  }
  out.sort((a, b) => a.from - b.from);
  return out;
}

/** Subtract `holes` from `spans` (all ranges half-open, ms epoch). */
export function subtractSpans(spans: EpochSpan[], holes: EpochSpan[]): EpochSpan[] {
  let cur = spans;
  for (const h of holes) {
    const next: EpochSpan[] = [];
    for (const s of cur) {
      if (h.to <= s.from || h.from >= s.to) {
        next.push(s);
        continue;
      }
      if (h.from > s.from) next.push({ from: s.from, to: h.from });
      if (h.to < s.to) next.push({ from: h.to, to: s.to });
    }
    cur = next;
  }
  return cur;
}

export interface PlanArc {
  kind: PlanKind;
  /** Degrees, 0 = top of dial, clockwise; a1 >= a0. */
  a0: number;
  a1: number;
}

/**
 * The current hour's slice of the plan as thin outer-ring arcs. Segments are
 * clipped to the dial's visible window and punched out under quiet windows
 * (the hollow minute dots from quietTickAngles fill those gaps).
 */
export function planArcs(plan: DayPlan | null, now: number): PlanArc[] {
  if (!plan) return [];
  const holes = plan.quietWindows.flatMap((w) => spanInWindow(w.startMin, w.endMin, now));
  const out: PlanArc[] = [];
  for (const seg of plan.segments) {
    const spans = subtractSpans(spanInWindow(seg.startMin, seg.endMin, now), holes);
    for (const s of spans) {
      const a0 = angleOfTime(s.from);
      const sweep = ((s.to - s.from) / 3_600_000) * 360;
      out.push({ kind: seg.kind, a0, a1: a0 + sweep });
    }
  }
  return out;
}

/**
 * Angles (degrees) of each whole minute inside a quiet window that falls in
 * the dial's visible hour — rendered as hollow dots where the ring went
 * silent. Deduped across overlapping windows; the visible hour caps the count
 * at 60 by construction.
 */
export function quietTickAngles(plan: DayPlan | null, now: number): number[] {
  if (!plan) return [];
  const minutes = new Set<number>();
  for (const w of plan.quietWindows) {
    for (const s of spanInWindow(w.startMin, w.endMin, now)) {
      for (let t = Math.ceil(s.from / 60_000) * 60_000; t <= s.to; t += 60_000) {
        minutes.add(t);
      }
    }
  }
  return [...minutes].sort((a, b) => a - b).map((t) => angleOfTime(t));
}

// --- sheet helpers -------------------------------------------------------------

/** Minutes since local midnight of a wall-clock instant. */
export function minOfDay(t: number): number {
  const d = new Date(t);
  return d.getHours() * 60 + d.getMinutes();
}

/** The plan segment covering `now` (handles spans that cross midnight). */
export function segmentAt(plan: DayPlan | null, now: number): PlanSegment | null {
  if (!plan) return null;
  const m = minOfDay(now);
  return (
    plan.segments.find(
      (s) => (m >= s.startMin && m < s.endMin) || (m + 1440 >= s.startMin && m + 1440 < s.endMin),
    ) ?? null
  );
}

export type PlanRow =
  | { type: 'segment'; seg: PlanSegment }
  | { type: 'quiet'; win: QuietWindow };

/** The rundown, chronologically: segments and quiet windows interleaved. */
export function planRows(plan: DayPlan): PlanRow[] {
  const rows: PlanRow[] = [
    ...plan.segments.map((seg): PlanRow => ({ type: 'segment', seg })),
    ...plan.quietWindows.map((win): PlanRow => ({ type: 'quiet', win })),
  ];
  // Stable sort: on a tie the segment leads and its quiet window follows.
  return rows.sort((a, b) => {
    const sa = a.type === 'segment' ? a.seg.startMin : a.win.startMin;
    const sb = b.type === 'segment' ? b.seg.startMin : b.win.startMin;
    return sa - sb;
  });
}
