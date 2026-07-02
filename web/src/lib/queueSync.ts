import type { Track } from './types';

/** Merge server queue tail while preserving the currently playing prefix. */
export function mergeQueueWhilePlaying(local: Track[], server: Track[], playingIndex: number): Track[] {
  if (playingIndex < 0) return server;
  const head = local.slice(0, playingIndex + 1);
  const serverTail = server.length > playingIndex + 1 ? server.slice(playingIndex + 1) : [];
  return [...head, ...serverTail];
}
