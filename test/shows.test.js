import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Isolate the store's on-disk writes into a temp dir so the talk ledger and
// the shows file never touch the project's real user data.
let tmpDir;
let shows;
let db;

const SEED = fs.readFileSync(path.resolve('user/shows.json'), 'utf8');

function showsPath() {
  return path.join(tmpDir, 'user', 'shows.json');
}

function writeShows(content) {
  fs.writeFileSync(showsPath(), typeof content === 'string' ? content : JSON.stringify(content));
  shows._resetShows();
}

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurio-shows-'));
  process.env.AURIO_DATA_DIR = tmpDir;
  fs.mkdirSync(path.join(tmpDir, 'user'), { recursive: true });
  fs.writeFileSync(showsPath(), SEED);
  const url = pathToFileURL(path.resolve('server/shows.js')).href;
  shows = await import(`${url}?t=${Date.now()}`);
  ({ db } = await import('../server/store.js'));
});

afterAll(() => {
  delete process.env.AURIO_DATA_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Local-time date helper. 2026-07-08 is a Wednesday, 2026-07-11 a Saturday.
const wed = (h, m = 0) => new Date(2026, 6, 8, h, m);
const sat = (h, m = 0) => new Date(2026, 6, 11, h, m);

describe('the shipped seed schedule', () => {
  beforeEach(() => writeShows(SEED));

  it('parses into exactly the three vision-doc shows', () => {
    expect(shows.listShows().map((s) => s.name)).toEqual(['早安频率', '工作台', '深夜航班']);
  });

  it('resolves each daypart to its show', () => {
    expect(shows.currentShow(wed(8)).name).toBe('早安频率');
    expect(shows.currentShow(wed(7, 0)).name).toBe('早安频率');   // inclusive start
    expect(shows.currentShow(wed(10)).name).toBe('工作台');
    expect(shows.currentShow(wed(9, 0)).name).toBe('工作台');     // morning end is exclusive
    expect(shows.currentShow(wed(22)).name).toBe('深夜航班');
    expect(shows.currentShow(wed(23, 59)).name).toBe('深夜航班'); // end 24:00 covers the last minute
  });

  it('uncovered hours fall to the implicit default show', () => {
    expect(shows.currentShow(wed(0, 30)).name).toBe(shows.DEFAULT_SHOW.name);
    expect(shows.currentShow(wed(19)).name).toBe(shows.DEFAULT_SHOW.name);   // evening gap
    expect(shows.currentShow(wed(0, 30)).isDefault).toBe(true);
  });

  it('respects days: 工作台 is weekdays-only', () => {
    expect(shows.currentShow(sat(10)).name).toBe(shows.DEFAULT_SHOW.name);
  });

  it('carries the vision-doc knobs through validation', () => {
    const morning = shows.currentShow(wed(8));
    expect(morning.familiarOnly).toBe(true);
    expect(morning.talkBudget).toBe(4);
    const night = shows.currentShow(wed(22));
    expect(night.talkBudget).toBe(3);
    expect(night.sayMax).toBe(40);
    expect(night.segueMax).toBe(30);
    expect(night.freq).toBe('88.7');
  });
});

describe('resolution rules', () => {
  it('first match wins on overlaps', () => {
    writeShows({ shows: [
      { name: 'A', start: '08:00', end: '12:00', talkBudget: 1 },
      { name: 'B', start: '10:00', end: '14:00', talkBudget: 1 },
    ] });
    expect(shows.currentShow(wed(11)).name).toBe('A');
    expect(shows.currentShow(wed(13)).name).toBe('B');
  });

  it('accepts a bare array as well as { shows: [...] }', () => {
    writeShows([{ name: 'Bare', start: '00:00', end: '24:00', talkBudget: 1 }]);
    expect(shows.currentShow(wed(12)).name).toBe('Bare');
  });

  it('handles a midnight-crossing window', () => {
    writeShows({ shows: [{ name: '夜航', start: '22:00', end: '02:00', talkBudget: 1 }] });
    expect(shows.currentShow(wed(23)).name).toBe('夜航');
    expect(shows.currentShow(wed(1, 30)).name).toBe('夜航');
    expect(shows.currentShow(wed(3)).name).toBe(shows.DEFAULT_SHOW.name);
  });

  it('the post-midnight tail of a crossing show belongs to its start day', () => {
    writeShows({ shows: [{ name: '周五夜', start: '22:00', end: '02:00', days: [5], talkBudget: 1 }] });
    expect(shows.currentShow(new Date(2026, 6, 10, 23)).name).toBe('周五夜'); // Friday night
    expect(shows.currentShow(sat(1)).name).toBe('周五夜');                    // Saturday 01:00, started Friday
    expect(shows.currentShow(new Date(2026, 6, 10, 1)).name)                 // Friday 01:00 is Thursday's tail
      .toBe(shows.DEFAULT_SHOW.name);
  });
});

describe('malformed input never crashes the station', () => {
  it('unparseable JSON degrades to the default show and warns once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      writeShows('{ this is not json');
      expect(shows.currentShow(wed(8)).name).toBe(shows.DEFAULT_SHOW.name);
      shows.currentShow(wed(22)); // second resolve of the same broken file
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('a non-array shows field degrades to the default show', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      writeShows({ shows: 'nope' });
      expect(shows.currentShow(wed(8)).name).toBe(shows.DEFAULT_SHOW.name);
    } finally {
      warn.mockRestore();
    }
  });

  it('drops invalid entries but keeps valid siblings', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      writeShows({ shows: [
        { start: '08:00', end: '12:00', talkBudget: 1 },                 // no name
        { name: '倒着走', start: '24:00', end: '02:00', talkBudget: 1 }, // can't start at 24:00
        { name: '零长', start: '10:00', end: '10:00', talkBudget: 1 },   // zero-length
        { name: '坏日子', start: '08:00', end: '12:00', days: [], talkBudget: 1 },
        { name: '没预算', start: '08:00', end: '12:00' },                // talkBudget required
        { name: '好台', start: '08:00', end: '12:00', talkBudget: 2 },
      ] });
      expect(shows.listShows().map((s) => s.name)).toEqual(['好台']);
      expect(shows.currentShow(wed(9)).name).toBe('好台');
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('a missing file falls back to the built-in seed (upgraded installs)', () => {
    fs.rmSync(showsPath());
    shows._resetShows();
    try {
      expect(shows.currentShow(wed(8)).name).toBe('早安频率');
      expect(shows.currentShow(wed(22)).name).toBe('深夜航班');
    } finally {
      writeShows(SEED);
    }
  });

  it('an explicitly empty schedule is honoured: default show all day', () => {
    writeShows({ shows: [] });
    expect(shows.currentShow(wed(8)).name).toBe(shows.DEFAULT_SHOW.name);
  });
});

describe('talk budget', () => {
  beforeEach(() => {
    writeShows(SEED);
    db.setPref(shows.TALK_LEDGER_KEY, []);
  });

  const T = wed(22).getTime(); // inside 深夜航班 (budget 3, started 21:00)
  const MIN = 60 * 1000;

  it('allows a scheduled break while the budget has room', () => {
    const t = shows.consultTalkBudget('refill', T);
    expect(t).toMatchObject({ allowed: true, exempt: false, spent: 0, budget: 3 });
    expect(t.show.name).toBe('深夜航班');
  });

  it('mutes scheduled breaks once the hourly budget is spent', () => {
    shows.recordSpokenBreak(T);
    shows.recordSpokenBreak(T + MIN);
    shows.recordSpokenBreak(T + 2 * MIN);
    const t = shows.consultTalkBudget('refill', T + 3 * MIN);
    expect(t.allowed).toBe(false);
    expect(t.spent).toBe(3);
  });

  it('user chat is always exempt', () => {
    shows.recordSpokenBreak(T);
    shows.recordSpokenBreak(T + MIN);
    shows.recordSpokenBreak(T + 2 * MIN);
    const t = shows.consultTalkBudget('chat', T + 3 * MIN);
    expect(t.allowed).toBe(true);
    expect(t.exempt).toBe(true);
  });

  it('the window rolls: an hour-old break stops counting', () => {
    const tenAM = wed(10).getTime(); // 工作台, budget 1
    shows.recordSpokenBreak(tenAM);
    expect(shows.consultTalkBudget('refill', wed(10, 30).getTime()).allowed).toBe(false);
    expect(shows.consultTalkBudget('refill', wed(11, 1).getTime()).allowed).toBe(true);
  });

  it('a show boundary resets the window: the incoming show opens with a fresh voice', () => {
    // Three breaks at 20:30 would exhaust any budget on a pure rolling hour…
    const t2030 = wed(20, 30).getTime();
    shows.recordSpokenBreak(t2030);
    shows.recordSpokenBreak(t2030 + MIN);
    shows.recordSpokenBreak(t2030 + 2 * MIN);
    // …but 深夜航班 started at 21:00, and its window starts there too.
    const t = shows.consultTalkBudget('show-open', wed(21, 5).getTime());
    expect(t.allowed).toBe(true);
    expect(t.spent).toBe(0);
  });

  it('recordSpokenBreak prunes entries older than an hour and caps the ledger', () => {
    shows.recordSpokenBreak(T - 2 * 60 * MIN);
    shows.recordSpokenBreak(T);
    expect(db.getPref(shows.TALK_LEDGER_KEY, [])).toEqual([T]);
    for (let i = 0; i < 80; i++) shows.recordSpokenBreak(T + i);
    expect(db.getPref(shows.TALK_LEDGER_KEY, []).length).toBeLessThanOrEqual(60);
  });
});
