import { describe, it, expect } from 'vitest';
import {
  candidatesToText, dedupeTracks, requestConstraints, scoreMatch, trackKeys, trackMatchesConstraints,
} from '../server/music/index.js';

const t = (o) => ({ source: 'netease', id: '1', title: 'A', artist: 'X', ...o });

describe('trackKeys', () => {
  it('emits an id key and a normalized song key', () => {
    expect(trackKeys(t({ artist: 'Adele', title: 'Hello' }))).toEqual([
      'id:netease:1',
      'song:adele - hello',
    ]);
  });
});

describe('dedupeTracks', () => {
  it('drops exact id duplicates', () => {
    expect(dedupeTracks([t(), t()])).toHaveLength(1);
  });

  it('drops the same song across sources (case/space-insensitive)', () => {
    const out = dedupeTracks([
      { source: 'netease', id: '1', title: 'Hello', artist: 'Adele' },
      { source: 'qqmusic', id: '2', title: 'hello', artist: '  ADELE ' },
    ]);
    expect(out).toHaveLength(1);
  });

  it('excludes tracks already present in the existing set', () => {
    const a = t();
    expect(dedupeTracks([a], [a])).toEqual([]);
  });

  it('skips null entries', () => {
    expect(dedupeTracks([null, t({ id: '9' })])).toHaveLength(1);
  });
});

describe('requestConstraints', () => {
  it('treats NAS plus artist as hard source and artist constraints', () => {
    expect(requestConstraints('放NAS中的周杰伦的歌')).toEqual({
      source: 'navidrome',
      artist: '周杰伦',
    });
  });

  it('normalizes common Jay Chou aliases to the Chinese artist name', () => {
    expect(requestConstraints('来几首 Jay Chou 的歌').artist).toBe('周杰伦');
  });
});

describe('trackMatchesConstraints', () => {
  it('rejects tracks from the wrong source or artist', () => {
    const constraints = { source: 'navidrome', artist: '周杰伦' };
    expect(trackMatchesConstraints(
      { source: 'navidrome', id: '1', title: '晴天', artist: '周杰伦' },
      constraints,
    )).toBe(true);
    expect(trackMatchesConstraints(
      { source: 'netease', id: '2', title: '晴天', artist: '周杰伦' },
      constraints,
    )).toBe(false);
    expect(trackMatchesConstraints(
      { source: 'navidrome', id: '3', title: '后悔', artist: 'MissGoog' },
      constraints,
    )).toBe(false);
  });
});

describe('scoreMatch', () => {
  it('prefers the exact artist over a same-title cover (CJK)', () => {
    const real = { source: 'netease', id: '1', title: '晴天', artist: '周杰伦' };
    const cover = { source: 'netease', id: '2', title: '晴天 (Live)', artist: '群星' };
    expect(scoreMatch('周杰伦 - 晴天', real)).toBeGreaterThan(scoreMatch('周杰伦 - 晴天', cover));
  });

  it('penalizes an artist mismatch even on an exact title', () => {
    const wrong = { title: '晴天', artist: '林俊杰' };
    const right = { title: '晴天', artist: '周杰伦' };
    expect(scoreMatch('周杰伦 - 晴天', right)).toBeGreaterThan(scoreMatch('周杰伦 - 晴天', wrong));
  });

  it('scores an exact title above a karaoke cover when no artist is given', () => {
    const exact = { title: 'Hello', artist: 'Adele' };
    const karaoke = { title: 'Hello (Karaoke Version)', artist: 'Sing King' };
    expect(scoreMatch('Hello', exact)).toBe(1);
    expect(scoreMatch('Hello', exact)).toBeGreaterThan(scoreMatch('Hello', karaoke));
  });
});

describe('candidatesToText', () => {
  it('renders NAS source labels for prompt candidates', () => {
    expect(candidatesToText([
      { source: 'navidrome', id: '1', title: '晴天', artist: '周杰伦', album: '叶惠美' },
    ])).toBe('- 周杰伦 - 晴天 《叶惠美》 [NAS]');
  });

  it('enriches the line with year, duration and genre when present', () => {
    expect(candidatesToText([
      { source: 'netease', id: '1', title: '晴天', artist: '周杰伦', album: '叶惠美', year: 2003, duration: 269, genre: 'Pop' },
    ])).toBe('- 周杰伦 - 晴天 《叶惠美》 (2003 · 4:29 · Pop) [网易云]');
  });

  it('omits missing metadata fields rather than printing empties', () => {
    expect(candidatesToText([
      { source: 'qqmusic', id: '1', title: 'A', artist: 'X', duration: 65 },
    ])).toBe('- X - A (1:05) [QQ音乐]');
  });
});
