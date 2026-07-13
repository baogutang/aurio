import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 音乐故事引擎 (server/music/story.js): fetch raw material once, distill once,
// cache forever. All fixture texts / artists / albums are INVENTED — no real
// works. Import happens after AURIO_DATA_DIR points at a temp dir (cue.test.js
// pattern) so cache/stories.json never touches the project.
let tmpDir;
let story;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurio-story-'));
  process.env.AURIO_DATA_DIR = tmpDir;
  story = await import('../server/music/story.js');
});

afterAll(() => {
  delete process.env.AURIO_DATA_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  story.resetStoryState();
  fs.rmSync(story.STORY_CACHE_FILE, { force: true });
});

const TRACK = {
  source: 'netease', id: '1001', title: '虚构之夜', artist: '虚构乐队', album: '假想集', year: 2019,
};

const ARTIST_TEXT = '虚构乐队2015年成立于青岛。乐队最初在一间旧仓库排练。2018年凭首张专辑获过一个虚构奖项。主唱曾是灯塔看守员。';
const ALBUM_TEXT = '《假想集》录制于2019年冬天。整张专辑只用了一支麦克风。录音棚窗外是海。';

function rawBoth() {
  return {
    artist: { name: '虚构乐队', text: ARTIST_TEXT },
    album: { name: '假想集', artist: '虚构乐队', text: ALBUM_TEXT, year: 2019, company: '假想唱片' },
  };
}

const distillReply = (facts) => JSON.stringify({ facts });

describe('fetch → distill → cache', () => {
  it('distills each subject once and caches story facts with sources', async () => {
    const fetchRaw = vi.fn(async () => rawBoth());
    const think = vi.fn(async (prompt) => {
      if (prompt.includes('虚构乐队《假想集》')) {
        return distillReply([
          { fact: '《假想集》录制于 2019 年冬天', source: '录制于2019年冬天' },
          { fact: '整张专辑只用了一支麦克风', source: '只用了一支麦克风' },
        ]);
      }
      return distillReply([
        { fact: '虚构乐队 2015 年成立于青岛', source: '2015年成立于青岛' },
        { fact: '主唱曾是灯塔看守员', source: '主唱曾是灯塔看守员' },
      ]);
    });

    const card = await story.ensureStory(TRACK, { fetchRaw, think });
    expect(fetchRaw).toHaveBeenCalledTimes(1);
    expect(think).toHaveBeenCalledTimes(2); // one distillation per subject
    expect(card).toBeTruthy();
    expect(card.distilled).toBe(true);
    const facts = card.facts.map((f) => f.fact).join('\n');
    expect(facts).toContain('2015 年成立于青岛');
    expect(facts).toContain('2019 年冬天');
    // Every fact carries its source snippet.
    for (const f of card.facts) {
      expect(f.fact).toBeTruthy();
      expect(f.source).toBeTruthy();
    }
    // Release metadata rides the album card as verifiable facts.
    expect(facts).toContain('《假想集》发行于 2019 年');
    expect(facts).toContain('假想唱片');

    // The cache file is versioned and holds both cards under the spec'd keys.
    const disk = JSON.parse(fs.readFileSync(story.STORY_CACHE_FILE, 'utf8'));
    expect(disk.v).toBe(story.STORY_SCHEMA_VERSION);
    expect(disk.stories['artist:虚构乐队']).toBeTruthy();
    expect(disk.stories['album:虚构乐队/假想集']).toBeTruthy();
  });

  it('a second ensure is a pure cache hit — no refetch, no re-distill', async () => {
    const fetchRaw = vi.fn(async () => rawBoth());
    const think = vi.fn(async () => distillReply([{ fact: '一条事实', source: '出处' }]));
    await story.ensureStory(TRACK, { fetchRaw, think });
    const again = await story.ensureStory(TRACK, { fetchRaw, think });
    expect(fetchRaw).toHaveBeenCalledTimes(1);
    expect(think).toHaveBeenCalledTimes(2);
    expect(again.facts.length).toBeGreaterThan(0);
    // cachedStory reads the same card synchronously.
    expect(story.cachedStory(TRACK)).toEqual(again);
  });

  it('coalesces concurrent ensures for the same subjects onto one fetch', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const fetchRaw = vi.fn(async () => { await gate; return rawBoth(); });
    const think = vi.fn(async () => distillReply([{ fact: '一条事实', source: '出处' }]));
    const p1 = story.ensureStory(TRACK, { fetchRaw, think });
    const p2 = story.ensureStory(TRACK, { fetchRaw, think });
    release();
    const [a, b] = await Promise.all([p1, p2]);
    expect(fetchRaw).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });

  it('a cache file with the wrong schema version reads as empty', async () => {
    fs.mkdirSync(path.dirname(story.STORY_CACHE_FILE), { recursive: true });
    fs.writeFileSync(story.STORY_CACHE_FILE, JSON.stringify({ v: 999, stories: { 'artist:虚构乐队': { facts: [{ fact: 'stale', source: 's' }] } } }));
    story.resetStoryState();
    expect(story.cachedStory(TRACK)).toBeNull();
  });
});

