// The cost gate — all that is left of the old radio stream engine.
//
// P3 cutover (docs/PLAYOUT_CUTOVER.md seam 1): the tick + remainingTracks
// refill engine died; server/playout/horizon.js answers the playout engine's
// 'horizon-low' instead. hasActiveSession keeps exactly one meaning — "may
// this LLM/TTS call spend money?" — and cursor advance never asks it.
//
// This module remains because scheduler.js, imaging.js and
// agent/feedback-reaction.js (parallel workstream) import from here.
import { clientSessionManager } from './runtime/client-session-manager.js';
import { station } from './playout/station.js';

export function hasActiveSession(maxAgeMs) {
  return clientSessionManager.hasActiveSession(maxAgeMs);
}

/** Legacy shape for runSegment opts: 0 while something is on air, else -1. */
export function currentIndex() {
  return station.current() ? 0 : -1;
}
