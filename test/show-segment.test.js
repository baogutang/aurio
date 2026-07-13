// The talk budget at the DJ seam: composeSegment consults the current show
// before prompting, forces silence for an over-budget break BEFORE the judge
// (so the retry loop never fires for it), applies the show's tighter length
// budgets inside the judge, and runSegment records only breaks that aired.
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const think = vi.fn();
vi.mock('../server/brain/index.js', () => ({ think, ask: think }));

vi.mock('../server/tts/index.js', () => ({
  cachedSynthesis: vi.fn(() => null),
  synthesizeBackground: vi.fn(),
}));

// Keep the prompt assembly offline and deterministic.
vi.mock('../server/weather/openweather.js', () => ({
  weather: { enabled: () => false, current: async () => null },
}));
vi.mock('../server/calendar/index.js', () => ({ todayEvents: async () => [] }));

// No real library lookups — these tests are about speech, not tracks.
vi.mock('../server/music/index.js', () => ({
  resolveQueue: async () => [],
  playbackUrl: async () => null,
  requestConstraints: () => ({}),
  hasHardConstraints: () => false,
  describeConstraints: () => '',
  requestCandidates: async () => [],
  candidatesToText: () => '',
  recommend: async () => [],
  rankTracks: (tracks = []) => tracks,
  dedupeTracks: (tracks = []) => tracks,
  lyricsFor: async () => '', // station → music/cue.js pulls this
}));

// Real store/shows/judge/dj against a temp data dir. The fixture show covers
// every hour of every day so these tests hold at any wall-clock time:
// budget 2, and tight per-show line budgets (sayMax 12 / segueMax 10).
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurio-show-seg-'));
process.env.AURIO_DATA_DIR = tmpDir;
fs.mkdirSync(path.join(tmpDir, 'user'), { recursive: true });
fs.writeFileSync(path.join(tmpDir, 'user', 'shows.json'), JSON.stringify({
  shows: [{
    name: '测试台', freq: '77.7', start: '00:00', end: '24:00',
    talkBudget: 2, tone: '测试语气', musicRules: '测试选曲',
    sayMax: 12, segueMax: 10,
  }],
}));

const dj = await import('../server/dj.js');
const shows = await import('../server/shows.js');
const { _resetLedger } = await import('../server/agent/judge.js');
const { db } = await import('../server/store.js');
const { initStation, station } = await import('../server/playout/station.js');

