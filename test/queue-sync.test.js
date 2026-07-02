import { describe, it, expect } from 'vitest';
import { mergeQueueWhilePlaying } from '../web/src/lib/queueSync.ts';

const t = (id) => ({ source: 'netease', id, title: `T${id}`, artist: 'A' });

describe('mergeQueueWhilePlaying', () => {
  it('returns server queue when idle', () => {
    const server = [t('1'), t('2'), t('3')];
    expect(mergeQueueWhilePlaying([t('9')], server, -1)).toEqual(server);
  });

  it('keeps playing prefix and merges tail', () => {
    const local = [t('1'), t('2'), t('old')];
    const server = [t('1'), t('2'), t('3'), t('4')];
    const merged = mergeQueueWhilePlaying(local, server, 1);
    expect(merged.map((x) => x.id)).toEqual(['1', '2', '3', '4']);
  });
});
