import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurio-show-sched-'));
process.env.AURIO_DATA_DIR = tmpDir;
fs.mkdirSync(path.join(tmpDir, 'user'), { recursive: true });
fs.copyFileSync(path.resolve('user/shows.json'), path.join(tmpDir, 'user', 'shows.json'));

const scheduler = await import('../server/scheduler.js');

// 2026-07-08 is a Wednesday.
const wed = (h, m = 0) => new Date(2026, 6, 8, h, m);

beforeEach(() => {
  runSegment.mockClear();
  hasActiveSession.mockReturnValue(true);
  weeklyRecapFact.mockReturnValue(null);
});

afterAll(() => {
  scheduler.stopScheduler();
  delete process.env.AURIO_DATA_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('show-boundary crons derived from the schedule', () => {
  it('emits one cron per named show, honouring days', () => {
    expect(scheduler.showOpenCrons()).toEqual([
      { name: '早安频率', expr: '0 7 * * *' },
      { name: '工作台', expr: '0 9 * * 1,2,3,4,5' },
      { name: '深夜航班', expr: '0 21 * * *' },
    ]);
  });

  it('all derived expressions are accepted by node-cron (startScheduler does not throw)', () => {
    scheduler.startScheduler();
    scheduler.stopScheduler();
  });
});

describe('openShow', () => {
  it('runs one spoken opening in chat mode — never a queue-touching mode', async () => {
    await scheduler.openShow('深夜航班', wed(21, 0));
    expect(runSegment).toHaveBeenCalledTimes(1);
    const [trigger, opts] = runSegment.mock.calls[0];
    expect(trigger).toEqual({ kind: 'show-open' });
    expect(opts.mode).toBe('chat');
  });

  it('stays quiet when first-match-wins hands the slot to another show', async () => {
    // 深夜航班 is not on air at 10:00 — a stale or overlapped cron must no-op.
    await scheduler.openShow('深夜航班', wed(10, 0));
    expect(runSegment).not.toHaveBeenCalled();
  });
});

describe('fridayRecap', () => {
  it('speaks the deterministic fact through a recap trigger', async () => {
    weeklyRecapFact.mockReturnValue('过去 7 天一共播放了 4 次；听得最多的歌手是陈奕迅（3 次）');
    await scheduler.fridayRecap();
    expect(runSegment).toHaveBeenCalledTimes(1);
    const [trigger, opts] = runSegment.mock.calls[0];
    expect(trigger.kind).toBe('recap');
    expect(trigger.fact).toContain('陈奕迅');
    expect(opts.mode).toBe('chat');
  });

  it('silently skips when history is empty', async () => {
    weeklyRecapFact.mockReturnValue(null);
    expect(scheduler.fridayRecap()).toBeNull();
    expect(runSegment).not.toHaveBeenCalled();
  });
});
