import { describe, it, expect } from 'vitest';
import { isHotlineAccepted, shouldAutoCloseChat } from './chatFlow';
import type { Broadcast, Track } from './types';

const track: Track = { source: 'navidrome', id: 't1', title: '晴天', artist: '周杰伦' };

describe('isHotlineAccepted', () => {
  it('accepts a chat broadcast whose tracks were appended for later', () => {
    expect(isHotlineAccepted({ kind: 'chat', mode: 'insert', placement: 'append', queue: [track] })).toBe(true);
    expect(isHotlineAccepted({ kind: 'chat', mode: 'append', queue: [track] })).toBe(true);
  });

  it('treats a missing kind as chat (the direct /api/chat reply)', () => {
    expect(isHotlineAccepted({ mode: 'insert', placement: 'append', queue: [track] })).toBe(true);
  });

  it('rejects an urgent insert-next — that plays now, no state line', () => {
    expect(isHotlineAccepted({ kind: 'chat', mode: 'insert', placement: 'next', queue: [track] })).toBe(false);
  });

  it('rejects replies without tracks, errors, and non-chat kinds', () => {
    expect(isHotlineAccepted({ kind: 'chat', mode: 'insert', placement: 'append', queue: [] })).toBe(false);
    expect(isHotlineAccepted({ kind: 'chat', mode: 'chat', queue: [] })).toBe(false);
    expect(isHotlineAccepted({ kind: 'chat', mode: 'append', queue: [track], error: 'boom' })).toBe(false);
    expect(isHotlineAccepted({ kind: 'refill', mode: 'append', queue: [track] })).toBe(false);
    expect(isHotlineAccepted(null)).toBe(false);
    expect(isHotlineAccepted(undefined)).toBe(false);
  });

  it('rejects steer/replace shapes', () => {
    const b: Broadcast = { kind: 'chat', mode: 'steer', queue: [track] };
    expect(isHotlineAccepted(b)).toBe(false);
    expect(isHotlineAccepted({ kind: 'chat', mode: 'replace', queue: [track] })).toBe(false);
  });
});

describe('shouldAutoCloseChat', () => {
  it('closes when idle and the input was untouched since sending', () => {
    expect(shouldAutoCloseChat({ sendsInFlight: 0, activityAtSend: 3, activityNow: 3 })).toBe(true);
  });

  it('keeps the sheet open while another send is in flight', () => {
    expect(shouldAutoCloseChat({ sendsInFlight: 1, activityAtSend: 3, activityNow: 3 })).toBe(false);
  });

  it('keeps the sheet open when the user focused or typed since sending', () => {
    expect(shouldAutoCloseChat({ sendsInFlight: 0, activityAtSend: 3, activityNow: 4 })).toBe(false);
  });
});
