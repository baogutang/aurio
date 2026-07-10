import { describe, it, expect } from 'vitest';
import { dedupeQueue } from './queue';
import type { Track } from './types';

/** Build a track with sensible defaults; override what the test cares about. */
function tk(over: Partial<Track> = {}): Track {
  return { source: 'netease', id: '1', title: 'Song', artist: 'Artist', ...over };
}

describe('dedupeQueue — no current track (currentIndex = -1)', () => {
  it('returns empty queue and index -1 for an empty queue', () => {
    expect(dedupeQueue([], -1)).toEqual({ queue: [], index: -1 });
  });

  it('defaults currentIndex to -1 when omitted', () => {
    const a = tk({ id: 'a' });
    expect(dedupeQueue([a, a])).toEqual({ queue: [a], index: -1 });
  });

  it('keeps first occurrence when the same source+id appears twice', () => {
    const first = tk({ id: 'x', title: 'Original' });
    const dupe = tk({ id: 'x', title: 'Retitled' }); // same identity key id:netease:x
    const other = tk({ id: 'y', title: 'Other', artist: 'Someone' });
    const { queue, index } = dedupeQueue([first, dupe, other], -1);
    expect(queue).toEqual([first, other]);
    expect(index).toBe(-1);
  });

  it('dedupes the same song across different sources via title+artist', () => {
    const netease = tk({ source: 'netease', id: '100', title: 'Hello', artist: 'Adele' });
    const qq = tk({ source: 'qqmusic', id: '999', title: 'Hello', artist: 'Adele' });
    const { queue } = dedupeQueue([netease, qq], -1);
    expect(queue).toEqual([netease]);
  });

  it('normalizes case, extra whitespace, and full-width characters when matching', () => {
    const a = tk({ id: 'a', title: 'Love Song', artist: 'Some Artist' });
    // Full-width letters + ideographic space + case noise; NFKC folds them together.
    const b = tk({ id: 'b', title: 'ＬＯＶＥ　Ｓｏｎｇ', artist: '  some   ARTIST ' });
    const { queue } = dedupeQueue([a, b], -1);
    expect(queue).toEqual([a]);
  });

  it('does not dedupe tracks that produce no keys (missing id and missing title/artist)', () => {
    // No id => no id-key; empty title => no song-key. hasSeen() requires >= 1 key.
    const ghost1 = tk({ id: '', title: '', artist: 'X' });
    const ghost2 = tk({ id: '', title: '', artist: 'X' });
    const { queue } = dedupeQueue([ghost1, ghost2], -1);
    expect(queue).toEqual([ghost1, ghost2]);
  });

  it('does not treat title-only matches as duplicates when artist is empty', () => {
    // song-key requires BOTH title and artist; ids differ, so both survive.
    const a = tk({ id: 'a', title: 'Intro', artist: '' });
    const b = tk({ id: 'b', title: 'Intro', artist: '' });
    const { queue } = dedupeQueue([a, b], -1);
    expect(queue).toEqual([a, b]);
  });

  it('keeps different ids with different songs intact and preserves order', () => {
    const list = [
      tk({ id: '1', title: 'A', artist: 'x' }),
      tk({ id: '2', title: 'B', artist: 'x' }),
      tk({ id: '3', title: 'C', artist: 'x' }),
    ];
    expect(dedupeQueue(list, -1).queue).toEqual(list);
  });
});

describe('dedupeQueue — with a playing track (currentIndex >= 0)', () => {
  it('preserves the head up to currentIndex verbatim, even when the head has internal duplicates', () => {
    const a = tk({ id: 'a' });
    const aDupe = tk({ id: 'a' });
    const b = tk({ id: 'b', title: 'B' });
    // Head [a, aDupe] is history + current: it is never rewritten.
    const { queue, index } = dedupeQueue([a, aDupe, b], 1);
    expect(queue).toEqual([a, aDupe, b]);
    expect(index).toBe(1);
  });

  it('drops tail tracks already present in the head', () => {
    const a = tk({ id: 'a', title: 'A' });
    const b = tk({ id: 'b', title: 'B' });
    const aAgain = tk({ id: 'a', title: 'A' });
    const { queue, index } = dedupeQueue([a, b, aAgain], 0);
    expect(queue).toEqual([a, b]);
    expect(index).toBe(0);
  });

  it('dedupes within the tail itself', () => {
    const cur = tk({ id: 'cur', title: 'Now' });
    const t1 = tk({ id: 't', title: 'Tail' });
    const t2 = tk({ id: 't', title: 'Tail' });
    const { queue } = dedupeQueue([cur, t1, t2], 0);
    expect(queue).toEqual([cur, t1]);
  });

  it('leaves everything untouched when currentIndex is the last item', () => {
    const a = tk({ id: 'a' });
    const aDupe = tk({ id: 'a' });
    const { queue, index } = dedupeQueue([a, aDupe], 1);
    expect(queue).toEqual([a, aDupe]);
    expect(index).toBe(1);
  });

  it('treats an out-of-range currentIndex as -1 and dedupes the whole queue', () => {
    const a = tk({ id: 'a' });
    const aDupe = tk({ id: 'a' });
    const { queue, index } = dedupeQueue([a, aDupe], 5);
    expect(queue).toEqual([a]);
    expect(index).toBe(-1);
  });

  it('index 0 with a single-item queue is a no-op', () => {
    const a = tk({ id: 'a' });
    expect(dedupeQueue([a], 0)).toEqual({ queue: [a], index: 0 });
  });
});
