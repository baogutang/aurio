import { describe, it, expect } from 'vitest';
import { parseTapeItems, tapePlayUrl, nextPlayable, tapeDisplayTrack, type TapeItem } from './tape';

const song = (id: string, over: Partial<TapeItem> = {}): TapeItem => ({
  id,
  type: 'song',
  airStart: 1_000_000,
  duration: 180_000,
  track: { source: 'netease', id: `t-${id}`, title: `Song ${id}`, artist: 'Artist' },
  streamUrl: `/api/ncm/stream/${id}`,
  voice: null,
  ...over,
});

const voice = (id: string, over: Partial<TapeItem> = {}): TapeItem => ({
  id,
  type: 'voicetrack',
  airStart: 1_000_000,
  duration: 9_000,
  track: null,
  streamUrl: null,
  voice: { text: '刚才那首……', ttsUrl: `/tts/${id}.mp3` },
  ...over,
});

describe('parseTapeItems', () => {
  it('accepts the contract shape', () => {
    const items = parseTapeItems({
      ok: true,
      items: [
        { id: 'a', type: 'song', airStart: 1000, duration: 180000, track: { source: 'netease', id: 'x', title: 'T', artist: 'A' }, streamUrl: '/s/a', voice: null },
        { id: 'b', type: 'voicetrack', airStart: 2000, duration: 8000, track: null, streamUrl: null, voice: { text: 'hi', ttsUrl: '/tts/b.mp3' } },
        { id: 'c', type: 'liner', airStart: 3000, duration: 5000, track: null, streamUrl: null, voice: { text: 'liner', ttsUrl: null } },
      ],
    });
    expect(items).toHaveLength(3);
    expect(items[0].streamUrl).toBe('/s/a');
    expect(items[1].voice?.ttsUrl).toBe('/tts/b.mp3');
    expect(items[2].voice?.ttsUrl).toBeNull();
  });

  it('drops malformed entries and survives garbage — a missing endpoint yields []', () => {
    expect(parseTapeItems(undefined)).toEqual([]);
    expect(parseTapeItems({ error: 'not found' })).toEqual([]);
    expect(parseTapeItems({ items: 'nope' })).toEqual([]);
    const items = parseTapeItems({
      items: [
        null,
        { id: '', type: 'song', airStart: 1, duration: 1 },          // empty id
        { id: 'x', type: 'ad', airStart: 1, duration: 1 },           // unknown type
        { id: 'y', type: 'song', airStart: 'soon', duration: 1 },    // bad airStart
        { id: 'z', type: 'song', airStart: 5, duration: -2 },        // bad duration
        { id: 'ok', type: 'id', airStart: 5, duration: 3000 },       // minimal valid
      ],
    });
    expect(items.map((i) => i.id)).toEqual(['ok']);
    expect(items[0].track).toBeNull();
    expect(items[0].streamUrl).toBeNull();
  });
});

describe('tapePlayUrl', () => {
  it('songs play their stream, spoken items their tts', () => {
    expect(tapePlayUrl(song('a'))).toBe('/api/ncm/stream/a');
    expect(tapePlayUrl(voice('v'))).toBe('/tts/v.mp3');
  });
  it('items without media are listed but not playable', () => {
    expect(tapePlayUrl(song('a', { streamUrl: null }))).toBeNull();
    expect(tapePlayUrl(voice('v', { voice: { text: 'lost' } }))).toBeNull();
  });
});

describe('nextPlayable — the tape runs forward until the live edge', () => {
  const items = [song('a'), voice('v', { voice: { text: 'x' } }), song('b'), song('c', { streamUrl: null })];
  it('starts at the top with no anchor', () => {
    expect(nextPlayable(items, null)?.id).toBe('a');
  });
  it('skips unplayable items', () => {
    expect(nextPlayable(items, 'a')?.id).toBe('b'); // v has no ttsUrl
  });
  it('returns null at the live edge (caller rejoins live)', () => {
    expect(nextPlayable(items, 'b')).toBeNull(); // c is unplayable, nothing after
    expect(nextPlayable([], null)).toBeNull();
  });
  it('an unknown anchor falls back to the top', () => {
    expect(nextPlayable(items, 'ghost')?.id).toBe('a');
  });
});

describe('tapeDisplayTrack', () => {
  it('songs keep their identity and use the tape stream url', () => {
    const t = tapeDisplayTrack(song('a'), '口播', 'AURIO');
    expect(t).toMatchObject({ id: 't-a', title: 'Song a', url: '/api/ncm/stream/a' });
    expect(t.segueTtsUrl).toBeNull(); // the tape never re-triggers the voice intro path
  });
  it('spoken items become a labelled station line with the text as segue', () => {
    const t = tapeDisplayTrack(voice('v'), '口播', 'AURIO');
    expect(t.title).toBe('口播');
    expect(t.artist).toBe('AURIO');
    expect(t.segue).toBe('刚才那首……');
  });
});
