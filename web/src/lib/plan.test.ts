import { describe, it, expect } from 'vitest';
import {
  hhmmToMin, parsePlan, spanInWindow, subtractSpans, planArcs, quietTickAngles,
  minOfDay, segmentAt, planRows, PLAN_TONES,
  type DayPlan,
} from './plan';

// Local wall-clock helper — tests stay timezone-independent because both the
// fixtures and angleOfTime anchor to the same local midnight.
const at = (h: number, m: number, s = 0) => new Date(2026, 6, 13, h, m, s).getTime();

const contractPlan = {
  ok: true,
  plan: {
    date: '2026-07-13',
    generatedAt: 1780000000000,
    segments: [
      { start: '09:00', end: '11:00', kind: 'open', label: '早安频率', reason: '把一天叫醒' },
      { start: '11:00', end: '14:00', kind: 'focus', label: '专注时段', reason: '下午有三个会' },
      { start: '18:00', end: '20:00', kind: 'energy', label: '能量段', reason: '晚间运动' },
      { start: '22:00', end: '23:30', kind: 'winddown', label: '收束段', reason: '一天的落地' },
    ],
    quietWindows: [
      { start: '10:50', end: '11:30', reason: '11:00 的会' },
    ],
    note: '今天说话少一点，会前我自动安静。',
  },
};

describe('hhmmToMin', () => {
  it('parses HH:MM including single-digit hours and 24:00', () => {
    expect(hhmmToMin('09:00')).toBe(540);
    expect(hhmmToMin('9:05')).toBe(545);
    expect(hhmmToMin('00:00')).toBe(0);
    expect(hhmmToMin('24:00')).toBe(1440);
  });

  it('rejects malformed values', () => {
    expect(hhmmToMin('9')).toBeNull();
    expect(hhmmToMin('09:60')).toBeNull();
    expect(hhmmToMin('25:00')).toBeNull();
    expect(hhmmToMin('24:01')).toBeNull();
    expect(hhmmToMin('ab:cd')).toBeNull();
    expect(hhmmToMin(930)).toBeNull();
    expect(hhmmToMin(null)).toBeNull();
  });
});

describe('parsePlan', () => {
  it('parses the full contract shape', () => {
    const p = parsePlan(contractPlan);
    expect(p).not.toBeNull();
    expect(p!.date).toBe('2026-07-13');
    expect(p!.generatedAt).toBe(1780000000000);
    expect(p!.note).toContain('自动安静');
    expect(p!.segments).toHaveLength(4);
    expect(p!.segments[0]).toMatchObject({ start: '09:00', end: '11:00', startMin: 540, endMin: 660, kind: 'open' });
    expect(p!.quietWindows[0]).toMatchObject({ startMin: 650, endMin: 690, reason: '11:00 的会' });
  });

  it('returns null for every empty / missing / malformed shape', () => {
    expect(parsePlan(null)).toBeNull();
    expect(parsePlan(undefined)).toBeNull();
    expect(parsePlan('nope')).toBeNull();
    expect(parsePlan({})).toBeNull();
    expect(parsePlan({ ok: true, plan: null })).toBeNull();
    expect(parsePlan({ ok: true, plan: 'x' })).toBeNull();
    // Structurally valid but with nothing to show — still hides.
    expect(parsePlan({ ok: true, plan: { date: '2026-07-13', segments: [], quietWindows: [], note: '' } })).toBeNull();
  });

  it('keeps a note-only plan (the note line alone is worth showing)', () => {
    const p = parsePlan({ plan: { note: '轻一点的一天' } });
    expect(p).not.toBeNull();
    expect(p!.segments).toEqual([]);
    expect(p!.note).toBe('轻一点的一天');
    expect(p!.generatedAt).toBeNull();
  });

  it('drops malformed segments, keeps valid ones, sorts by start', () => {
    const p = parsePlan({
      plan: {
        segments: [
          { start: '14:00', end: '16:00', kind: 'focus', label: 'B', reason: '' },
          { start: 'bogus', end: '11:00', kind: 'open', label: 'bad', reason: '' },
          { start: '10:00', end: '10:00', kind: 'open', label: 'zero-length', reason: '' },
          null,
          { start: '09:00', end: '11:00', kind: 'open', label: 'A', reason: '' },
        ],
      },
    });
    expect(p!.segments.map((s) => s.label)).toEqual(['A', 'B']);
  });

  it('degrades an unknown kind to the neutral focus tone', () => {
    const p = parsePlan({ plan: { segments: [{ start: '09:00', end: '10:00', kind: 'rave', label: 'x', reason: '' }] } });
    expect(p!.segments[0].kind).toBe('focus');
    expect(PLAN_TONES[p!.segments[0].kind]).toBeDefined();
  });

  it('unwraps spans that cross midnight', () => {
    const p = parsePlan({ plan: { segments: [{ start: '23:00', end: '01:00', kind: 'quiet', label: '守夜', reason: '' }] } });
    expect(p!.segments[0]).toMatchObject({ startMin: 1380, endMin: 1500 });
  });
});

