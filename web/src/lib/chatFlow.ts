// Pure chat-sheet flow logic, extracted from App so it stays testable:
//  · isHotlineAccepted — did the DJ take this chat as a hotline request
//    (queued for later) rather than playing it right now?
//  · shouldAutoCloseChat — is it safe to auto-close the sheet after a reply?
import type { Broadcast } from './types';

// A hotline request was accepted for later (non-urgent 点歌): the reply is a
// chat-kind broadcast whose tracks joined the tail of the show instead of
// cutting the line. Server side this is mode 'insert' + placement 'append'
// (or a plain 'append') with tracks actually added.
export function isHotlineAccepted(b: Broadcast | null | undefined): boolean {
  if (!b || b.error) return false;
  if ((b.kind ?? 'chat') !== 'chat') return false;
  if (!b.queue || b.queue.length === 0) return false;
  return b.mode === 'append' || (b.mode === 'insert' && b.placement === 'append');
}

export interface AutoCloseGuard {
  /** Chat/trigger requests still awaiting a response. */
  sendsInFlight: number;
  /** Input-activity counter captured when this request went out. */
  activityAtSend: number;
  /** Input-activity counter now. */
  activityNow: number;
}

// Auto-close only when this was the last in-flight request and the user has
// not focused or typed in the input since it was sent. Checked twice: when
// the reply lands (to schedule the linger) and again when the timer fires.
export function shouldAutoCloseChat(g: AutoCloseGuard): boolean {
  return g.sendsInFlight <= 0 && g.activityNow === g.activityAtSend;
}
