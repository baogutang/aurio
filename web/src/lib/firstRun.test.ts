import { describe, it, expect } from 'vitest';
import { onboardExitAction, firstRunFollowUp } from './firstRun';

describe('onboardExitAction', () => {
  it('「开台」fires the one-time first-run ceremony for the controller', () => {
    expect(onboardExitAction({ goLive: true, isController: true })).toBe('first-run');
  });

  it('「跳过」keeps today\'s behaviour exactly: the plain station open', () => {
    expect(onboardExitAction({ goLive: false, isController: true })).toBe('station');
  });

  it('observers fire nothing, whichever button they hit', () => {
    expect(onboardExitAction({ goLive: true, isController: false })).toBe('none');
    expect(onboardExitAction({ goLive: false, isController: false })).toBe('none');
  });
});

describe('firstRunFollowUp', () => {
  it('a guard hit (ceremony already performed) falls back to the station open', () => {
    expect(firstRunFollowUp({ ok: true, alreadyPerformed: true, queue: [] } as never)).toBe('station');
  });

  it('a performed ceremony goes through the normal broadcast flow', () => {
    expect(firstRunFollowUp({ ts: 1, op: 'steer', say: '开场', queue: [] })).toBe('broadcast');
  });

  it('the quiet ceremony (nothing playable) also just broadcasts its line', () => {
    expect(firstRunFollowUp({ ts: 1, op: 'chat', quiet: true, say: '先陪你安静待一会儿', queue: [] })).toBe('broadcast');
  });

  it('errors and empty replies broadcast too — applyBroadcast owns error display', () => {
    expect(firstRunFollowUp({ error: 'boom' })).toBe('broadcast');
    expect(firstRunFollowUp(null)).toBe('broadcast');
    expect(firstRunFollowUp(undefined)).toBe('broadcast');
  });
});
