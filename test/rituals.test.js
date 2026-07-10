import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Isolate the store into a temp dir so fixture plays never touch state.json.
let tmpDir;
let db;
let weeklyRecapFact;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurio-rituals-'));
  process.env.AURIO_DATA_DIR = tmpDir;
  const url = pathToFileURL(path.resolve('server/rituals.js')).href;
  ({ weeklyRecapFact } = await import(`${url}?t=${Date.now()}`));
  ({ db } = await import('../server/store.js'));
});

afterAll(() => {
  delete process.env.AURIO_DATA_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 6, 10, 21, 5).getTime(); // a Friday, 21:05

function seedPlays(rows) {
  db.state.plays.splice(0, db.state.plays.length, ...rows);
}

const play = (artist, title, daysAgo) => ({
  id: `${artist}-${title}-${daysAgo}`, title, artist, source: 'test', ts: NOW - daysAgo * DAY,
});

describe('weeklyRecapFact', () => {
  beforeEach(() => seedPlays([]));

  it('returns null on an empty history — the ritual silently skips', () => {
    expect(weeklyRecapFact(NOW)).toBeNull();
  });

  it('names the top artist and top track of the past 7 days with counts', () => {
    seedPlays([
      play('陈奕迅', '富士山下', 1),
      play('陈奕迅', '富士山下', 2),
      play('陈奕迅', '陀飞轮', 3),
      play('王菲', '暧昧', 4),
    ]);
    expect(weeklyRecapFact(NOW)).toBe(
      '过去 7 天一共播放了 4 次；听得最多的歌手是陈奕迅（3 次）；听得最多的一首是《富士山下》（2 遍）'
    );
  });

  it('ignores plays outside the 7-day window', () => {
    seedPlays([
      play('王菲', '暧昧', 1),
      play('陈奕迅', '富士山下', 8),   // too old
      play('陈奕迅', '富士山下', 9),
      play('陈奕迅', '富士山下', 10),
    ]);
    expect(weeklyRecapFact(NOW)).toBe(
      '过去 7 天一共播放了 1 次；听得最多的歌手是王菲（1 次）；听得最多的一首是《暧昧》（1 遍）'
    );
  });

  it('is deterministic for the same history', () => {
    seedPlays([play('陈奕迅', '陀飞轮', 1), play('王菲', '暧昧', 2)]);
    expect(weeklyRecapFact(NOW)).toBe(weeklyRecapFact(NOW));
  });

  it('breaks count ties by first appearance', () => {
    seedPlays([play('王菲', '暧昧', 3), play('陈奕迅', '陀飞轮', 1)]);
    // Plays are stored oldest-last here; iteration is array order.
    const fact = weeklyRecapFact(NOW);
    expect(fact).toContain('王菲');
    expect(fact).toContain('《暧昧》');
  });

  it('still reports the total when rows lack artist/title', () => {
    seedPlays([
      { id: 'x', title: '', artist: '', source: 'test', ts: NOW - DAY },
      { id: 'y', title: '', artist: '', source: 'test', ts: NOW - 2 * DAY },
    ]);
    expect(weeklyRecapFact(NOW)).toBe('过去 7 天一共播放了 2 次');
  });
});
