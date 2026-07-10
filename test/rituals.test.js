import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Isolate the store into a temp dir so fixture plays never touch state.json.
let tmpDir;
let db;
let weeklyRecapFact;
let firstRunFact;
let performFirstRun;
let firstRunPerformed;
let FIRST_RUN_PREF;
let FIRST_RUN_QUIET_SAY;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurio-rituals-'));
  process.env.AURIO_DATA_DIR = tmpDir;
  const url = pathToFileURL(path.resolve('server/rituals.js')).href;
  ({
    weeklyRecapFact, firstRunFact, performFirstRun, firstRunPerformed,
    FIRST_RUN_PREF, FIRST_RUN_QUIET_SAY,
  } = await import(`${url}?t=${Date.now()}`));
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

// ---------------------------------------------------------------------------
// 开台仪式 — the first-run library-scan fact + once-per-data-dir guard.
// ---------------------------------------------------------------------------

const track = (o = {}) => ({
  source: 'netease', id: '1', title: '十年', artist: '陈奕迅', year: 2003, ...o,
});

// Every source live, injected so no network is touched.
const liveDeps = (o = {}) => ({
  services: { netease: true, navidrome: true, qqmusic: true },
  neteaseLoggedIn: true,
  qqLoggedIn: true,
  candidates: [track()],
  ...o,
});

// Nothing established, no sample — the honest dead permutation.
const deadDeps = (o = {}) => ({
  services: { netease: true, navidrome: false, qqmusic: true },
  neteaseLoggedIn: false,
  qqLoggedIn: false,
  candidates: [],
  ...o,
});

describe('firstRunFact', () => {
  it('names every connected source and the sample track when all are live', async () => {
    const r = await firstRunFact(liveDeps());
    expect(r.fact).toBe(
      '首次开台：这是这台电台第一次为这位听众开播。'
      + '曲库连通：NAS 曲库已连接；网易云已登录；QQ 音乐已登录。'
      + '随手翻到：陈奕迅《十年》（2003）。'
    );
    expect(r.hasSource).toBe(true);
    expect(r.connected).toBe(true);
    expect(r.candidatesText).toContain('陈奕迅 - 十年');
  });

  it('stays honest when only netease is logged in', async () => {
    const r = await firstRunFact(liveDeps({
      services: { netease: true, navidrome: false, qqmusic: true },
      qqLoggedIn: false,
    }));
    expect(r.fact).toContain('曲库连通：网易云已登录；QQ 音乐未登录（内置接口可用）。');
    expect(r.fact).not.toContain('NAS');
    expect(r.hasSource).toBe(true);
  });

  it('reports a NAS-only setup', async () => {
    const r = await firstRunFact(liveDeps({ neteaseLoggedIn: false, qqLoggedIn: false }));
    expect(r.fact).toContain('NAS 曲库已连接；网易云未登录（内置搜索可用）；QQ 音乐未登录（内置接口可用）');
    expect(r.connected).toBe(true);
  });

  it('says nothing is connected when nothing is — and hasSource goes false', async () => {
    const r = await firstRunFact(deadDeps());
    expect(r.fact).toBe(
      '首次开台：这是这台电台第一次为这位听众开播。'
      + '曲库还没连上：网易云未登录，QQ 音乐没有登录凭证，也没有配置 NAS 曲库。'
    );
    expect(r.hasSource).toBe(false);
    expect(r.connected).toBe(false);
    expect(r.candidatesText).toBe('');
  });

  it('an un-connected setup with a public-chart sample can still perform', async () => {
    const r = await firstRunFact(deadDeps({ candidates: [track({ year: undefined })] }));
    expect(r.hasSource).toBe(true);
    expect(r.connected).toBe(false);
    expect(r.fact).toContain('曲库还没连上');
    expect(r.fact).toContain('随手翻到：陈奕迅《十年》。');
  });

  it('omits the sample line when the year is missing but keeps title/artist', async () => {
    const r = await firstRunFact(liveDeps({ candidates: [track({ year: undefined })] }));
    expect(r.fact).toContain('随手翻到：陈奕迅《十年》。');
    expect(r.fact).not.toContain('（2003）');
  });
});

describe('performFirstRun', () => {
  beforeEach(() => {
    delete db.state.prefs[FIRST_RUN_PREF];
  });

  const okSegment = { ts: 1, kind: 'first-run', mode: 'replace', say: '开场', queue: [track()] };

  it('runs one first-run segment with the scan fact and real candidates', async () => {
    const calls = [];
    const runSegment = async (trigger, opts) => { calls.push({ trigger, opts }); return okSegment; };
    const r = await performFirstRun({ runSegment, currentIndex: -1, deps: liveDeps() });
    expect(r).toBe(okSegment);
    expect(calls).toHaveLength(1);
    expect(calls[0].trigger.kind).toBe('first-run');
    expect(calls[0].trigger.fact).toContain('首次开台');
    expect(calls[0].trigger.toolResults).toContain('陈奕迅 - 十年');
    expect(calls[0].opts).toEqual({ mode: 'replace', currentIndex: -1 });
    expect(firstRunPerformed()).toBe(true);
  });

  it('is idempotent: the second call is a no-op that never reaches the DJ', async () => {
    let calls = 0;
    const runSegment = async () => { calls += 1; return okSegment; };
    await performFirstRun({ runSegment, deps: liveDeps() });
    const again = await performFirstRun({ runSegment, deps: liveDeps() });
    expect(calls).toBe(1);
    expect(again).toEqual({ ok: true, alreadyPerformed: true, kind: 'first-run', queue: [] });
  });

  it('answers the quiet ceremony without a segment when nothing can play', async () => {
    let calls = 0;
    const runSegment = async () => { calls += 1; return okSegment; };
    const r = await performFirstRun({ runSegment, deps: deadDeps() });
    expect(calls).toBe(0);
    expect(r.quiet).toBe(true);
    expect(r.say).toBe(FIRST_RUN_QUIET_SAY);
    expect(r.queue).toEqual([]);
    // The guard stays unset: connecting a library later still gets the ceremony.
    expect(firstRunPerformed()).toBe(false);
    const performed = await performFirstRun({ runSegment, deps: liveDeps() });
    expect(calls).toBe(1);
    expect(performed).toBe(okSegment);
    expect(firstRunPerformed()).toBe(true);
  });

  it('keeps the guard unset when the segment fails or queues nothing', async () => {
    await performFirstRun({ runSegment: async () => ({ error: 'boom', queue: [] }), deps: liveDeps() });
    expect(firstRunPerformed()).toBe(false);
    await performFirstRun({ runSegment: async () => ({ ts: 2, say: '', queue: [] }), deps: liveDeps() });
    expect(firstRunPerformed()).toBe(false);
  });
});
