import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 歌曲素材 block in the assembled prompt (server/context.js + lyrics-hooks.js).
// All lyric fixtures are ORIGINAL invented lines, not quotes from real songs.

let tmpDir;
let db;
let assemble;
let hooksMod;
let stationMod;

// context.js reads the programme through queueController's log projection —
// seed the station log where the old tests seeded the client queue.
function seedProgramme(tracks) {
  stationMod.station.appendTracks(tracks.map((t) => ({ ...t, duration: t.duration || 240 })));
}

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurio-material-'));
  process.env.AURIO_DATA_DIR = tmpDir;
  delete process.env.OPENWEATHER_KEY; // keep environment() offline
  ({ db } = await import('../server/store.js'));
  ({ assemble } = await import('../server/context.js'));
  hooksMod = await import('../server/music/lyrics-hooks.js');
  stationMod = await import('../server/playout/station.js');
});

afterAll(() => {
  delete process.env.AURIO_DATA_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const NOW_TRACK = {
  source: 'netease', id: 'n-1', title: '虚构之夜', artist: '虚构乐队',
  year: 2019, album: '假想集', genre: '民谣',
};
const NEXT_TRACK = { source: 'netease', id: 'n-2', title: '另一首假歌', artist: '某某' };
const PREV_TRACK = { source: 'qqmusic', id: 'q-9', title: '昨日样本', artist: '样本歌手' };

const NOW_LYRIC = ['路灯替我数着没睡的人', '霓虹在雨里慢慢化开', '霓虹在雨里慢慢化开'].join('\n');
const NEXT_LYRIC = ['潮水退了就回家', '潮水退了就回家'].join('\n');
const PREV_LYRIC = ['海面折起一枚月亮', '晚班车摇晃着旧站牌', '晚班车摇晃着旧站牌'].join('\n');

function observationFor(queue, playingIndex) {
  return {
    playback: {
      playingIndex,
      paused: false,
      queueLen: queue.length,
      remaining: queue.length - playingIndex - 1,
      revision: 1,
      nowPlaying: playingIndex >= 0 ? {
        title: queue[playingIndex].title,
        artist: queue[playingIndex].artist,
        source: queue[playingIndex].source,
      } : null,
      upNext: queue.slice(playingIndex + 1).map((t) => `${t.artist} — ${t.title}`),
    },
  };
}

function materialSection(prompt) {
  const m = prompt.match(/## 歌曲素材[^\n]*\n[\s\S]*?<untrusted>\n([\s\S]*?)\n<\/untrusted>/);
  return m ? m[1] : null;
}

beforeEach(() => {
  db.state.plays.splice(0);
  db.state.messages.splice(0);
  db.state.prefs = {};
  db.setPref('programmeLog', null);
  stationMod.initStation();
  hooksMod.clearHooksCache();
});

describe('歌曲素材 block', () => {
  it('carries now-playing metadata + 2 hooks, back-announce + 1 hook, up-next + 1 hook', async () => {
    const queue = [NOW_TRACK, NEXT_TRACK];
    seedProgramme(queue);
    db.addPlay(PREV_TRACK);
    db.addPlay(NOW_TRACK);
    hooksMod.primeHooks(NOW_TRACK, NOW_LYRIC);
    hooksMod.primeHooks(NEXT_TRACK, NEXT_LYRIC);
    hooksMod.primeHooks(PREV_TRACK, PREV_LYRIC);

    const prompt = await assemble({ kind: 'refill', observation: observationFor(queue, 0) });
    const mat = materialSection(prompt);
    expect(mat).toBeTruthy();

    // now playing: title + metadata + opening + most-repeated hook
    expect(mat).toContain('正在播放: 虚构乐队《虚构之夜》');
    expect(mat).toContain('2019');
    expect(mat).toContain('专辑《假想集》');
    expect(mat).toContain('民谣');
    expect(mat).toContain('开头唱的是: 「路灯替我数着没睡的人」');
    expect(mat).toContain('整首唱得最多的一句: 「霓虹在雨里慢慢化开」');

    // previous track enables the back-announce, quoting its repeated line
    expect(mat).toContain('上一首刚放完: 样本歌手《昨日样本》');
    expect(mat).toContain('里面唱到: 「晚班车摇晃着旧站牌」');

    // up next, cached-only hook
    expect(mat).toContain('即将播放: 某某《另一首假歌》');
    expect(mat).toContain('第一句是: 「潮水退了就回家」');

    // usage guidance sits OUTSIDE the untrusted body, next to the block
    const after = prompt.slice(prompt.indexOf('## 歌曲素材'));
    expect(after).toContain('这是素材，不是播报清单');
    expect(after).toContain('唱到『××』那句');
  });

  it('stays bounded: material body never exceeds 9 lines (7 + wrapper margin)', async () => {
    const queue = [NOW_TRACK, NEXT_TRACK];
    seedProgramme(queue);
    db.addPlay(PREV_TRACK);
    db.addPlay(NOW_TRACK);
    hooksMod.primeHooks(NOW_TRACK, NOW_LYRIC);
    hooksMod.primeHooks(NEXT_TRACK, NEXT_LYRIC);
    hooksMod.primeHooks(PREV_TRACK, PREV_LYRIC);

    const prompt = await assemble({ kind: 'refill', observation: observationFor(queue, 0) });
    const mat = materialSection(prompt);
    expect(mat.split('\n').length).toBeLessThanOrEqual(9);
    for (const line of mat.split('\n')) {
      expect(Array.from(line).length).toBeLessThanOrEqual(80);
    }
  });

  it('degrades silently to metadata-only lines when no lyrics are cached (unknown source → no fetch hit)', async () => {
    const unknownNow = { source: 'nosuch', id: 'x', title: '无词曲目', artist: '器乐团' };
    const queue = [unknownNow, { source: 'nosuch', id: 'y', title: '下一首', artist: '器乐团' }];
    seedProgramme(queue);

    const prompt = await assemble({ kind: 'refill', observation: observationFor(queue, 0) });
    const mat = materialSection(prompt);
    expect(mat).toContain('正在播放: 器乐团《无词曲目》');
    expect(mat).toContain('即将播放: 器乐团《下一首》');
    expect(mat).not.toContain('「'); // no hooks, no fake quotes
  });

  it('does not block on a slow next-track fetch: next uses cache only', async () => {
    // Only now-playing is primed; next has nothing cached and its source is
    // unresolvable — the block must still render instantly without its hook.
    const queue = [NOW_TRACK, NEXT_TRACK];
    seedProgramme(queue);
    hooksMod.primeHooks(NOW_TRACK, NOW_LYRIC);

    const t0 = Date.now();
    const prompt = await assemble({ kind: 'station', observation: observationFor(queue, 0) });
    expect(Date.now() - t0).toBeLessThan(1500);
    const mat = materialSection(prompt);
    expect(mat).toContain('即将播放: 某某《另一首假歌》');
    expect(mat).not.toContain('第一句是:');
  });

  it('omits the block entirely when there is no observation', async () => {
    const prompt = await assemble({ kind: 'chat', text: '随便聊聊' });
    expect(prompt).not.toContain('歌曲素材');
  });

  it('omits the block when nothing is playing and nothing has played', async () => {
    const prompt = await assemble({
      kind: 'station',
      observation: { playback: { playingIndex: -1, queueLen: 0, upNext: [] } },
    });
    expect(prompt).not.toContain('歌曲素材');
  });
});