describe('degradation', () => {
  it('distillation failure falls back to trimmed raw excerpts as facts', async () => {
    const fetchRaw = vi.fn(async () => ({ artist: { name: '虚构乐队', text: ARTIST_TEXT }, album: null }));
    const think = vi.fn(async () => { throw new Error('brain down'); });
    const card = await story.ensureStory(TRACK, { fetchRaw, think });
    expect(card).toBeTruthy();
    expect(card.distilled).toBe(false);
    expect(card.facts.length).toBeGreaterThan(0);
    // The excerpts come from the raw text and carry it as their source.
    expect(card.facts[0].fact).toContain('虚构乐队2015年成立于青岛');
    expect(card.facts[0].source).toBeTruthy();
  });

  it('a garbage distillation reply also falls back to excerpts', async () => {
    const fetchRaw = vi.fn(async () => ({ artist: { name: '虚构乐队', text: ARTIST_TEXT }, album: null }));
    const think = vi.fn(async () => '这不是 JSON，只是一段闲聊。');
    const card = await story.ensureStory(TRACK, { fetchRaw, think });
    expect(card.distilled).toBe(false);
    expect(card.facts.length).toBeGreaterThan(0);
  });

  it('a failed fetch resolves null, persists nothing, and is not refetched this run', async () => {
    const fetchRaw = vi.fn(async () => { throw new Error('network down'); });
    const think = vi.fn();
    expect(await story.ensureStory(TRACK, { fetchRaw, think })).toBeNull();
    expect(await story.ensureStory(TRACK, { fetchRaw, think })).toBeNull();
    expect(fetchRaw).toHaveBeenCalledTimes(1); // remembered in-process
    expect(think).not.toHaveBeenCalled();
    expect(fs.existsSync(story.STORY_CACHE_FILE)).toBe(false);
    // …but a restart (reset) retries.
    story.resetStoryState();
    await story.ensureStory(TRACK, { fetchRaw, think });
    expect(fetchRaw).toHaveBeenCalledTimes(2);
  });

  it('metadata-only material becomes deterministic facts without any LLM call', async () => {
    const fetchRaw = vi.fn(async () => ({
      artist: null,
      album: { name: '假想集', artist: '虚构乐队', text: '', year: 2019, genre: '民谣' },
    }));
    const think = vi.fn();
    const card = await story.ensureStory(TRACK, { fetchRaw, think });
    expect(think).not.toHaveBeenCalled();
    const facts = card.facts.map((f) => f.fact).join('\n');
    expect(facts).toContain('《假想集》发行于 2019 年');
    expect(facts).toContain('民谣');
  });

  it('an unkeyable track resolves null without fetching', async () => {
    const fetchRaw = vi.fn();
    expect(await story.ensureStory({ source: 'netease', id: 'x' }, { fetchRaw })).toBeNull();
    expect(fetchRaw).not.toHaveBeenCalled();
  });
});

describe('storyForTrack (bounded prompt read)', () => {
  it('returns the cached card instantly on a hit', async () => {
    story.primeStory(TRACK, [{ fact: '一条掌故', source: '出处片段' }]);
    const t0 = Date.now();
    const card = await story.storyForTrack(TRACK, { timeoutMs: 1000 });
    expect(Date.now() - t0).toBeLessThan(200);
    expect(card.facts[0].fact).toBe('一条掌故');
  });

  it('a slow build is cut off at the timeout and keeps running in background', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const fetchRaw = vi.fn(async () => { await gate; return rawBoth(); });
    const think = vi.fn(async () => distillReply([{ fact: '迟到的事实', source: '出处' }]));
    const t0 = Date.now();
    const first = await story.storyForTrack(TRACK, { timeoutMs: 80, fetchRaw, think });
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(first).toBeNull(); // nothing cached yet
    release();
    await new Promise((r) => setTimeout(r, 50));
    await story.ensureStory(TRACK, { fetchRaw, think }); // coalesces onto the running build
    expect(fetchRaw).toHaveBeenCalledTimes(1);
    expect(story.cachedStory(TRACK)?.facts?.length).toBeGreaterThan(0);
  });
});

