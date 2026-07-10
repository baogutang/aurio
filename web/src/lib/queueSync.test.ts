import { describe, it, expect } from 'vitest';
import { mergeQueueWhilePlaying } from './queueSync';
import type { Track } from './types';

function tk(id: string, title = id.toUpperCase()): Track {
  return { source: 'netease', id, title, artist: 'Artist' };
}

describe('mergeQueueWhilePlaying', () => {
  it('returns the server queue as-is (same reference) when nothing is playing', () => {
    const local = [tk('l1')];
    const server = [tk('s1'), tk('s2')];
    const out = mergeQueueWhilePlaying(local, server, -1);
    expect(out).toBe(server);
  });

  it('keeps the local prefix through the playing index and takes the server tail after it', () => {
    const local = [tk('a'), tk('b'), tk('c'), tk('d')];
    const server = [tk('a'), tk('b'), tk('x'), tk('y'), tk('z')];
    const out = mergeQueueWhilePlaying(local, server, 1);
    expect(out).toEqual([tk('a'), tk('b'), tk('x'), tk('y'), tk('z')]);
  });

  it('positions the server tail by index, not by identity — head content comes only from local', () => {
    // Server may have a completely different head; it is ignored while playing.
    const local = [tk('localA'), tk('localB')];
    const server = [tk('serverA'), tk('serverB'), tk('serverC')];
    const out = mergeQueueWhilePlaying(local, server, 0);
    expect(out).toEqual([tk('localA'), tk('serverB'), tk('serverC')]);
  });

  it('drops the server update entirely when the server queue is not longer than the playing prefix', () => {
    const local = [tk('a'), tk('b'), tk('c')];
    const server = [tk('x')];
    const out = mergeQueueWhilePlaying(local, server, 2);
    expect(out).toEqual([tk('a'), tk('b'), tk('c')]);
  });

  it('returns only the local head when server length equals playingIndex + 1', () => {
    const local = [tk('a'), tk('b'), tk('c'), tk('d')];
    const server = [tk('x'), tk('y')];
    const out = mergeQueueWhilePlaying(local, server, 1);
    expect(out).toEqual([tk('a'), tk('b')]);
  });

  it('handles empty local and empty server queues', () => {
    expect(mergeQueueWhilePlaying([], [], 0)).toEqual([]);
    expect(mergeQueueWhilePlaying([], [], -1)).toEqual([]);
  });

  it('playingIndex 0 replaces everything after the current track', () => {
    const local = [tk('now'), tk('old1'), tk('old2')];
    const server = [tk('now'), tk('new1')];
    expect(mergeQueueWhilePlaying(local, server, 0)).toEqual([tk('now'), tk('new1')]);
  });

  it('characterizes index math when playingIndex exceeds local length: server rows before the cut are silently skipped', () => {
    // local.slice(0, 4) can only yield 1 item, but the server tail still cuts
    // at index 4 — server rows 1..3 vanish from the merge. Documented quirk:
    // callers must not pass a playingIndex beyond local bounds.
    const local = [tk('only')];
    const server = [tk('s0'), tk('s1'), tk('s2'), tk('s3'), tk('s4'), tk('s5')];
    const out = mergeQueueWhilePlaying(local, server, 3);
    expect(out).toEqual([tk('only'), tk('s4'), tk('s5')]);
  });

  it('does not mutate its inputs', () => {
    const local = [tk('a'), tk('b')];
    const server = [tk('a'), tk('x')];
    const localCopy = [...local];
    const serverCopy = [...server];
    mergeQueueWhilePlaying(local, server, 0);
    expect(local).toEqual(localCopy);
    expect(server).toEqual(serverCopy);
  });
});