describe('spanInWindow / subtractSpans', () => {
  it('clips a segment to the visible hour', () => {
    // Window 09:30–10:30; segment 09:00–11:00 → exactly the window.
    const spans = spanInWindow(540, 660, at(10, 0));
    expect(spans).toEqual([{ from: at(9, 30), to: at(10, 30) }]);
  });

  it('returns nothing for a segment outside the window', () => {
    expect(spanInWindow(720, 780, at(10, 0))).toEqual([]); // 12:00–13:00 at 10:00
  });

  it('sees a midnight-crossing segment from yesterday inside tonight\'s window', () => {
    // Segment 23:00–01:00 (unwrapped 1380–1500), window 23:45–00:45: the
    // yesterday-anchored span covers the whole window.
    const spans = spanInWindow(1380, 1500, new Date(2026, 6, 13, 0, 15).getTime());
    expect(spans).toEqual([
      { from: new Date(2026, 6, 12, 23, 45).getTime(), to: new Date(2026, 6, 13, 0, 45).getTime() },
    ]);
  });

  it('subtracts holes, splitting where needed', () => {
    const span = [{ from: 0, to: 100 }];
    expect(subtractSpans(span, [{ from: 40, to: 60 }])).toEqual([
      { from: 0, to: 40 }, { from: 60, to: 100 },
    ]);
    expect(subtractSpans(span, [{ from: 200, to: 300 }])).toEqual(span);
    expect(subtractSpans(span, [{ from: -10, to: 110 }])).toEqual([]);
    expect(subtractSpans(span, [{ from: -10, to: 30 }, { from: 90, to: 110 }])).toEqual([
      { from: 30, to: 90 },
    ]);
  });
});

describe('planArcs', () => {
  const plan = parsePlan(contractPlan)!;

  it('maps the current hour slice onto dial angles', () => {
    // At 10:00 the window is 09:30–10:30, all inside the 09:00–11:00 'open'
    // segment, minus the 10:50–11:30 quiet window (outside the window here).
    const arcs = planArcs(plan, at(10, 0));
    expect(arcs).toHaveLength(1);
    expect(arcs[0].kind).toBe('open');
    expect(arcs[0].a0).toBeCloseTo(180); // :30 = bottom of dial
    expect(arcs[0].a1).toBeCloseTo(540); // sweeps the full visible hour
  });

  it('punches the ring out under quiet windows and keeps both kinds', () => {
    // At 11:00 the window is 10:30–11:30: open 10:30–10:50, quiet window
    // 10:50–11:30 (hole), focus segment fully swallowed by the hole.
    const arcs = planArcs(plan, at(11, 0));
    expect(arcs).toHaveLength(1);
    expect(arcs[0].kind).toBe('open');
    expect(arcs[0].a0).toBeCloseTo(180); // 10:30
    expect(arcs[0].a1).toBeCloseTo(180 + 120); // 20 minutes → 120°
  });

  it('is empty with no plan', () => {
    expect(planArcs(null, at(10, 0))).toEqual([]);
  });
});

describe('quietTickAngles', () => {
  const plan = parsePlan(contractPlan)!;

  it('emits one hollow dot per minute of the visible quiet window', () => {
    // At 11:00 the window is 10:30–11:30; quiet 10:50–11:30 → minutes
    // 10:50..11:30 inclusive = 41 dots, starting at 300° (minute :50).
    const angles = quietTickAngles(plan, at(11, 0));
    expect(angles).toHaveLength(41);
    expect(angles[0]).toBeCloseTo(300);           // 10:50 → minute :50
    expect(angles[10]).toBeCloseTo(0);            // 11:00 wraps past the top
    expect(angles[angles.length - 1]).toBeCloseTo(180); // 11:30 → minute :30
  });

  it('is empty when the quiet window is out of view', () => {
    expect(quietTickAngles(plan, at(15, 0))).toEqual([]);
    expect(quietTickAngles(null, at(11, 0))).toEqual([]);
  });
});

describe('sheet helpers', () => {
  const plan = parsePlan(contractPlan)!;

  it('minOfDay / segmentAt find the segment covering now', () => {
    expect(minOfDay(at(9, 30))).toBe(570);
    expect(segmentAt(plan, at(9, 30))?.label).toBe('早安频率');
    expect(segmentAt(plan, at(21, 0))).toBeNull(); // gap between segments
    expect(segmentAt(null, at(9, 30))).toBeNull();
  });

  it('segmentAt handles a midnight-crossing segment', () => {
    const night: DayPlan = parsePlan({
      plan: { segments: [{ start: '23:00', end: '01:00', kind: 'quiet', label: '守夜', reason: '' }] },
    })!;
    expect(segmentAt(night, at(0, 30))?.label).toBe('守夜');
    expect(segmentAt(night, at(23, 30))?.label).toBe('守夜');
    expect(segmentAt(night, at(2, 0))).toBeNull();
  });

  it('planRows interleaves quiet windows chronologically after their segment', () => {
    const rows = planRows(plan);
    expect(rows.map((r) => (r.type === 'segment' ? r.seg.start : `q${r.win.start}`)))
      .toEqual(['09:00', 'q10:50', '11:00', '18:00', '22:00']);
  });
});
