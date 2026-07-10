import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

// A fixed fake "now" — every detector takes `now` as a parameter, so the tests
// never depend on the wall clock (except the buildObservation integration
// test, which seeds history relative to the real clock).
const NOW = Date.UTC(2026, 6, 10, 12, 0, 0);

// Isolate the store's on-disk writes into a temp dir so cooldown prefs don't
// touch the project's real state.json. Imports happen in beforeAll, AFTER the
// env var is set, so config.js picks up the temp DATA_ROOT.
let tmpDir;
let db;
let det;
let loop;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurio-detectors-'));
  process.env.AURIO_DATA_DIR = tmpDir;
  delete process.env.OPENWEATHER_KEY; // keep buildObservation's weather hook offline
  det = await import('../server/agent/detectors.js');
  ({ db } = await import('../server/store.js'));
  loop = await import('../server/agent/loop.js');
});

afterAll(() => {
  delete process.env.AURIO_DATA_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  db.state.plays.splice(0);
  db.state.messages.splice(0);
  db.state.prefs = {};
});

const nocturne = { id: 'n1', title: '夜曲', artist: '周杰伦', source: 'netease' };
const other = { id: 'o1', title: '晴天', artist: '周杰伦', source: 'netease' };

function addPlay(track, ts) {
  db.state.plays.push({ id: track.id, title: track.title, artist: track.artist, source: track.source, ts });
}

describe('return_after_absence', () => {
  it('fires once with the day count, then cools down for the same return', () => {
    addPlay(other, NOW - 23 * DAY);
    const first = det.detectFacts({ now: NOW });
    expect(first).toEqual({ code: 'return_after_absence', fact: '距上次收听 23 天' });
    // Same return — the fact must not repeat.
    expect(det.detectFacts({ now: NOW + MIN })).toBeNull();
  });

  it('ignores the return-in-progress activity dj.js logs before composing', () => {
    addPlay(other, NOW - 23 * DAY);
    db.state.messages.push({ role: 'user', text: '我回来了', ts: NOW - 30 * 1000 });
    expect(det.detectFacts({ now: NOW })?.fact).toBe('距上次收听 23 天');
  });

  it('does not count DJ-role messages as the user being around', () => {
    addPlay(other, NOW - 23 * DAY);
    db.state.messages.push({ role: 'dj', text: '深夜了。', ts: NOW - 2 * DAY });
    expect(det.detectFacts({ now: NOW })?.code).toBe('return_after_absence');
  });

  it('stays silent under 7 days and on a fresh install', () => {
    expect(det.detectFacts({ now: NOW })).toBeNull(); // no history at all
    addPlay(other, NOW - 6 * DAY);
    expect(det.detectFacts({ now: NOW })).toBeNull();
  });

  it('fires again for a NEW absence', () => {
    addPlay(other, NOW - 23 * DAY);
    expect(det.detectFacts({ now: NOW })?.code).toBe('return_after_absence');
    // The user listens today, then disappears for 10 days.
    addPlay(other, NOW);
    const later = NOW + 10 * DAY;
    expect(det.detectFacts({ now: later })).toEqual({
      code: 'return_after_absence',
      fact: '距上次收听 10 天',
    });
  });
});

