// 今日节目单 (P5 workstream B): the deterministic quiet-window derivation, the
// LLM plan validation/fallback matrix, isQuietNow, the morning announcement
// fact, and the /api/plan projection. Every spend path is injected — no brain,
// no calendar, no weather ever gets called from here.
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolate the store (db prefs) into a temp dir before any server import.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurio-plan-'));
process.env.AURIO_DATA_DIR = tmpDir;

const plan = await import('../server/plan.js');
const { db } = await import('../server/store.js');

afterAll(() => {
  delete process.env.AURIO_DATA_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// A fixed local day: 2026-07-08 is a Wednesday.
const day = (h, m = 0) => new Date(2026, 6, 8, h, m).getTime();
const NOW = day(7, 0);
const DATE = '2026-07-08';
const MIN = 60000;

const ev = (title, startH, startM, endH, endM) => ({
  title,
  start: day(startH, startM),
  end: endH != null ? day(endH, endM ?? 0) : null,
  source: 'ics',
});

const fixtureShows = [
  {
    name: '早安频率', start: '07:00', end: '09:00', startMin: 420, endMin: 540,
    days: undefined, talkBudget: 3, tone: '清醒、轻快', musicRules: '', isDefault: false,
  },
  {
    name: '工作台', start: '09:00', end: '18:00', startMin: 540, endMin: 1080,
    days: [1, 2, 3, 4, 5], talkBudget: 1, tone: '近乎不说话', musicRules: '', isDefault: false,
  },
  {
    name: '深夜航班', start: '21:00', end: '24:00', startMin: 1260, endMin: 1440,
    days: undefined, talkBudget: 2, tone: '语速慢', musicRules: '', isDefault: false,
  },
];

beforeEach(() => {
  db.setPref(plan.DAY_PLAN_KEY, null);
  db.setPref(plan.PLAN_ANNOUNCED_KEY, null);
  plan._resetPlanState();
});

describe('deriveQuietWindows (deterministic — the LLM never touches meetings)', () => {
  it('a timed event opens a window from start−10min to its end', () => {
    const w = plan.deriveQuietWindows([ev('产品评审会', 11, 0, 12, 0)], NOW);
    expect(w).toEqual([{ start: '10:50', end: '12:00', reason: '11:00 的产品评审会' }]);
  });

  it('an event without an end is assumed an hour long', () => {
    const w = plan.deriveQuietWindows([ev('站会', 11, 0, null)], NOW);
    expect(w).toEqual([{ start: '10:50', end: '12:00', reason: '11:00 的站会' }]);
  });

  it('overlapping and touching windows merge, reasons joined', () => {
    const w = plan.deriveQuietWindows([
      ev('评审', 11, 0, 11, 30),
      ev('复盘', 11, 30, 12, 0),   // starts inside the first window's lead
      ev('独立会', 15, 0, 15, 30),
    ], NOW);
    expect(w).toEqual([
      { start: '10:50', end: '12:00', reason: '11:00 的评审、11:30 的复盘' },
      { start: '14:50', end: '15:30', reason: '15:00 的独立会' },
    ]);
  });

  it('excludes all-day and untimed events', () => {
    const midnight = new Date(2026, 6, 8, 0, 0).getTime();
    const w = plan.deriveQuietWindows([
      { title: '生日', start: midnight, end: midnight + 24 * 60 * MIN, source: 'ics' }, // all-day span
      { title: '假期', start: midnight, end: null, source: 'ics' },                     // ICS all-day shape
      { title: '备忘', start: null, end: null, source: 'system' },                      // untimed row
      ev('真会议', 14, 0, 14, 30),
    ], NOW);
    expect(w).toEqual([{ start: '13:50', end: '14:30', reason: '14:00 的真会议' }]);
  });

  it('clips to today and drops events on other days', () => {
    const w = plan.deriveQuietWindows([
      ev('凌晨会', 0, 5, 0, 30),                                       // lead clips at 00:00
      { title: '昨晚的', start: day(0, 0) - 3 * 60 * MIN, end: day(0, 0) - 2 * 60 * MIN, source: 'ics' },
      { title: '跨午夜', start: day(23, 30), end: day(23, 30) + 60 * MIN, source: 'ics' }, // end clips at 24:00
    ], NOW);
    expect(w).toEqual([
      { start: '00:00', end: '00:30', reason: '00:05 的凌晨会' },
      { start: '23:20', end: '24:00', reason: '23:30 的跨午夜' },
    ]);
  });

  it('caps at 8 windows after merging', () => {
    const events = Array.from({ length: 12 }, (_, i) => ev(`会${i}`, i + 6, 0, i + 6, 20));
    expect(plan.deriveQuietWindows(events, NOW)).toHaveLength(8);
  });
});

describe('generatePlan — validation and fallback matrix', () => {
  const events = [ev('产品评审会', 11, 0, 12, 0)];
  const goodReply = JSON.stringify({
    note: '会前专注，晚上放松',
    segments: [
      { start: '07:00', end: '09:00', kind: 'open', label: '醒神', reason: '起床要软' },
      { start: '09:00', end: '18:00', kind: 'focus', label: '工作台', reason: '工作日' },
      { start: '21:00', end: '24:00', kind: 'winddown', label: '夜航', reason: '收束' },
    ],
  });

  it('a valid reply becomes the plan: segments normalized, windows deterministic', async () => {
    const ask = vi.fn(async () => goodReply);
    const p = await plan.generatePlan({ now: NOW, ask, events, weather: null, shows: fixtureShows });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(p.date).toBe(DATE);
    expect(p.generatedAt).toBe(NOW);
    expect(p.source).toBe('llm');
    expect(p.note).toBe('会前专注，晚上放松');
    expect(p.segments).toEqual([
      { start: '07:00', end: '09:00', kind: 'open', label: '醒神', reason: '起床要软' },
      { start: '09:00', end: '18:00', kind: 'focus', label: '工作台', reason: '工作日' },
      { start: '21:00', end: '24:00', kind: 'winddown', label: '夜航', reason: '收束' },
    ]);
    // Quiet windows come from code, whatever the model said.
    expect(p.quietWindows).toEqual([{ start: '10:50', end: '12:00', reason: '11:00 的产品评审会' }]);
    // Persisted under the pref.
    expect(db.getPref(plan.DAY_PLAN_KEY).date).toBe(DATE);
  });

  it('the prompt carries events, windows, weather and shows — the facts, not vibes', async () => {
    const ask = vi.fn(async () => goodReply);
    await plan.generatePlan({
      now: NOW, ask, events,
      weather: { city: '上海', desc: '小雨', temp: 24, feels: 26 },
      shows: fixtureShows,
    });
    const prompt = ask.mock.calls[0][0];
    expect(prompt).toContain('产品评审会');
    expect(prompt).toContain('10:50–11:30'.slice(0, 5)); // the window start
    expect(prompt).toContain('小雨');
    expect(prompt).toContain('《深夜航班》');
    expect(prompt).toContain('原始 JSON');
  });

  it('an invalid reply retries once, then a still-bad reply falls to the skeleton', async () => {
    const bads = [
      '这不是 JSON',
      JSON.stringify({ segments: [{ start: '9点', end: '11:00', kind: 'focus' }] }),   // unparseable time
    ];
    const ask = vi.fn(async () => bads[Math.min(ask.mock.calls.length - 1, 1)]);
    const p = await plan.generatePlan({ now: NOW, ask, events, weather: null, shows: fixtureShows });
    expect(ask).toHaveBeenCalledTimes(2); // initial + one retry
    expect(p.source).toBe('skeleton');
    // Skeleton = the shows, deterministically kinded (Wednesday: 工作台 airs).
    expect(p.segments).toEqual([
      { start: '07:00', end: '09:00', kind: 'open', label: '早安频率', reason: '节目表《早安频率》照常' },
      { start: '09:00', end: '18:00', kind: 'focus', label: '工作台', reason: '节目表《工作台》照常' },
      { start: '21:00', end: '24:00', kind: 'winddown', label: '深夜航班', reason: '节目表《深夜航班》照常' },
    ]);
    // The meeting still silences — windows never depended on the LLM.
    expect(p.quietWindows).toEqual([{ start: '10:50', end: '12:00', reason: '11:00 的产品评审会' }]);
  });

  it('a retry that succeeds is accepted', async () => {
    const ask = vi.fn()
      .mockResolvedValueOnce('垃圾')
      .mockResolvedValueOnce(goodReply);
    const p = await plan.generatePlan({ now: NOW, ask, events: [], weather: null, shows: fixtureShows });
    expect(ask).toHaveBeenCalledTimes(2);
    expect(p.source).toBe('llm');
  });

  it('an ask that throws falls through the same path', async () => {
    const ask = vi.fn(async () => { throw new Error('brain down'); });
    const p = await plan.generatePlan({ now: NOW, ask, events: [], weather: null, shows: fixtureShows });
    expect(p.source).toBe('skeleton');
    expect(p.quietWindows).toEqual([]); // no calendar → zero windows, honestly
  });

  it('rejects out-of-enum kinds, past-midnight times, >10 segments, and empty lists', async () => {
    const cases = [
      { segments: [{ start: '09:00', end: '10:00', kind: 'party' }] },
      { segments: [{ start: '21:00', end: '24:30', kind: 'winddown' }] }, // beyond today
      { segments: [{ start: '24:00', end: '24:00', kind: 'quiet' }] },    // can't begin at day end
      { segments: Array.from({ length: 11 }, (_, i) => ({ start: '09:00', end: '10:00', kind: 'focus', label: String(i) })) },
      { segments: [] },
    ];
    for (const bad of cases) {
      expect(plan.validatePlanReply(bad)).toBeNull();
    }
  });

  it('regenerates only when the date changes or force is set', async () => {
    const ask = vi.fn(async () => goodReply);
    const first = await plan.generatePlan({ now: NOW, ask, events, weather: null, shows: fixtureShows });
    const again = await plan.generatePlan({ now: day(9), ask, events, weather: null, shows: fixtureShows });
    expect(again).toEqual(first);        // same day → stored plan, no new ask
    expect(ask).toHaveBeenCalledTimes(1);
    await plan.generatePlan({ now: day(10), ask, events, weather: null, shows: fixtureShows, force: true });
    expect(ask).toHaveBeenCalledTimes(2); // force regenerates
    const nextDay = new Date(2026, 6, 9, 7).getTime();
    const p3 = await plan.generatePlan({ now: nextDay, ask, events: [], weather: null, shows: fixtureShows });
    expect(p3.date).toBe('2026-07-09');   // date change regenerates
    expect(ask).toHaveBeenCalledTimes(3);
  });
});

describe('isQuietNow', () => {
  const seed = (windows, date = DATE) => db.setPref(plan.DAY_PLAN_KEY, {
    date, generatedAt: NOW, segments: [], quietWindows: windows, note: '', source: 'llm',
  });

  it('inside a window returns it (reason included); outside returns null', () => {
    seed([{ start: '10:50', end: '11:30', reason: '11:00 的会' }]);
    expect(plan.isQuietNow(day(11, 0))).toEqual({ start: '10:50', end: '11:30', reason: '11:00 的会' });
    expect(plan.isQuietNow(day(10, 50))).toBeTruthy();  // start is inclusive
    expect(plan.isQuietNow(day(11, 30))).toBeNull();    // end is exclusive
    expect(plan.isQuietNow(day(9, 0))).toBeNull();
  });

  it('a stale plan (yesterday) never silences today', () => {
    seed([{ start: '00:00', end: '24:00', reason: '昨天的' }], '2026-07-07');
    expect(plan.isQuietNow(day(12))).toBeNull();
  });

  it('no plan at all → null', () => {
    expect(plan.isQuietNow(day(12))).toBeNull();
  });
});

describe('planOpenFact — the morning announcement', () => {
  const goodReply = JSON.stringify({
    note: '十一点前少说话',
    segments: [{ start: '07:00', end: '11:00', kind: 'open', label: '上午', reason: '会前' }],
  });
  const events = [ev('产品评审会', 11, 0, 12, 0)];

  it('generates on demand and states windows + segments + note', async () => {
    const ask = vi.fn(async () => goodReply);
    const fact = await plan.planOpenFact(new Date(NOW), { ask, events, weather: null, shows: fixtureShows });
    expect(fact).toContain('10:50–12:00');
    expect(fact).toContain('产品评审会');
    expect(fact).toContain('07:00–11:00 上午');
    expect(fact).toContain('十一点前少说话');
  });

  it('announces at most once per day', async () => {
    const ask = vi.fn(async () => goodReply);
    const opts = { ask, events, weather: null, shows: fixtureShows };
    expect(await plan.planOpenFact(new Date(NOW), opts)).toBeTruthy();
    expect(await plan.planOpenFact(new Date(day(9, 0)), opts)).toBeNull();
  });

  it('stays silent after noon — the day plan is a morning story', async () => {
    const ask = vi.fn(async () => goodReply);
    expect(await plan.planOpenFact(new Date(day(21, 0)), { ask, events, weather: null, shows: fixtureShows })).toBeNull();
    expect(ask).not.toHaveBeenCalled(); // and spends nothing
  });
});

describe('publicPlan (the /api/plan projection)', () => {
  it('projects exactly the contract fields, stripping source', () => {
    db.setPref(plan.DAY_PLAN_KEY, {
      date: plan.localDateKey(Date.now()), generatedAt: 123,
      segments: [{ start: '09:00', end: '11:00', kind: 'focus', label: 'x', reason: 'y' }],
      quietWindows: [], note: '基调', source: 'llm',
    });
    expect(plan.publicPlan()).toEqual({
      date: plan.localDateKey(Date.now()),
      generatedAt: 123,
      segments: [{ start: '09:00', end: '11:00', kind: 'focus', label: 'x', reason: 'y' }],
      quietWindows: [],
      note: '基调',
    });
  });

  it('a stale or missing plan is null', () => {
    expect(plan.publicPlan()).toBeNull();
    db.setPref(plan.DAY_PLAN_KEY, { date: '2020-01-01', generatedAt: 1, segments: [], quietWindows: [], note: '' });
    expect(plan.publicPlan()).toBeNull();
  });
});
