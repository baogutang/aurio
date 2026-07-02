// Authoritative queue mutations — single entry point for all queue changes.
import { db } from '../store.js';
import { dedupeTracks } from '../music/index.js';
import { eventBus } from './event-bus.js';

export class ConflictError extends Error {
  constructor(message = 'queue revision conflict') {
    super(message);
    this.name = 'ConflictError';
    this.code = 'QUEUE_REVISION_CONFLICT';
  }
}

function snapshot(queue, revision) {
  return { queue, revision };
}

function commit(nextQueue, meta = {}) {
  const prev = db.getQueue();
  const revision = db.bumpQueueRevision();
  db.setQueueImmediate(nextQueue);
  const result = {
    snapshot: snapshot(nextQueue, revision),
    delta: { ...meta, revision },
    prev,
    next: nextQueue,
  };
  eventBus.emit('queue:changed', result);
  return result;
}

export const queueController = {
  /** Read-only view — never mutates revision or persists. */
  peekSnapshot() {
    const raw = db.getQueue();
    const queue = dedupeTracks(raw);
    return snapshot(queue, db.getQueueRevision());
  },

  /** Dedupe persisted queue when dirty; call at startup or before writes. */
  repairIfNeeded() {
    const raw = db.getQueue();
    const queue = dedupeTracks(raw);
    if (queue.length !== raw.length) {
      return commit(queue, { op: 'dedupe' }).snapshot;
    }
    return this.peekSnapshot();
  },

  getSnapshot() {
    return this.peekSnapshot();
  },

  append(tracks, { dedupeAgainst } = {}) {
    const base = dedupeAgainst ?? this.peekSnapshot().queue;
    const incoming = dedupeTracks(tracks, base);
    const next = [...base, ...incoming];
    return {
      ...commit(next, { op: 'append', tracks: incoming }),
      added: incoming,
    };
  },

  insert(tracks, { at = 0, dedupeAgainst } = {}) {
    const q = [...(dedupeAgainst ?? this.peekSnapshot().queue)];
    const incoming = dedupeTracks(tracks, q);
    const idx = Math.max(0, Math.min(at, q.length));
    q.splice(idx, 0, ...incoming);
    return {
      ...commit(q, { op: 'insert', tracks: incoming, at: idx }),
      added: incoming,
    };
  },

  steer(keepThroughIndex) {
    if (keepThroughIndex < 0) {
      return { snapshot: this.peekSnapshot(), skipped: true };
    }
    const q = this.peekSnapshot().queue;
    const keep = Math.max(0, Math.min(keepThroughIndex + 1, q.length));
    const next = q.slice(0, keep);
    return commit(next, { op: 'steer', removedAfterIndex: keep - 1 });
  },

  replace(tracks) {
    const next = dedupeTracks(tracks);
    return commit(next, { op: 'replace', tracks: next });
  },

  replaceFromClient(queue, { expectedRevision } = {}) {
    const current = db.getQueueRevision();
    if (expectedRevision == null) {
      throw new ConflictError('baseRevision required');
    }
    if (expectedRevision !== current) {
      throw new ConflictError();
    }
    const next = dedupeTracks(queue);
    return commit(next, { op: 'client-edit', tracks: next });
  },

  patchSegueTts(trackRef, ttsUrl) {
    if (!trackRef || !ttsUrl) return this.peekSnapshot();
    const q = [...db.getQueue()];
    let changed = false;
    const next = q.map((item) => {
      if (changed) return item;
      const match = (trackRef.source && item.source === trackRef.source && trackRef.id && item.id === trackRef.id)
        || (trackRef.title && trackRef.artist && item.title === trackRef.title && item.artist === trackRef.artist);
      if (match) {
        changed = true;
        return { ...item, segueTtsUrl: ttsUrl };
      }
      return item;
    });
    if (!changed) return this.peekSnapshot();
    return commit(next, { op: 'patch-segue', track: trackRef });
  },
};