describe('replay_obsession', () => {
  it('fires at 3 plays of the same track within a week', () => {
    addPlay(nocturne, NOW - 5 * DAY);
    addPlay(nocturne, NOW - 2 * DAY);
    addPlay(nocturne, NOW - 2 * MIN); // current spin, already POSTed by the renderer
    const hit = det.detectFacts({ now: NOW, nowPlaying: nocturne });
    expect(hit).toEqual({ code: 'replay_obsession', fact: '《夜曲》这周第 3 遍' });
  });

  it('cools down per track per week, other tracks unaffected', () => {
    for (const ts of [NOW - 5 * DAY, NOW - 2 * DAY, NOW - 2 * MIN]) addPlay(nocturne, ts);
    for (const ts of [NOW - 4 * DAY, NOW - 1 * DAY, NOW - 3 * MIN]) addPlay(other, ts);
    expect(det.detectFacts({ now: NOW, nowPlaying: nocturne })?.code).toBe('replay_obsession');
    expect(det.detectFacts({ now: NOW + MIN, nowPlaying: nocturne })).toBeNull();
    expect(det.detectFacts({ now: NOW + 2 * MIN, nowPlaying: other })?.fact).toBe('《晴天》这周第 3 遍');
  });

  it('does not count plays outside the 7-day window', () => {
    addPlay(nocturne, NOW - 20 * DAY);
    addPlay(nocturne, NOW - 15 * DAY);
    addPlay(nocturne, NOW - 2 * DAY);
    addPlay(nocturne, NOW - 2 * MIN);
    addPlay(other, NOW - 1 * DAY); // keep absence quiet, vary activity
    expect(det.detectFacts({ now: NOW, nowPlaying: nocturne })).toBeNull(); // only 2 in window
  });

  it('needs a current track to speak about', () => {
    for (const ts of [NOW - 5 * DAY, NOW - 2 * DAY, NOW - 2 * MIN]) addPlay(nocturne, ts);
    expect(det.detectFacts({ now: NOW })).toBeNull();
  });
});

describe('shelf_track', () => {
  it('fires when the previous play of the current track is over a year old', () => {
    const oldTs = NOW - 400 * DAY;
    addPlay(nocturne, oldTs);
    addPlay(nocturne, NOW - 2 * MIN); // the spin airing right now
    addPlay(other, NOW - 1 * DAY);    // recent activity keeps absence quiet
    const d = new Date(oldTs);
    expect(det.detectFacts({ now: NOW, nowPlaying: nocturne })).toEqual({
      code: 'shelf_track',
      fact: `《夜曲》上次播放是 ${d.getFullYear()}年${d.getMonth() + 1}月`,
    });
  });

  it('cools down per track per month', () => {
    addPlay(nocturne, NOW - 400 * DAY);
    addPlay(other, NOW - 1 * DAY);
    expect(det.detectFacts({ now: NOW, nowPlaying: nocturne })?.code).toBe('shelf_track');
    addPlay(other, NOW + 19 * DAY); // keep listening so absence stays quiet
    expect(det.detectFacts({ now: NOW + 20 * DAY, nowPlaying: nocturne })).toBeNull();
  });

  it('stays silent when the previous play is under a year old or unknown', () => {
    addPlay(nocturne, NOW - 200 * DAY);
    addPlay(other, NOW - 1 * DAY);
    expect(det.detectFacts({ now: NOW, nowPlaying: nocturne })).toBeNull();
    // Never played before (or evicted from the 2000-row history) → no fact.
    expect(det.detectFacts({ now: NOW, nowPlaying: { title: '新歌', artist: '新人' } })).toBeNull();
  });
});

