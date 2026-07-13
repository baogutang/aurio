// 对话歌卡 (song cards in chat) — pure logic.
//
// When a chat/trigger reply lands tracks on the programme, the reply's queue
// items render as tappable cards under the DJ's line. Tapping one is
// 「现在就放这首」: the client re-enters the hotline with an explicitly urgent
// phrasing (现在放 …), which the server's URGENT_RE routes to the insert-next
// (插播) channel — no new endpoint, the tap is just a very direct caller.
import type { SegmentResult, SongCard, Track } from './types';

export const MAX_SONG_CARDS = 5;

/** Tracks a segment reply landed on the programme, capped for the card row. */
export function cardsFromSegment(b: SegmentResult | null | undefined, max = MAX_SONG_CARDS): SongCard[] {
  if (!b || b.error || !Array.isArray(b.queue)) return [];
  return b.queue
    .filter((t): t is Track => !!t && !!(t.title || t.id))
    .slice(0, Math.max(0, max))
    .map((t) => ({
      source: t.source,
      id: t.id ?? '',
      title: t.title || '',
      artist: t.artist || '',
    }));
}

export type SongCardState = 'normal' | 'queued' | 'playing';

type TrackLike = Pick<Track, 'title' | 'artist'> & { source?: string; id?: string };

// Identity: source+id when both sides have one, title+artist otherwise —
// the same track can arrive with or without a stable id depending on source.
const keyOf = (t: TrackLike): string =>
  t.id && t.source
    ? `${t.source}:${t.id}`
    : `t:${(t.title || '').trim().toLowerCase()}|${(t.artist || '').trim().toLowerCase()}`;

const matches = (a: TrackLike, b: TrackLike): boolean =>
  keyOf(a) === keyOf(b)
  || (!!a.title && !!b.title
    && a.title.trim().toLowerCase() === b.title.trim().toLowerCase()
    && (a.artist || '').trim().toLowerCase() === (b.artist || '').trim().toLowerCase());

/**
 * A card is `playing` when its track is on air, `queued` while it is still in
 * the upcoming programme, and `normal` once the programme has moved past it
 * (already aired, or steered away).
 */
export function cardState(
  card: SongCard,
  current: Track | null | undefined,
  upNext: readonly Track[] | undefined,
): SongCardState {
  if (current && matches(card, current)) return 'playing';
  if (upNext?.some((t) => matches(card, t))) return 'queued';
  return 'normal';
}
