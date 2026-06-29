import type { Track } from './types';

function normKeyPart(value = '') {
  return value
    .toString()
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function keysFor(track: Track) {
  const keys: string[] = [];
  if (track.source && track.id) keys.push(`id:${track.source}:${track.id}`);
  const title = normKeyPart(track.title);
  const artist = normKeyPart(track.artist);
  if (title && artist) keys.push(`song:${artist} - ${title}`);
  return keys;
}

function mark(seen: Set<string>, track: Track) {
  for (const key of keysFor(track)) seen.add(key);
}

function hasSeen(seen: Set<string>, track: Track) {
  const keys = keysFor(track);
  return keys.length > 0 && keys.some((key) => seen.has(key));
}

export function dedupeQueue(queue: Track[], currentIndex = -1): { queue: Track[]; index: number } {
  const index = currentIndex >= 0 && currentIndex < queue.length ? currentIndex : -1;
  const seen = new Set<string>();

  if (index >= 0) {
    const out = queue.slice(0, index + 1);
    for (const track of out) mark(seen, track);
    for (const track of queue.slice(index + 1)) {
      if (hasSeen(seen, track)) continue;
      mark(seen, track);
      out.push(track);
    }
    return { queue: out, index };
  }

  const out: Track[] = [];
  for (const track of queue) {
    if (hasSeen(seen, track)) continue;
    mark(seen, track);
    out.push(track);
  }
  return { queue: out, index: -1 };
}
