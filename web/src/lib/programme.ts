// Pure programme-timeline logic for the client — the mirror of the server's
// snapshotAt arithmetic (server/playout/log.js), so the player can advance
// through the schedule locally between server pushes and rejoin the live edge
// after a pause without a round-trip. All times are server wall-clock ms.
import type { Track } from './types';

export interface ProgrammeVoice {
  text?: string;
  ttsUrl?: string | null;
  kind?: string;
}

export interface ProgrammeItem {
  id: string;
  type: 'song' | 'voicetrack' | 'liner' | 'id' | 'stinger';
  scheduledStart: number | null;
  airStart: number | null;
  duration: number;
  track: Track | null;
  streamUrl: string | null;
  cueIn: number;
  cueOut: number;
  seguePoint: number;
  introSec: number | null;
  outroSec: number | null;
  startType: 'ramp' | 'cold';
  endType: 'fade' | 'cold';
  lufs: number | null;
  gainDb: number;
  voice: ProgrammeVoice | null;
  pinned?: boolean;
}

/** The join()/programme WS payload. */
export interface ProgrammeSnapshot {
  serverNow: number;
  current: ProgrammeItem | null;
  offsetMs: number;
  ending: (ProgrammeItem & { offsetMs: number }) | null;
  upNext: ProgrammeItem[];
}

export interface SayEvent {
  ts?: number;
  kind?: string;
  text?: string;
  ttsUrl?: string | null;
}

export const startOf = (it: ProgrammeItem): number | null => it.airStart ?? it.scheduledStart;

/** Wall-clock instant the item stops being audible (media plays cueIn→cueOut). */
export function audibleEndOf(it: ProgrammeItem): number {
  const s = startOf(it);
  return (s ?? 0) + Math.max(0, it.cueOut - it.cueIn);
}

/** Clock skew: add to Date.now() to get server wall-clock time. */
export function skewFrom(snapshot: Pick<ProgrammeSnapshot, 'serverNow'>, localNow: number): number {
  return snapshot.serverNow - localNow;
}

/** Flatten a snapshot into the client's local timeline slice. */
export function itemsFrom(snapshot: ProgrammeSnapshot): ProgrammeItem[] {
  return [...(snapshot.current ? [snapshot.current] : []), ...snapshot.upNext];
}

/**
 * What is on air at server time `t` given a local timeline slice — the same
 * "last window containing t wins" rule as the server. `offsetMs` is the MEDIA
 * seek position (cueIn + elapsed).
 */
export function programmeAt(items: ProgrammeItem[], t: number): {
  current: ProgrammeItem | null;
  offsetMs: number;
  index: number;
} {
  let ci = -1;
  for (let i = 0; i < items.length; i++) {
    const s = startOf(items[i]);
    if (s == null || s > t) break;
    if (t < audibleEndOf(items[i])) ci = i;
  }
  if (ci < 0) return { current: null, offsetMs: 0, index: -1 };
  const cur = items[ci];
  return { current: cur, offsetMs: cur.cueIn + (t - (startOf(cur) as number)), index: ci };
}

/** The item scheduled after `id` in the slice (null at the tail). */
export function nextAfter(items: ProgrammeItem[], id: string | null): ProgrammeItem | null {
  if (!id) return null;
  const i = items.findIndex((it) => it.id === id);
  return i >= 0 ? items[i + 1] ?? null : null;
}

/** Upcoming tracks for the UI, relative to the item currently playing. */
export function upNextTracks(items: ProgrammeItem[], playingId: string | null): Track[] {
  let start = 0;
  if (playingId) {
    const i = items.findIndex((it) => it.id === playingId);
    if (i >= 0) start = i + 1;
  } else if (items.length && startOf(items[0]) != null) {
    // dead air with future items: everything is upcoming
    start = 0;
  }
  return items.slice(start).map(trackOf).filter((t): t is Track => !!t);
}

/** LogItem → the Track shape the UI renders (url ← streamUrl, voice ← segue). */
export function trackOf(item: ProgrammeItem | null): Track | null {
  if (!item?.track) return null;
  return {
    ...item.track,
    url: item.streamUrl ?? item.track.url,
    segue: item.voice?.text ?? item.track.segue,
    segueTtsUrl: item.voice?.ttsUrl ?? null,
  };
}

/**
 * Per-channel playback gain from the cue analysis (−16 LUFS normalization).
 * Clamped: boosting far beyond unity risks clipping the master bus.
 */
export function gainFactorOf(item: Pick<ProgrammeItem, 'gainDb'> | null): number {
  const db = Number(item?.gainDb);
  if (!Number.isFinite(db) || db === 0) return 1;
  return Math.min(2, Math.max(0.25, 10 ** (db / 20)));
}

/** Seconds of crossfade the schedule embeds at this item's tail. */
export function crossfadeSecOf(item: ProgrammeItem): number {
  if (item.endType === 'cold') return 0;
  const tail = (item.cueOut - item.seguePoint) / 1000;
  return Math.min(4, Math.max(0.05, tail || 2));
}
