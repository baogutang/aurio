import { describe, it, expect } from 'vitest';
import {
  programmeAt, itemsFrom, skewFrom, nextAfter, upNextTracks, trackOf,
  gainFactorOf, crossfadeSecOf, audibleEndOf, type ProgrammeItem, type ProgrammeSnapshot,
} from './programme';

const item = (id: string, over: Partial<ProgrammeItem> = {}): ProgrammeItem => ({
  id,
  type: 'song',
  scheduledStart: null,
  airStart: null,
  duration: 10000,
  track: { source: 'netease', id, title: `Song ${id}`, artist: 'A' },
  streamUrl: `/api/ncm/stream/${id}`,
  cueIn: 0,
  cueOut: 10000,
  seguePoint: 8000,
  introSec: null,
  outroSec: null,
  startType: 'cold',
  endType: 'fade',
  lufs: null,
  gainDb: 0,
  voice: null,
  ...over,
});

// a[0..10000) b[8000..18000) c[16000..26000)
const timeline = [
  item('a', { airStart: 0 }),
  item('b', { scheduledStart: 8000 }),
  item('c', { scheduledStart: 16000 }),
];

describe('programmeAt', () => {
  it('finds the on-air item and its media offset', () => {
    expect(programmeAt(timeline, 3500)).toMatchObject({ current: { id: 'a' }, offsetMs: 3500, index: 0 });
  });

  it('the incoming item wins during the crossfade window', () => {
    expect(programmeAt(timeline, 9000)).toMatchObject({ current: { id: 'b' }, offsetMs: 1000 });
  });

  it('offset includes cueIn', () => {
    const items = [item('a', { airStart: 0, cueIn: 1500, cueOut: 10000, seguePoint: 8000 })];
    expect(programmeAt(items, 2000).offsetMs).toBe(3500);
  });

  it('reports dead air past the tail', () => {
    expect(programmeAt(timeline, 30000)).toMatchObject({ current: null, index: -1 });
  });

  it('reports dead air before the head', () => {
    const future = [item('x', { scheduledStart: 5000 })];
    expect(programmeAt(future, 1000).current).toBeNull();
  });
});

describe('snapshot helpers', () => {
  const snap: ProgrammeSnapshot = {
    serverNow: 100000,
    current: item('a', { airStart: 95000 }),
    offsetMs: 5000,
    ending: null,
    upNext: [item('b', { scheduledStart: 103000 })],
  };

  it('flattens current + upNext into a timeline slice', () => {
    expect(itemsFrom(snap).map((it) => it.id)).toEqual(['a', 'b']);
    expect(itemsFrom({ ...snap, current: null }).map((it) => it.id)).toEqual(['b']);
  });

  it('computes the clock skew', () => {
    expect(skewFrom(snap, 99000)).toBe(1000);
    expect(skewFrom(snap, 101000)).toBe(-1000);
  });

  it('nextAfter walks the slice', () => {
    const items = itemsFrom(snap);
    expect(nextAfter(items, 'a')?.id).toBe('b');
    expect(nextAfter(items, 'b')).toBeNull();
    expect(nextAfter(items, null)).toBeNull();
  });

  it('upNextTracks is relative to the playing item', () => {
    const items = itemsFrom(snap);
    expect(upNextTracks(items, 'a').map((t) => t.id)).toEqual(['b']);
    expect(upNextTracks(items, null).map((t) => t.id)).toEqual(['a', 'b']);
  });
});

describe('trackOf', () => {
  it('maps streamUrl and voice onto the Track shape', () => {
    const t = trackOf(item('a', { voice: { text: '接下来', ttsUrl: '/tts/x.mp3' } }));
    expect(t).toMatchObject({
      id: 'a', url: '/api/ncm/stream/a', segue: '接下来', segueTtsUrl: '/tts/x.mp3',
    });
  });

  it('returns null without a track', () => {
    expect(trackOf(null)).toBeNull();
    expect(trackOf(item('a', { track: null }))).toBeNull();
  });
});

describe('mix parameters', () => {
  it('gainFactorOf converts dB and clamps at ±12 dB', () => {
    expect(gainFactorOf(item('a'))).toBe(1);
    expect(gainFactorOf(item('a', { gainDb: -6 }))).toBeCloseTo(0.501, 2);
    // The master-bus limiter gives normalization its full +12 dB headroom.
    expect(gainFactorOf(item('a', { gainDb: 12 }))).toBeCloseTo(3.981, 2);
    expect(gainFactorOf(item('a', { gainDb: 24 }))).toBeCloseTo(3.981, 2); // clamped
    expect(gainFactorOf(item('a', { gainDb: -24 }))).toBe(0.25); // clamped
    expect(gainFactorOf(null)).toBe(1);
  });

  it('crossfadeSecOf reads the schedule tail; cold ends never fade', () => {
    expect(crossfadeSecOf(item('a'))).toBe(2);
    expect(crossfadeSecOf(item('a', { seguePoint: 9000 }))).toBe(1);
    expect(crossfadeSecOf(item('a', { endType: 'cold', seguePoint: 10000 }))).toBe(0);
  });

  it('audibleEndOf follows cue bounds', () => {
    expect(audibleEndOf(item('a', { airStart: 100, cueIn: 500, cueOut: 9500 }))).toBe(9100);
  });
});