describe('fetchRawMaterial per source', () => {
  it('netease: song_detail → artist_desc + album, texts capped', async () => {
    const bodies = {
      song_detail: { songs: [{ id: 1001, ar: [{ id: 7, name: '虚构乐队' }], al: { id: 9, name: '假想集' }, publishTime: 1546300800000 }] },
      artist_desc: { briefDesc: ARTIST_TEXT, introduction: [{ ti: '经历', txt: '乐队常年在海边演出。' }] },
      album: { album: { name: '假想集', description: ALBUM_TEXT, publishTime: 1546300800000, company: '假想唱片' } },
    };
    const ncmCall = vi.fn(async (fn) => bodies[fn]);
    const raw = await story.fetchRawMaterial(TRACK, { ncmCall });
    expect(raw.artist.name).toBe('虚构乐队');
    expect(raw.artist.text).toContain('2015年成立于青岛');
    expect(raw.artist.text).toContain('海边演出');
    expect(raw.album.name).toBe('假想集');
    expect(raw.album.text).toContain('只用了一支麦克风');
    expect(raw.album.year).toBe(2019);
    expect(raw.album.company).toBe('假想唱片');
  });

  it('netease: a missing capability falls through without throwing', async () => {
    const ncmCall = vi.fn(async (fn) => {
      if (fn === 'song_detail') return { songs: [{ id: 1001, ar: [{ id: 7 }], al: { id: 9, name: '假想集' } }] };
      throw new Error('endpoint blocked');
    });
    // TRACK carries year 2019 → the album degrades to a metadata-only card.
    const raw = await story.fetchRawMaterial(TRACK, { ncmCall });
    expect(raw.artist).toBeNull();
    expect(raw.album).toEqual({ name: '假想集', artist: '虚构乐队', text: '', year: 2019 });
    // Without even a year on the track, the album card is gone entirely.
    const bare = await story.fetchRawMaterial({ ...TRACK, year: undefined }, { ncmCall });
    expect(bare.album).toBeNull();
  });

  it('qqmusic: song detail → singer desc (CDATA) + album info', async () => {
    const qqJson = vi.fn(async (url) => {
      if (url.includes('fcg_play_single_song')) {
        return { data: [{ singer: [{ mid: 'S001', name: '虚构乐队' }], albummid: 'A001', albumname: '假想集' }] };
      }
      return { data: { name: '假想集', desc: ALBUM_TEXT, aDate: '2019-01-01', company: '假想唱片' } };
    });
    const qqText = vi.fn(async () => `<result><data><desc><![CDATA[${ARTIST_TEXT}]]></desc></data></result>`);
    const raw = await story.fetchRawMaterial({ ...TRACK, source: 'qqmusic', id: 'M001' }, { qqJson, qqText });
    expect(raw.artist.text).toContain('灯塔看守员');
    expect(raw.album.year).toBe(2019);
    expect(raw.album.text).toContain('只用了一支麦克风');
  });

  it('navidrome: tags become a metadata-only album card', async () => {
    const getSong = vi.fn(async () => ({ album: '假想集', artist: '虚构乐队', year: 1999, genre: '民谣' }));
    const raw = await story.fetchRawMaterial({ source: 'navidrome', id: 'n1', artist: '虚构乐队', album: '假想集' }, { getSong });
    expect(raw.artist).toBeNull();
    expect(raw.album).toEqual({ name: '假想集', artist: '虚构乐队', text: '', year: 1999, genre: '民谣' });
  });

  it('cdataText picks the longest non-trivial CDATA block', () => {
    const xml = '<a><![CDATA[短的]]></a><b><![CDATA[这一段足够长，是我们真正想要的歌手介绍文本。]]></b>';
    expect(story.cdataText(xml)).toContain('歌手介绍文本');
    expect(story.cdataText('<a>no cdata</a>')).toBe('');
  });
});
