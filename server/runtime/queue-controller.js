// Read-only projection of the programme log for legacy read paths.
//
// The queue-controller WORLD — optimistic-concurrency revisions, client queue
// edits, steerAndAppend, patchSegueTts, the five broadcast modes — was deleted
// in the P3 playout cutover (docs/PLAYOUT_CUTOVER.md). All mutations now go
// through server/playout/station.js.
//
// This file remains only because server/context.js and server/agent/loop.js
// (owned by a parallel workstream) still import `queueController.peekSnapshot()`
// to build the DJ prompt. It projects [on-air track, ...upcoming] out of the
// log; `revision` is pinned to 0 and means nothing anymore.
import { station } from '../playout/station.js';

export const queueController = {
  peekSnapshot() {
    return { queue: station.viewTracks(), revision: 0 };
  },

  getSnapshot() {
    return this.peekSnapshot();
  },
};
