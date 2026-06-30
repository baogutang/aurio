import { describe, it, expect } from 'vitest';
import {
  candidatesToText, dedupeTracks, requestConstraints, trackKeys, trackMatchesConstraints,
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

describe('candidatesToText', () => {
  it('renders NAS source labels for prompt candidates', () => {
    expect(candidatesToText([
      { source: 'navidrome', id: '1', title: '晴天', artist: '周杰伦', album: '叶惠美' },
    ])).toBe('- 周杰伦 - 晴天 《叶惠美》 [NAS]');
  });
});
