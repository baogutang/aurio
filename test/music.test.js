import { describe, it, expect } from 'vitest';
import { dedupeTracks, trackKeys } from '../server/music/index.js';

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
