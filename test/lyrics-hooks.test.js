import { describe, it, expect, beforeEach } from 'vitest';
import {
  extractHooks, hookKey, cachedHooks, primeHooks, prefetchHooks, hooksForTrack, clearHooksCache,
} from '../server/music/lyrics-hooks.js';

// All lyric fixtures below are ORIGINAL invented lines written for this test —
// none are quotes from real songs.

const CJK_LRC = `[00:00.00] 作词 : 测试词人
[00:01.00] 作曲 : 测试曲人
[00:02.00] 编曲：测试编曲
[00:05.10]路灯替我数着没睡的人
[00:12.30]风把楼下的椅子挪了半寸
[00:20.00]霓虹在雨里慢慢化开
[00:28.00]潮水退了就回家
[00:36.00]霓虹在雨里慢慢化开
[00:44.00]晚班车摇晃着旧站牌
[00:52.00]霓虹在雨里慢慢化开
[01:00.00]潮水退了就回家`;

const EN_PLAIN = `Written by: Test Writer
Produced by Test Producer
[Verse 1]
Paper boats on a midnight sea
Counting streetlights back to you
[Chorus]
We sail on borrowed light
We sail on borrowed light
Counting streetlights back to you
We sail on borrowed light`;

describe('extractHooks', () => {
  it('picks the opening sung line first and the most-repeated line as the hook (CJK)', () => {
    const hooks = extractHooks(CJK_LRC);
    expect(hooks[0]).toBe('路灯替我数着没睡的人');
    expect(hooks[1]).toBe('霓虹在雨里慢慢化开'); // 3x beats 2x
    expect(hooks[2]).toBe('潮水退了就回家');
    expect(hooks.length).toBeLessThanOrEqual(3);
  });

  it('filters credit lines and bracketed section headers (EN)', () => {
    const hooks = extractHooks(EN_PLAIN);
    expect(hooks[0]).toBe('Paper boats on a midnight sea');
    expect(hooks[1]).toBe('We sail on borrowed light');
    for (const h of hooks) {
      expect(h).not.toMatch(/by|verse|chorus/i);
    }
  });

  it('drops 作词/作曲/OP/SP/ISRC-style credit lines wherever they appear', () => {
    const raw = ['作词：某人', '曲：某人', 'OP：某公司', 'SP: Some Corp', 'ISRC: XX-000-00-00000',
      '虚构的第一句歌词', '监制：某某'].join('\n');
    expect(extractHooks(raw)).toEqual(['虚构的第一句歌词']);
  });

  it('keeps a sung line that merely contains a colon', () => {
    const raw = '我说：今晚别关灯\n我说：今晚别关灯';
    expect(extractHooks(raw)[0]).toBe('我说：今晚别关灯');
  });

  it('counts repetition ignoring punctuation and spacing differences', () => {
    const raw = ['虚构开头一句', '海面折起一枚月亮', '海面折起一枚月亮，', '海面 折起 一枚 月亮'].join('\n');
    const hooks = extractHooks(raw);
    expect(hooks[0]).toBe('虚构开头一句');
    expect(hooks[1]).toBe('海面折起一枚月亮');
  });

  it('does not duplicate the opening line when it is also the most repeated', () => {
    const raw = ['同一句假想副歌', '同一句假想副歌', '同一句假想副歌'].join('\n');
    expect(extractHooks(raw)).toEqual(['同一句假想副歌']);
  });

  it('caps long lines at ~30 chars with an ellipsis', () => {
    const long = '这是一句故意写得非常非常长的虚构歌词用来验证截断行为是否符合三十个字符的上限要求';
    const hooks = extractHooks(`${long}\n${long}`);
    expect(Array.from(hooks[0]).length).toBeLessThanOrEqual(30);
    expect(hooks[0].endsWith('…')).toBe(true);
  });

  it('cuts latin lines at a word boundary when capping', () => {
    const long = 'an intentionally overlong invented lyric line for the truncation test case';
    const [capped] = extractHooks(long);
    expect(Array.from(capped).length).toBeLessThanOrEqual(30);
    const stem = capped.slice(0, -1); // drop the ellipsis
    expect(long.startsWith(stem)).toBe(true);
    expect(long[stem.length]).toBe(' '); // boundary falls between words
  });

  it('returns [] for garbage: empty, non-string, credits-only, instrumental markers', () => {
    expect(extractHooks('')).toEqual([]);
    expect(extractHooks(null)).toEqual([]);
    expect(extractHooks(42)).toEqual([]);
    expect(extractHooks('作词：甲\n作曲：乙\n编曲：丙')).toEqual([]);
    expect(extractHooks('[00:00.00]纯音乐，请欣赏')).toEqual([]);
    expect(extractHooks('----\n****\n1234\n？？！！')).toEqual([]);
  });
});

