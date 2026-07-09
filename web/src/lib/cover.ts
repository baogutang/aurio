import type { Track } from './types';

/**
 * Same-origin cover URL.
 *
 * Never point an <img> at the raw NetEase / QQ CDN: those hosts send no CORS
 * headers, so a canvas that reads the pixels for colour extraction taints and
 * throws. Everything goes through the local server, which also normalizes the
 * three sources' wildly different notions of "cover" (Navidrome hands out an
 * opaque id, the others hand out URLs).
 *
 * Served by `GET /api/cover/:source/:id`. Returns null when the track cannot
 * possibly have art, so callers can render their fallback without a 404.
 */
export function coverUrl(track?: Pick<Track, 'source' | 'id'> | null): string | null {
  if (!track?.source || !track?.id) return null;
  return `/api/cover/${track.source}/${encodeURIComponent(track.id)}`;
}