afterAll(() => {
  delete process.env.AURIO_DATA_DIR;
  delete process.env.AURIO_LLM_JUDGE;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const action = (say, extra = {}) => ({
  say, play: [], reason: '', segue: '', intent: '', placement: '', mood: '', ...extra,
});

beforeEach(() => {
  think.mockReset();
  _resetLedger();
  db.setPref(shows.TALK_LEDGER_KEY, []);
  db.setPref('segmentMemory', []);
  db.setPref('programmeLog', null);
  initStation(); // fresh programme log per test
  // These tests pin the RULE judge's call arithmetic; the LLM judge layer has
  // its own wiring test below and unit tests in judge-llm.test.js.
  process.env.AURIO_LLM_JUDGE = 'off';
});

describe('composeSegment × talk budget', () => {
  it('lets a scheduled break speak while the budget has room, and exposes the decision', async () => {
    think.mockResolvedValue(action('风把云吹开了。'));
    const seg = await dj.composeSegment({ kind: 'mood' });
    expect(seg.say).toBe('风把云吹开了。');
    expect(seg.talk).toEqual({ allowed: true, exempt: false, show: '测试台', spent: 0, budget: 2 });
    // The prompt carried the show block.
    expect(think.mock.calls[0][0]).toContain('当前节目');
    expect(think.mock.calls[0][0]).toContain('《测试台》');
  });

  it('forces a music-only break once the budget is spent — one brain call, no judge retry', async () => {
    shows.recordSpokenBreak();
    shows.recordSpokenBreak();
    think.mockResolvedValue(action('这句不该播出去。'));
    const seg = await dj.composeSegment({ kind: 'mood' });
    expect(seg.say).toBe('');
    expect(seg.segue).toBe('');
    expect(seg.talk.allowed).toBe(false);
    expect(seg.talk.spent).toBe(2);
    // Silence was forced before the judge, so the retry loop never fired…
    expect(think).toHaveBeenCalledTimes(1);
    // …and the brain was told up front that the break is music-only.
    expect(think.mock.calls[0][0]).toContain('这一段不说话');
  });

  it('user chat always may speak, budget or not', async () => {
    shows.recordSpokenBreak();
    shows.recordSpokenBreak();
    think.mockResolvedValue(action('在呢，你说。'));
    const seg = await dj.composeSegment({ kind: 'chat' });
    expect(seg.say).toBe('在呢，你说。');
    expect(seg.talk.allowed).toBe(true);
    expect(seg.talk.exempt).toBe(true);
  });
});

describe('composeSegment × per-show judge budget', () => {
  it('a line within the show sayMax passes', async () => {
    think.mockResolvedValue(action('风把云吹开了。')); // 7 chars ≤ 12
    const seg = await dj.composeSegment({ kind: 'mood' });
    expect(seg.say).toBe('风把云吹开了。');
    expect(think).toHaveBeenCalledTimes(1);
  });

  it('a line over the show sayMax triggers the retry, then silence', async () => {
    // 14 chars > the show's sayMax of 12 (but well under the default 60).
    think.mockResolvedValue(action('这句话实在太长已经超出深夜预算'));
    const seg = await dj.composeSegment({ kind: 'mood' });
    expect(think).toHaveBeenCalledTimes(2);          // one corrective retry
    expect(think.mock.calls[1][0]).toContain('太长'); // category-only note
    expect(seg.say).toBe('');                         // still too long → silent
  });

  it('the tighter segue budget applies too', async () => {
    think.mockResolvedValue(action('', { segue: '这条垫话也太长了超出十个字' })); // 13 > 10
    const seg = await dj.composeSegment({ kind: 'mood' });
    expect(think).toHaveBeenCalledTimes(2);
    expect(seg.segue).toBe('');
  });
});

describe('runSegment × airing', () => {
  const userQueue = [
    { source: 'navidrome', id: 'u1', title: 'Mine 1', artist: 'Me' },
    { source: 'navidrome', id: 'u2', title: 'Mine 2', artist: 'Me' },
    { source: 'navidrome', id: 'u3', title: 'Mine 3', artist: 'Me' },
  ];

  it('a show-open speaks without clobbering the programme log', async () => {
    station.appendTracks(userQueue.map((t) => ({ ...t, duration: 240 })));
    think.mockResolvedValue(action('晚上好，交给我。'));
    const b = await dj.runSegment({ kind: 'show-open' }, { mode: 'chat' });
    expect(b.say).toBe('晚上好，交给我。');
    expect(b.op).toBe('chat');
    expect(station.items().map((it) => it.track.id)).toEqual(['u1', 'u2', 'u3']); // untouched
    // The aired break spent the budget.
    expect(db.getPref(shows.TALK_LEDGER_KEY, [])).toHaveLength(1);
    expect(b.talk).toMatchObject({ allowed: true, show: '测试台' });
  });

  it('a recap trigger hands the deterministic fact to the prompt', async () => {
    const fact = '过去 7 天一共播放了 4 次；听得最多的歌手是陈奕迅（3 次）';
    think.mockResolvedValue(action('这周你耳朵都给了陈奕迅。'));
    const b = await dj.runSegment({ kind: 'recap', fact }, { mode: 'chat' });
    expect(think.mock.calls[0][0]).toContain('刚刚发生的事');
    expect(think.mock.calls[0][0]).toContain(fact);
    expect(b.say).toBe('这周你耳朵都给了陈奕迅。');
    expect(db.getPref(shows.TALK_LEDGER_KEY, [])).toHaveLength(1);
  });

  it('a muted scheduled break airs silence and spends nothing', async () => {
    shows.recordSpokenBreak();
    shows.recordSpokenBreak();
    think.mockResolvedValue(action('又想说话了。'));
    const b = await dj.runSegment({ kind: 'mood' }, { mode: 'chat' });
    expect(b.say).toBe('');
    expect(b.talk.allowed).toBe(false);
    expect(db.getPref(shows.TALK_LEDGER_KEY, [])).toHaveLength(2); // unchanged
  });

  it('user chat still speaks after the budget is gone', async () => {
    shows.recordSpokenBreak();
    shows.recordSpokenBreak();
    think.mockResolvedValue(action('在的，这就来。', { intent: 'chat' }));
    const b = await dj.runSegment({ kind: 'chat', text: '在吗' }, { mode: 'auto' });
    expect(b.say).toBe('在的，这就来。');
    // …and an answer is not a break: the ledger did not grow.
    expect(db.getPref(shows.TALK_LEDGER_KEY, [])).toHaveLength(2);
  });
});

// fabricated_fact at the dj seam (P5 掌故只讲可验证的): composeSegment builds
// the 歌曲素材 body once, shows it to the model AND hands the same text to the
// judge — a spoken 《title》/year the material cannot back triggers the
// corrective retry.
describe('composeSegment × fabricated_fact (the material seam)', () => {
  beforeEach(() => { db.state.plays.splice(0); });

  it('a spoken title the material backs passes in one call', async () => {
    db.addPlay({ source: 'navidrome', id: 'p1', title: '昨日样本', artist: '样本歌手' });
    think.mockResolvedValue(action('《昨日样本》真轻。')); // 9 chars ≤ sayMax 12
    const seg = await dj.composeSegment({ kind: 'mood' });
    expect(seg.say).toBe('《昨日样本》真轻。');
    expect(think).toHaveBeenCalledTimes(1);
    // The prompt carried the same material body the judge checked against.
    expect(think.mock.calls[0][0]).toContain('上一首刚放完: 样本歌手《昨日样本》');
  });

  it('an unbacked 《title》 triggers the corrective retry, then silence', async () => {
    db.addPlay({ source: 'navidrome', id: 'p1', title: '昨日样本', artist: '样本歌手' });
    think.mockResolvedValue(action('这张《未知精选》真好')); // 10 chars, but a fabricated title
    const seg = await dj.composeSegment({ kind: 'mood' });
    expect(think).toHaveBeenCalledTimes(2);                  // one corrective retry
    expect(think.mock.calls[1][0]).toContain('素材里没有的'); // category-only note
    expect(seg.say).toBe('');                                // still fabricated → silent
  });

  it('with no material at all the check never fires', async () => {
    think.mockResolvedValue(action('这张《未知精选》真好'));
    const seg = await dj.composeSegment({ kind: 'mood' });
    expect(think).toHaveBeenCalledTimes(1);
    expect(seg.say).toBe('这张《未知精选》真好');
  });
});

// The LLM judge layer at the dj seam: a fail verdict spends exactly one
// corrective regen; verdict machinery never fires for chat.
describe('composeSegment × LLM judge wiring', () => {
  it('a human-judge fail regenerates once with the category note', async () => {
    process.env.AURIO_LLM_JUDGE = 'on';
    think.mockImplementation(async (prompt) => {
      if (prompt.includes('质检员')) return '{"pass": false, "problems": ["unnatural"]}';
      if (prompt.includes('重写要求')) return action('重写后这句。');
      return action('第一版这句。');
    });
    const seg = await dj.composeSegment({ kind: 'mood' });
    expect(seg.say).toBe('重写后这句。');
    // gen → judge → regen; the rewrite carried the unnatural correction.
    expect(think).toHaveBeenCalledTimes(3);
    expect(think.mock.calls[2][0]).toContain('不像随口说出来');
  });

  it('a pass verdict costs one judge call and keeps the line', async () => {
    process.env.AURIO_LLM_JUDGE = 'on';
    think.mockImplementation(async (prompt) => (
      prompt.includes('质检员') ? '{"pass": true}' : action('第一版这句。')
    ));
    const seg = await dj.composeSegment({ kind: 'mood' });
    expect(seg.say).toBe('第一版这句。');
    expect(think).toHaveBeenCalledTimes(2);
  });

  it('chat never pays for the human judge', async () => {
    process.env.AURIO_LLM_JUDGE = 'on';
    think.mockResolvedValue(action('在呢，你说。', { intent: 'chat' }));
    const seg = await dj.composeSegment({ kind: 'chat', text: '在吗' });
    expect(seg.say).toBe('在呢，你说。');
    expect(think).toHaveBeenCalledTimes(1);
  });
});
