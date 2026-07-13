import { describe, it, expect } from 'vitest';
import { cardsFromSegment, cardState, MAX_SONG_CARDS } from './songCards';
import type { SegmentResult, Track } from './types';

const tr = (id: string, title: string, artist: string): Track => ({
  source: 'netease', id, title, artist,
});

describe('cardsFromSegment', () => {
  it('maps the reply queue into cards', () => {
    const b: SegmentResult = {
      kind: 'chat', op: 'insert', placement: 'append',
      queue: [tr('1', '海阔天空', 'Beyond'), tr('2', '光辉岁月', 'Beyond')],
    };
    expect(cardsFromSegment(b)).toEqual([
      { source: 'netease', id: '1', title: '海阔天空', artist: 'Beyond' },
      { source: 'netease', id: '2', title: '光辉岁月', artist: 'Beyond' },
    ]);
  });

  it('caps at MAX_SONG_CARDS', () => {
    const queue = Array.from({ length: 9 }, (_, i) => tr(String(i), `t${i}`, 'a'));
    expect(cardsFromSegment({ queue }).length).toBe(MAX_SONG_CARDS);
  });

  it('is empty for errors, missing queues and null replies', () => {
    expect(cardsFromSegment(null)).toEqual([]);
    expect(cardsFromSegment(undefined)).toEqual([]);
    expect(cardsFromSegment({ error: 'boom', queue: [tr('1', 'x', 'y')] })).toEqual([]);
    expect(cardsFromSegment({ op: 'chat', queue: [] })).toEqual([]);
    expect(cardsFromSegment({ op: 'chat' })).toEqual([]);
  });

  it('drops queue entries without any identity', () => {
    const b: SegmentResult = { queue: [tr('1', 'ok', 'a'), { source: 'netease', id: '', title: '' } as Track] };
    expect(cardsFromSegment(b)).toHaveLength(1);
  });
});

describe('cardState', () => {
  const card = { source: 'netease' as const, id: '42', title: 'Karma Police', artist: 'Radiohead' };

  it('is playing when the card is on air (source+id identity)', () => {
    expect(cardState(card, tr('42', 'Karma Police', 'Radiohead'), [])).toBe('playing');
  });

  it('is queued while still in the upcoming programme', () => {
    expect(cardState(card, tr('7', 'other', 'x'), [tr('42', 'Karma Police', 'Radiohead')])).toBe('queued');
  });

  it('is normal once the programme moved past it', () => {
    expect(cardState(card, tr('7', 'other', 'x'), [tr('8', 'another', 'y')])).toBe('normal');
    expect(cardState(card, null, undefined)).toBe('normal');
  });

  it('falls back to title+artist when ids differ across sources', () => {
    const onAir: Track = { source: 'navidrome', id: 'nav-9', title: 'Karma Police', artist: 'Radiohead' };
    expect(cardState(card, onAir, [])).toBe('playing');
  });

  it('title match is case- and whitespace-insensitive', () => {
    const queued: Track = { source: 'qqmusic', id: 'q1', title: ' karma police ', artist: 'RADIOHEAD' };
    expect(cardState(card, null, [queued])).toBe('queued');
  });
});
