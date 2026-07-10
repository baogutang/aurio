// 磁带回放 (time-shift) — the pure model of the aired-programme tape.
//
// The station keeps broadcasting; the tape is a bounded, read-only view of
// what already aired (GET /api/tape). Playing from it is strictly LOCAL:
// nothing here touches the live timeline, and the caller is responsible for
// marking the player as time-shifted so programme pushes stop moving media.

import type { Track } from './types';

export type TapeItemType = 'song' | 'voicetrack' | 'liner' | 'id';

export interface TapeVoice {
  text?: string;
  ttsUrl?: string | null;
}

export interface TapeItem {
  id: string;
  type: TapeItemType;
  /** Wall-clock ms the item actually started airing. */
  airStart: number;
  /** Aired duration in ms. */
  duration: number;
  track: Pick<Track, 'source' | 'id' | 'title' | 'artist'> | null;
  streamUrl: string | null;
  voice: TapeVoice | null;
}

const TYPES: ReadonlySet<string> = new Set(['song', 'voicetrack', 'liner', 'id']);

/**
 * Validate an /api/tape response into TapeItems, dropping anything malformed
 * — a server without the endpoint (or with a different shape) yields [].
 */
export function parseTapeItems(json: unknown): TapeItem[] {
  const items = (json as { items?: unknown })?.items;
  if (!Array.isArray(items)) return [];
  const out: TapeItem[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const it = raw as Record<string, unknown>;
    const airStart = Number(it.airStart);
    const duration = Number(it.duration);
    if (typeof it.id !== 'string' || !it.id) continue;
    if (typeof it.type !== 'string' || !TYPES.has(it.type)) continue;
    if (!Number.isFinite(airStart) || airStart <= 0) continue;
    if (!Number.isFinite(duration) || duration < 0) continue;
    const track = it.track && typeof it.track === 'object'
      ? it.track as TapeItem['track']
      : null;
    const voiceRaw = it.voice && typeof it.voice === 'object'
      ? it.voice as Record<string, unknown>
      : null;
    out.push({
      id: it.id,
      type: it.type as TapeItemType,
      airStart,
      duration,
      track,
      streamUrl: typeof it.streamUrl === 'string' && it.streamUrl ? it.streamUrl : null,
      voice: voiceRaw
        ? {
            text: typeof voiceRaw.text === 'string' ? voiceRaw.text : undefined,
            ttsUrl: typeof voiceRaw.ttsUrl === 'string' && voiceRaw.ttsUrl ? voiceRaw.ttsUrl : null,
          }
        : null,
    });
  }
  return out;
}

/** The locally playable media URL of a tape item (null = listed, not playable). */
export function tapePlayUrl(item: TapeItem): string | null {
  if (item.type === 'song') return item.streamUrl;
  return item.voice?.ttsUrl ?? null;
}

/**
 * The next playable item AFTER `afterId` — the tape runs forward through
 * history like a real tape until it reaches the live edge (null = rejoin
 * live). `afterId` null starts from the top.
 */
export function nextPlayable(items: TapeItem[], afterId: string | null): TapeItem | null {
  let from = 0;
  if (afterId) {
    const i = items.findIndex((it) => it.id === afterId);
    if (i >= 0) from = i + 1;
  }
  for (let i = from; i < items.length; i++) {
    if (tapePlayUrl(items[i])) return items[i];
  }
  return null;
}

/**
 * The Track shape the player UI renders for a tape item. Voice items get the
 * caller-supplied label (i18n) as title and the spoken line as segue text.
 */
export function tapeDisplayTrack(item: TapeItem, voiceLabel: string, callSign: string): Track {
  if (item.type === 'song' && item.track) {
    return { ...item.track, url: item.streamUrl ?? undefined, segue: undefined, segueTtsUrl: null };
  }
  return {
    source: item.track?.source ?? 'netease',
    id: item.id,
    title: item.track?.title ?? voiceLabel,
    artist: item.track?.artist ?? callSign,
    segue: item.voice?.text,
    segueTtsUrl: null,
  };
}
