// Monthly play rollups (server/agent/rollups.js) — the long-term memory that
// outlives the 2000-row plays cap. Policy under test: the CURRENT month is
// recomputed from plays on every fold, PAST months freeze once folded, and
// the ledger stays bounded to 24 months.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Local-time fixture months (rollups fold by the host's calendar month).
const ts = (y, m, day = 10) => new Date(y, m - 1, day, 12, 0, 0).getTime();
const NOW = ts(2026, 7, 10);

let tmpDir;
let db;
let rollups;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurio-rollups-'));
  process.env.AURIO_DATA_DIR = tmpDir;
  rollups = await import('../server/agent/rollups.js');
  ({ db } = await import('../server/store.js'));
});

afterAll(() => {
  delete process.env.AURIO_DATA_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  db.state.plays.splice(0);
  db.state.prefs = {};
});

function addPlay(title, artist, at) {
  db.state.plays.push({ id: title, title, artist, source: 'netease', ts: at });
}

describe('monthKey', () => {
  it('uses the local calendar month, zero-padded and sortable', () => {
    expect(rollups.monthKey(ts(2026, 7))).toBe('2026-07');
    expect(rollups.monthKey(ts(2025, 11))).toBe('2025-11');
    expect('2025-11' < '2026-07').toBe(true);
  });
});

describe('foldRollups', () => {
  it('tallies topTracks / topArtists / totalPlays per month from plays', () => {
    for (let i = 0; i < 14; i++) addPlay('夜曲', '周杰伦', ts(2025, 11, 1 + i));
    for (let i = 0; i < 3; i++) addPlay('晴天', '周杰伦', ts(2025, 11, 20 + i));
    addPlay('浮夸', '陈奕迅', ts(2025, 11, 25));
    addPlay('十年', '陈奕迅', ts(2025, 12, 5));

    const out = rollups.foldRollups(NOW);
    const nov = out['2025-11'];
    expect(nov.totalPlays).toBe(18);
    expect(nov.topTracks[0]).toEqual({ key: '周杰伦 — 夜曲', artist: '周杰伦', title: '夜曲', count: 14 });
    expect(nov.topTracks[1].count).toBe(3);
    expect(nov.topArtists[0]).toEqual({ artist: '周杰伦', count: 17 });
    expect(nov.topArtists[1]).toEqual({ artist: '陈奕迅', count: 1 });
    expect(out['2025-12'].totalPlays).toBe(1);
    // persisted via prefs
    expect(db.getPref(rollups.ROLLUP_KEY)['2025-11'].totalPlays).toBe(18);
  });

  it('recomputes the current month on every fold', () => {
    addPlay('夜曲', '周杰伦', ts(2026, 7, 1));
    let out = rollups.foldRollups(NOW);
    expect(out['2026-07'].totalPlays).toBe(1);

    addPlay('夜曲', '周杰伦', ts(2026, 7, 9));
    addPlay('晴天', '周杰伦', ts(2026, 7, 9));
    out = rollups.foldRollups(NOW);
    expect(out['2026-07'].totalPlays).toBe(3);
    expect(out['2026-07'].topTracks[0].count).toBe(2);
  });

  it('freezes past months: their rollup never changes once folded', () => {
    for (let i = 0; i < 5; i++) addPlay('夜曲', '周杰伦', ts(2026, 6, 1 + i));
    rollups.foldRollups(ts(2026, 6, 20)); // folded while June was current
    expect(rollups.getRollups()['2026-06'].totalPlays).toBe(5);

    // July: June rows partially evicted (the plays cap at work) — the frozen
    // rollup must not be recomputed from the mutilated history.
    db.state.plays.splice(0, 3);
    addPlay('十年', '陈奕迅', ts(2026, 7, 2));
    const out = rollups.foldRollups(NOW);
    expect(out['2026-06'].totalPlays).toBe(5); // frozen
    expect(out['2026-07'].totalPlays).toBe(1);
  });

  it('folds a month first seen after it ended (app off across the boundary) once', () => {
    // No fold ever ran during June; its rows are still in plays in July.
    for (let i = 0; i < 4; i++) addPlay('夜曲', '周杰伦', ts(2026, 6, 10 + i));
    const out = rollups.foldRollups(NOW);
    expect(out['2026-06'].totalPlays).toBe(4);
  });

  it('tops out at 20 tracks / 10 artists per month', () => {
    for (let i = 0; i < 25; i++) addPlay(`歌${i}`, `人${i % 12}`, ts(2026, 7, 1 + (i % 28)));
    const out = rollups.foldRollups(NOW);
    expect(out['2026-07'].topTracks.length).toBe(20);
    expect(out['2026-07'].topArtists.length).toBe(10);
    expect(out['2026-07'].totalPlays).toBe(25);
  });

  it('keeps only the newest 24 months', () => {
    const old = {};
    for (let i = 0; i < 30; i++) {
      const y = 2022 + Math.floor(i / 12);
      const m = (i % 12) + 1;
      old[`${y}-${String(m).padStart(2, '0')}`] = { topTracks: [], topArtists: [], totalPlays: i };
    }
    db.setPref(rollups.ROLLUP_KEY, old);
    addPlay('夜曲', '周杰伦', NOW);
    const out = rollups.foldRollups(NOW);
    const keys = Object.keys(out).sort();
    expect(keys.length).toBe(rollups.ROLLUP_MONTHS_KEPT);
    expect(keys[keys.length - 1]).toBe('2026-07'); // the current month survived
    expect(keys[0]).toBe('2022-08');               // 31 candidates − 24 kept = oldest 7 dropped
  });

  it('ignores garbage rows and never folds the future', () => {
    db.state.plays.push({ title: '坏行', artist: 'x' });            // no ts
    addPlay('未来的歌', '穿越者', ts(2026, 9, 1));                    // clock skew
    addPlay('夜曲', '周杰伦', NOW);
    const out = rollups.foldRollups(NOW);
    expect(Object.keys(out)).toEqual(['2026-07']);
    expect(out['2026-07'].totalPlays).toBe(1);
  });
});