describe('weather_flip', () => {
  it('detects rain starting, once per flip', () => {
    det.recordWeatherObservation({ desc: '晴' }, NOW - 40 * MIN);
    det.recordWeatherObservation({ desc: '小雨' }, NOW - 10 * MIN);
    expect(det.detectFacts({ now: NOW })).toEqual({
      code: 'weather_flip',
      fact: '10 分钟前开始下雨',
    });
    expect(det.detectFacts({ now: NOW + MIN })).toBeNull();
  });

  it('detects rain stopping', () => {
    det.recordWeatherObservation({ desc: '中雨' }, NOW - 30 * MIN);
    det.recordWeatherObservation({ desc: '晴' }, NOW - 15 * MIN);
    expect(det.detectFacts({ now: NOW })?.fact).toBe('15 分钟前雨停了');
  });

  it('ignores non-precipitation changes like 晴→多云', () => {
    det.recordWeatherObservation({ desc: '晴' }, NOW - 40 * MIN);
    det.recordWeatherObservation({ desc: '多云' }, NOW - 10 * MIN);
    expect(det.detectFacts({ now: NOW })).toBeNull();
  });

  it('drops a stale flip (older than ~2h)', () => {
    det.recordWeatherObservation({ desc: '晴' }, NOW - 4 * 60 * MIN);
    det.recordWeatherObservation({ desc: '小雨' }, NOW - 3 * 60 * MIN);
    expect(det.detectFacts({ now: NOW })).toBeNull();
  });

  it('stays silent when observations are too sparse to date the flip', () => {
    det.recordWeatherObservation({ desc: '晴' }, NOW - 6 * 60 * MIN);
    det.recordWeatherObservation({ desc: '小雨' }, NOW - 10 * MIN); // 晴 last seen ~6h ago
    expect(det.detectFacts({ now: NOW })).toBeNull();
  });

  it('re-confirming the same condition extends it instead of logging a flip', () => {
    det.recordWeatherObservation({ desc: '晴' }, NOW - 3 * 60 * MIN);
    det.recordWeatherObservation({ desc: '晴' }, NOW - 90 * MIN); // still clear
    det.recordWeatherObservation({ desc: '小雨' }, NOW - 20 * MIN);
    // 晴 was confirmed 70 min before the rain showed up → flip is datable.
    expect(det.detectFacts({ now: NOW })?.fact).toBe('20 分钟前开始下雨');
  });

  it('classifies descriptions coarsely', () => {
    expect(det.classifyWeather('雷阵雨')).toBe('rain');
    expect(det.classifyWeather('雨夹雪')).toBe('snow');
    expect(det.classifyWeather('晴')).toBe('clear');
    expect(det.classifyWeather('阴')).toBe('clouds');
    expect(det.classifyWeather('雾')).toBe('fog');
  });
});

describe('one fact max + priority', () => {
  it('absence beats weather_flip, and the loser keeps its cooldown', () => {
    addPlay(other, NOW - 30 * DAY); // absence condition
    det.recordWeatherObservation({ desc: '晴' }, NOW - 90 * MIN);
    det.recordWeatherObservation({ desc: '小雨' }, NOW - 30 * MIN);

    // One observation → exactly one fact, the highest-priority one.
    expect(det.detectFacts({ now: NOW })).toEqual({
      code: 'return_after_absence',
      fact: '距上次收听 30 天',
    });
    // The weather flip was NOT burned — it surfaces on the next observation.
    expect(det.detectFacts({ now: NOW + MIN })).toEqual({
      code: 'weather_flip',
      fact: '31 分钟前开始下雨',
    });
    // Everything spent → silence.
    expect(det.detectFacts({ now: NOW + 2 * MIN })).toBeNull();
  });

  it('weather_flip beats replay_obsession', () => {
    for (const ts of [NOW - 5 * DAY, NOW - 2 * DAY, NOW - 2 * MIN]) addPlay(nocturne, ts);
    det.recordWeatherObservation({ desc: '多云' }, NOW - 60 * MIN);
    det.recordWeatherObservation({ desc: '小雨' }, NOW - 5 * MIN);
    expect(det.detectFacts({ now: NOW, nowPlaying: nocturne })?.code).toBe('weather_flip');
    expect(det.detectFacts({ now: NOW + MIN, nowPlaying: nocturne })?.code).toBe('replay_obsession');
  });
});

describe('factsPromptLine', () => {
  it('renders the neutral prompt line', () => {
    expect(det.factsPromptLine(['距上次收听 23 天']))
      .toBe('探测到的事实（可以自然地提一句，也可以不提）：距上次收听 23 天');
  });
  it('is empty without facts', () => {
    expect(det.factsPromptLine([])).toBe('');
    expect(det.factsPromptLine()).toBe('');
  });
});

describe('buildObservation integration seam', () => {
  it('attaches at most one fact and the ready-to-render line', () => {
    // buildObservation uses the real clock — seed history relative to it.
    addPlay(other, Date.now() - 23 * DAY);
    const obs = loop.buildObservation({ kind: 'chat', text: '在吗' });
    expect(obs.facts).toEqual(['距上次收听 23 天']);
    expect(obs.factsLine).toBe('探测到的事实（可以自然地提一句，也可以不提）：距上次收听 23 天');
    // Cooldown holds across observations too.
    const again = loop.buildObservation({ kind: 'chat', text: '在吗' });
    expect(again.facts).toEqual([]);
    expect(again.factsLine).toBe('');
  });
});
