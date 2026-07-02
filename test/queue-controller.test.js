import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../server/store.js';
import { queueController, ConflictError } from '../server/runtime/queue-controller.js';

const track = (id, title = 'Song') => ({
  source: 'netease',
  id: String(id),
  title,
  artist: 'Artist',
});

beforeEach(() => {
  db.setQueueImmediate([]);
});

describe('queueController', () => {
  it('appends tracks and bumps revision', () => {
    const rev0 = queueController.peekSnapshot().revision;
    const { snapshot, added } = queueController.append([track(1, 'One'), track(2, 'Two')]);
    expect(added).toHaveLength(2);
    expect(snapshot.queue).toHaveLength(2);
    expect(snapshot.revision).toBeGreaterThan(rev0);
  });

  it('steer keeps through index', () => {
    queueController.replace([track(1), track(2), track(3)]);
    const { snapshot } = queueController.steer(0);
    expect(snapshot.queue.map((t) => t.id)).toEqual(['1']);
  });

  it('steer with negative index does not wipe queue', () => {
    queueController.replace([track(1, 'One'), track(2, 'Two'), track(3, 'Three')]);
    const { skipped, snapshot } = queueController.steer(-1);
    expect(skipped).toBe(true);
    expect(snapshot.queue).toHaveLength(3);
  });

  it('peekSnapshot does not bump revision on dedupe view', () => {
    db.setQueueImmediate([track(1), track(1)]);
    const rev0 = db.getQueueRevision();
    const snap = queueController.peekSnapshot();
    expect(snap.queue).toHaveLength(1);
    expect(db.getQueueRevision()).toBe(rev0);
  });

  it('repairIfNeeded commits dedupe', () => {
    db.setQueueImmediate([track(1), track(1)]);
    const rev0 = db.getQueueRevision();
    const snap = queueController.repairIfNeeded();
    expect(snap.queue).toHaveLength(1);
    expect(snap.revision).toBeGreaterThan(rev0);
  });

  it('rejects stale client revision', () => {
    queueController.replace([track(1)]);
    const stale = queueController.peekSnapshot().revision - 1;
    expect(() => queueController.replaceFromClient([track(2)], { expectedRevision: stale }))
      .toThrow(ConflictError);
  });

  it('rejects missing client revision', () => {
    queueController.replace([track(1)]);
    expect(() => queueController.replaceFromClient([track(2)], {}))
      .toThrow(ConflictError);
  });

  it('accepts matching client revision', () => {
    queueController.replace([track(1)]);
    const rev = queueController.peekSnapshot().revision;
    const { snapshot } = queueController.replaceFromClient([track(2)], { expectedRevision: rev });
    expect(snapshot.queue[0].id).toBe('2');
  });
});