describe('hooksForTrack cache', () => {
  const track = { source: 'netease', id: '42', title: '虚构之歌', artist: '虚构歌手' };
  const LYRIC = '假想的第一句\n假想的副歌句\n假想的副歌句';

  beforeEach(() => clearHooksCache());

  it('keys by source:id, falling back to artist/title', () => {
    expect(hookKey(track)).toBe('id:netease:42');
    expect(hookKey({ title: 'A Song', artist: 'Some One' })).toBe('song:some one - a song');
    expect(hookKey({})).toBe('');
  });

  it('fetches once and serves subsequent calls from the cache', async () => {
    let calls = 0;
    const fetcher = async () => { calls += 1; return LYRIC; };
    const first = await hooksForTrack(track, { fetcher });
    const second = await hooksForTrack(track, { fetcher });
    expect(first).toEqual(['假想的第一句', '假想的副歌句']);
    expect(second).toEqual(first);
    expect(calls).toBe(1);
  });

  it('caches misses so garbage is not re-fetched', async () => {
    let calls = 0;
    const fetcher = async () => { calls += 1; return ''; };
    expect(await hooksForTrack(track, { fetcher })).toEqual([]);
    expect(await hooksForTrack(track, { fetcher })).toEqual([]);
    expect(calls).toBe(1);
  });

  it('returns [] on timeout but lets the fetch fill the cache in the background', async () => {
    const slow = () => new Promise((resolve) => { setTimeout(() => resolve(LYRIC), 40); });
    const t0 = Date.now();
    const hooks = await hooksForTrack(track, { timeoutMs: 5, fetcher: slow });
    expect(hooks).toEqual([]);
    expect(Date.now() - t0).toBeLessThan(35);
    expect(cachedHooks(track)).toBeNull(); // not yet resolved
    await new Promise((r) => { setTimeout(r, 60); });
    expect(cachedHooks(track)).toEqual(['假想的第一句', '假想的副歌句']); // filled later
  });

  it('never throws even when the fetcher explodes', async () => {
    const fetcher = async () => { throw new Error('boom'); };
    expect(await hooksForTrack(track, { fetcher })).toEqual([]);
  });

  it('cachedHooks is null before any fetch; primeHooks seeds it synchronously', () => {
    expect(cachedHooks(track)).toBeNull();
    const hooks = primeHooks(track, LYRIC);
    expect(hooks).toEqual(['假想的第一句', '假想的副歌句']);
    expect(cachedHooks(track)).toEqual(hooks);
  });

  it('prefetchHooks warms the cache without blocking', async () => {
    let calls = 0;
    const fetcher = async () => { calls += 1; return LYRIC; };
    prefetchHooks(track, { fetcher });
    prefetchHooks(track, { fetcher }); // dedupes the in-flight fetch
    await new Promise((r) => { setTimeout(r, 10); });
    expect(calls).toBe(1);
    expect(cachedHooks(track)).toEqual(['假想的第一句', '假想的副歌句']);
  });
});
