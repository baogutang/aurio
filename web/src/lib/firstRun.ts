// 开台仪式 seam logic (RADIO_VISION §六) — the pure decisions behind finishing
// onboarding, extracted from App.tsx so they are testable without the player.
//
// The ceremony itself is server-side (server/rituals.js performFirstRun); the
// client only chooses which trigger to fire and what to do with the reply.

import type { Broadcast } from './types';

/** The server's /api/trigger reply for kind 'first-run' — a Broadcast plus the
 *  two ceremony-only markers. */
export interface FirstRunResponse extends Broadcast {
  /** Guard hit: the ceremony already performed for this data dir. */
  alreadyPerformed?: boolean;
  /** The quiet ceremony: nothing playable yet, fixed line, no segment ran. */
  quiet?: boolean;
}

export type OnboardExitAction = 'first-run' | 'station' | 'none';

/** What leaving the onboarding sheet should fire.
 *  「开台」performs the one-time ceremony;「跳过」keeps today's behaviour
 *  exactly (the plain station open); observers fire nothing. */
export function onboardExitAction({ goLive, isController }: { goLive: boolean; isController: boolean }): OnboardExitAction {
  if (!isController) return 'none';
  return goLive ? 'first-run' : 'station';
}

export type FirstRunFollowUp = 'station' | 'broadcast';

/** After the first-run reply lands: a guard hit falls back to today's station
 *  open (the button must still do something); everything else — including the
 *  quiet ceremony and error replies — goes through the normal broadcast flow. */
export function firstRunFollowUp(b: FirstRunResponse | null | undefined): FirstRunFollowUp {
  return b?.alreadyPerformed ? 'station' : 'broadcast';
}
