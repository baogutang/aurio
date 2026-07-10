import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Hot reload of the show-boundary crons (server/scheduler.js syncShowCrons):
// editing user/shows.json re-derives the show-open jobs without a restart,
// while a malformed edit keeps the previous schedule and never crashes.

const runSegment = vi.fn(async () => ({ queue: [] }));
const isBusy = vi.fn(() => false);
vi.mock('../server/dj.js', () => ({ runSegment, isBusy }));

const hasActiveSession = vi.fn(() => true);
const currentIndex = vi.fn(() => 2);
vi.mock('../server/radio.js', () => ({ hasActiveSession, currentIndex }));

const hourlyStationId = vi.fn(() => true);
vi.mock('../server/imaging.js', () => ({ hourlyStationId }));

const weeklyRecapFact = vi.fn(() => null);
vi.mock('../server/rituals.js', () => ({ weeklyRecapFact }));

// Real shows.js against a temp data dir seeded with the shipped schedule.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurio-cron-reload-'));
process.env.AURIO_DATA_DIR = tmpDir;
fs.mkdirSync(path.join(tmpDir, 'user'), { recursive: true });
const showsFile = path.join(tmpDir, 'user', 'shows.json');
const seed = fs.readFileSync(path.resolve('user/shows.json'), 'utf8');

const scheduler = await import('../server/scheduler.js');
const { _resetShows } = await import('../server/shows.js');

// listShows() keys its cache by mtime+size; back-to-back writes in the same
// millisecond with the same length would be invisible, exactly like a very
// fast editor. Bump mtime explicitly so every write registers as an edit.
let fakeMtime = Date.now();
function writeShows(content) {
  fs.writeFileSync(showsFile, content);
  fakeMtime += 1000;
  fs.utimesSync(showsFile, new Date(fakeMtime), new Date(fakeMtime));
}

const SEED_KEYS = [
  '早安频率@0 7 * * *',
  '工作台@0 9 * * 1,2,3,4,5',
  '深夜航班@0 21 * * *',
];

beforeEach(() => {
  scheduler.stopScheduler(); // clear any installed show jobs between cases
  _resetShows();
  writeShows(seed);
  runSegment.mockClear();
});

afterEach(() => {
  scheduler.stopScheduler();
  vi.useRealTimers();
});

afterAll(() => {
  delete process.env.AURIO_DATA_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('syncShowCrons', () => {
  it('installs one job per named show from the seed', () => {
    expect(scheduler.syncShowCrons()).toBe(true);
    expect(scheduler.activeShowCrons()).toEqual(SEED_KEYS);
    // a no-change pass is a no-op
    expect(scheduler.syncShowCrons()).toBe(false);
    expect(scheduler.activeShowCrons()).toEqual(SEED_KEYS);
  });

  it('an added show gains a boundary without restart; the others keep their jobs', () => {
    scheduler.syncShowCrons();
    const parsed = JSON.parse(seed);
    parsed.shows.push({
      name: '午后茶', start: '15:00', end: '17:00', talkBudget: 2,
      tone: '慢一点', musicRules: '下午茶',
    });
    writeShows(JSON.stringify(parsed));
    expect(scheduler.syncShowCrons()).toBe(true);
    expect(scheduler.activeShowCrons()).toEqual([...SEED_KEYS, '午后茶@0 15 * * *']);
  });

  it("a removed show's cron is torn down", () => {
    scheduler.syncShowCrons();
    const parsed = JSON.parse(seed);
    parsed.shows = parsed.shows.filter((s) => s.name !== '深夜航班');
    writeShows(JSON.stringify(parsed));
    expect(scheduler.syncShowCrons()).toBe(true);
    expect(scheduler.activeShowCrons()).toEqual(SEED_KEYS.filter((k) => !k.startsWith('深夜航班')));
  });

  it('a re-timed show swaps its job (old expr gone, new expr live)', () => {
    scheduler.syncShowCrons();
    const parsed = JSON.parse(seed);
    parsed.shows.find((s) => s.name === '深夜航班').start = '22:00';
    writeShows(JSON.stringify(parsed));
    scheduler.syncShowCrons();
    expect(scheduler.activeShowCrons()).toContain('深夜航班@0 22 * * *');
    expect(scheduler.activeShowCrons()).not.toContain('深夜航班@0 21 * * *');
  });

  it('a malformed edit keeps the previous schedule and never throws', () => {
    scheduler.syncShowCrons();
    writeShows('{ this is not json');
    expect(scheduler.syncShowCrons()).toBe(false);
    expect(scheduler.activeShowCrons()).toEqual(SEED_KEYS);
    // repairing the file resumes normal syncing
    const parsed = JSON.parse(seed);
    parsed.shows = parsed.shows.slice(0, 1);
    writeShows(JSON.stringify(parsed));
    expect(scheduler.syncShowCrons()).toBe(true);
    expect(scheduler.activeShowCrons()).toEqual(SEED_KEYS.slice(0, 1));
  });

  it('an explicitly empty schedule (valid JSON) removes every boundary — that is intent, not damage', () => {
    scheduler.syncShowCrons();
    writeShows('{ "shows": [] }');
    expect(scheduler.syncShowCrons()).toBe(true);
    expect(scheduler.activeShowCrons()).toEqual([]);
  });
});

describe('the poll wiring', () => {
  it('startScheduler picks up an edit within the reload interval', () => {
    vi.useFakeTimers();
    scheduler.startScheduler();
    expect(scheduler.activeShowCrons()).toEqual(SEED_KEYS);

    const parsed = JSON.parse(seed);
    parsed.shows.push({
      name: '晚风', start: '19:00', end: '20:00', talkBudget: 1,
      tone: '轻', musicRules: '晚风歌单',
    });
    writeShows(JSON.stringify(parsed));
    expect(scheduler.activeShowCrons()).toEqual(SEED_KEYS); // not yet — poll hasn't ticked

    vi.advanceTimersByTime(31000);
    expect(scheduler.activeShowCrons()).toEqual([...SEED_KEYS, '晚风@0 19 * * *']);
  });
});
