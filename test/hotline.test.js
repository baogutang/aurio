// chat 热线化 (RADIO_VISION §四) at the DJ seam: a non-urgent song request
// APPENDS to the show (with a one-line on-air 点歌确认) instead of cutting the
// line, leaves a pending shoutout in db prefs, and the host weaves ONE
// acknowledgement into the next spoken non-chat break — retired only when that
// break actually airs, expiring after 30 minutes if it never does.
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

// No real library: resolveQueue simply materialises whatever the brain asked
// to play, so an enqueue-intent action yields real tracks for the log.
vi.mock('../server/music/index.js', () => ({
  resolveQueue: async (play = []) => play.map((p, i) => ({
    source: 'navidrome', id: `req-${i}`, title: p.title || p.query || `T${i}`, artist: p.artist || 'A',
  })),
  playbackUrl: async () => 'http://x/stream',
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
// every hour of every day so these tests hold at any wall-clock time.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurio-hotline-'));
process.env.AURIO_DATA_DIR = tmpDir;
fs.mkdirSync(path.join(tmpDir, 'user'), { recursive: true });
fs.writeFileSync(path.join(tmpDir, 'user', 'shows.json'), JSON.stringify({
  shows: [{
    name: '热线台', freq: '77.7', start: '00:00', end: '24:00',
    talkBudget: 2, tone: '测试语气', musicRules: '测试选曲',
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

const requestAction = (say, extra = {}) => action(say, {
  intent: 'enqueue',
  play: [{ query: '周杰伦 - 晴天', title: '晴天', artist: '周杰伦' }],
  ...extra,
});

const lastPrompt = () => think.mock.calls[think.mock.calls.length - 1][0];
const ledger = () => db.getPref(dj.SHOUTOUT_KEY, []);
const seedShoutout = (over = {}) => {
  const entry = { text: '来一首晴天', tracks: ['周杰伦 — 晴天'], ts: Date.now() - 1000, ...over };
  db.setPref(dj.SHOUTOUT_KEY, [...ledger(), entry]);
  return entry;
};

beforeEach(() => {
  think.mockReset();
  _resetLedger();
  db.setPref(shows.TALK_LEDGER_KEY, []);
  db.setPref(dj.SHOUTOUT_KEY, []);
  db.setPref('segmentMemory', []);
  db.setPref('programmeLog', null);
  initStation(); // fresh programme log per test
  // Hotline tests pin brain-call arithmetic; the LLM judge layer is unit- and
  // wiring-tested elsewhere (judge-llm.test.js, show-segment.test.js).
  process.env.AURIO_LLM_JUDGE = 'off';
});

describe('urgency detection', () => {
  it.each([
    '现在放周杰伦的晴天',
    '立刻来一首安静的',
    '马上放点摇滚',
    '这就放那首歌',
    '快点放歌',
    '先放海阔天空',
  ])('「%s」 is urgent', (text) => {
    expect(dj.isUrgentRequest(text)).toBe(true);
  });

  it.each([
    '来一首周杰伦的晴天',
    '想听点爵士',
    '晚点放个陈奕迅吧',
    '',
  ])('「%s」 is not urgent', (text) => {
    expect(dj.isUrgentRequest(text)).toBe(false);
  });

  it('handles a missing argument', () => {
    expect(dj.isUrgentRequest()).toBe(false);
    expect(dj.looksLikeMusicRequest()).toBe(false);
  });
});

describe('hotline default placement (auto mode)', () => {
  it('a non-urgent request appends to the show and records a shoutout', async () => {
    think.mockResolvedValue(requestAction('晴天记下了，待会儿放给你。'));
    const b = await dj.runSegment({ kind: 'chat', text: '来一首周杰伦的晴天' }, { mode: 'auto' });
    expect(b.op).toBe('insert');
    expect(b.placement).toBe('append');
    expect(b.queue).toHaveLength(1);
    expect(b.say).toBe('晴天记下了，待会儿放给你。');
    // The song landed at the TAIL of the programme log.
    const items = station.items();
    expect(items[items.length - 1].track.title).toBe('晴天');
    // The pending shoutout landed in the ledger with the caller's words.
    expect(ledger()).toHaveLength(1);
    expect(ledger()[0]).toMatchObject({ text: '来一首周杰伦的晴天', tracks: ['周杰伦 — 晴天'] });
    // The prompt asked for a one-line on-air confirmation.
    expect(lastPrompt()).toContain('点歌确认');
  });

  it('explicit urgency in the text keeps insert-next, no shoutout', async () => {
    think.mockResolvedValue(requestAction('那首歌接在这首后面。'));
    const b = await dj.runSegment({ kind: 'chat', text: '现在放周杰伦的晴天' }, { mode: 'auto' });
    expect(b.op).toBe('insert');
    expect(b.placement).toBe('next');
    expect(ledger()).toEqual([]);
    // No hotline-confirmation nudge for the 插播 channel.
    expect(lastPrompt()).not.toContain('点歌确认');
  });

  it("an urgent request lands right after the on-air item in the log", async () => {
    // Seed a programme in progress: two songs, the first on air.
    station.appendTracks([
      { source: 'navidrome', id: 'on-air', title: 'Playing', artist: 'A', duration: 300 },
      { source: 'navidrome', id: 'later', title: 'Later', artist: 'A', duration: 300 },
    ]);
    station.start();
    think.mockResolvedValue(requestAction('那首歌接在这首后面。'));
    const b = await dj.runSegment({ kind: 'chat', text: '现在放周杰伦的晴天' }, { mode: 'auto' });
    expect(b.op).toBe('insert');
    expect(b.placement).toBe('next');
    const ids = station.items().map((it) => it.track.id);
    expect(ids).toEqual(['on-air', 'req-0', 'later']);
    station.stop();
  });

  it("the model's explicit placement 'next' also keeps insert-next", async () => {
    think.mockResolvedValue(requestAction('那首歌接在这首后面。', { placement: 'next' }));
    const b = await dj.runSegment({ kind: 'chat', text: '来一首周杰伦的晴天' }, { mode: 'auto' });
    expect(b.placement).toBe('next');
    expect(ledger()).toEqual([]);
  });

  it('a pure chat without music words gets no hotline nudge and leaves the log alone', async () => {
    think.mockResolvedValue(action('在呢，你说。', { intent: 'chat' }));
    const b = await dj.runSegment({ kind: 'chat', text: '在吗' }, { mode: 'auto' });
    expect(b.op).toBe('chat');
    expect(station.items()).toEqual([]);
    expect(ledger()).toEqual([]);
    expect(lastPrompt()).not.toContain('点歌确认');
  });
});

describe('shoutout delivery at the next spoken break', () => {
  it('record → mention → clear across a real request and the next break', async () => {
    // The caller phones in…
    think.mockResolvedValue(requestAction('晴天记下了，待会儿放给你。'));
    await dj.runSegment({ kind: 'chat', text: '来一首周杰伦的晴天' }, { mode: 'auto' });
    expect(ledger()).toHaveLength(1);

    // …and the next scheduled break is asked to acknowledge them once.
    think.mockResolvedValue(action('刚才有位朋友点了首晴天，这就来。'));
    const b = await dj.runSegment({ kind: 'mood' }, { mode: 'chat' });
    expect(b.say).toBe('刚才有位朋友点了首晴天，这就来。');
    expect(lastPrompt()).toContain('热线回应');
    expect(lastPrompt()).toContain('周杰伦 — 晴天');
    // The mention aired, so the ledger is clear.
    expect(ledger()).toEqual([]);
  });

  it('a budget-muted break leaves the ledger untouched', async () => {
    shows.recordSpokenBreak();
    shows.recordSpokenBreak(); // fixture budget of 2 is spent
    const entry = seedShoutout();
    think.mockResolvedValue(action('这句不该播出去。'));
    const b = await dj.runSegment({ kind: 'mood' }, { mode: 'chat' });
    expect(b.say).toBe('');
    expect(b.talk.allowed).toBe(false);
    // The muted prompt never carried the shoutout, and nothing was consumed.
    expect(lastPrompt()).not.toContain('热线回应');
    expect(ledger()).toEqual([entry]);
  });

  it('a judge-silenced break keeps the shoutout pending', async () => {
    const entry = seedShoutout();
    // Both drafts violate (assistant-voice opener) → the break goes silent.
    think.mockResolvedValue(action('收到，这就安排。'));
    const b = await dj.runSegment({ kind: 'mood' }, { mode: 'chat' });
    expect(b.say).toBe('');
    expect(think).toHaveBeenCalledTimes(2);
    expect(ledger()).toEqual([entry]);
  });

  it('unspoken shoutouts expire after 30 minutes', async () => {
    seedShoutout({ ts: Date.now() - dj.SHOUTOUT_TTL_MS - 1000 });
    think.mockResolvedValue(action('风把云吹开了。'));
    const b = await dj.runSegment({ kind: 'mood' }, { mode: 'chat' });
    expect(b.say).toBe('风把云吹开了。');
    expect(lastPrompt()).not.toContain('热线回应');
    // The expired entry was pruned from the stored ledger, not just skipped.
    expect(ledger()).toEqual([]);
  });

  it('mentions only the oldest when several are pending, keeping the rest', async () => {
    const older = seedShoutout({ text: '来一首晴天', tracks: ['周杰伦 — 晴天'], ts: Date.now() - 5000 });
    const newer = seedShoutout({ text: '来点爵士', tracks: ['Chet Baker — My Funny Valentine'], ts: Date.now() - 1000 });
    think.mockResolvedValue(action('刚才有位朋友点了首晴天，这就来。'));
    await dj.runSegment({ kind: 'mood' }, { mode: 'chat' });
    expect(lastPrompt()).toContain(older.tracks[0]);
    expect(lastPrompt()).not.toContain(newer.tracks[0]);
    // One mention per break: the newer caller waits for the next one.
    expect(ledger()).toEqual([newer]);
  });

  it('a chat answer never delivers the shoutout — it waits for a real break', async () => {
    const entry = seedShoutout();
    think.mockResolvedValue(action('在呢，你说。', { intent: 'chat' }));
    await dj.runSegment({ kind: 'chat', text: '在吗' }, { mode: 'auto' });
    expect(lastPrompt()).not.toContain('热线回应');
    expect(ledger()).toEqual([entry]);
  });

  it('the corrective retry keeps the shoutout suffix on the rewrite', async () => {
    seedShoutout();
    think
      .mockResolvedValueOnce(action('收到，这就安排。'))          // assistant_voice → retry
      .mockResolvedValueOnce(action('刚才有人点了晴天，马上到。')); // clean rewrite
    const b = await dj.runSegment({ kind: 'mood' }, { mode: 'chat' });
    expect(think).toHaveBeenCalledTimes(2);
    // The retry prompt still carries the hotline suffix AND the corrective note.
    expect(think.mock.calls[1][0]).toContain('热线回应');
    expect(think.mock.calls[1][0]).toContain('重写要求');
    expect(b.say).toBe('刚才有人点了晴天，马上到。');
    expect(ledger()).toEqual([]);
  });
});
