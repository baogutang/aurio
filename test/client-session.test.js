import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { clientSessionManager } from '../server/runtime/client-session-manager.js';
import { eventBus } from '../server/runtime/event-bus.js';

const fakeWs = () => ({ readyState: 1, send: vi.fn() });
const registered = [];

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  while (registered.length) clientSessionManager.unregister(registered.pop());
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe('clientSessionManager', () => {
  it('elects playing client with higher index as controller', () => {
    const a = clientSessionManager.register(fakeWs());
    const b = clientSessionManager.register(fakeWs());
    registered.push(a.clientId, b.clientId);
    clientSessionManager.onHeartbeat(a.clientId, { playingIndex: 0, paused: false, queueLen: 3 });
    vi.advanceTimersByTime(5);
    clientSessionManager.onHeartbeat(b.clientId, { playingIndex: 1, paused: false, queueLen: 3 });
    const ctrl = clientSessionManager.getController();
    expect(ctrl?.clientId).toBe(b.clientId);
  });

  it('stores valid positionSec/durationSec from the heartbeat', () => {
    const a = clientSessionManager.register(fakeWs());
    registered.push(a.clientId);
    clientSessionManager.onHeartbeat(a.clientId, {
      playingIndex: 0, paused: false, queueLen: 2, positionSec: 42, durationSec: 200,
    });
    const ctrl = clientSessionManager.getController();
    expect(ctrl?.positionSec).toBe(42);
    expect(ctrl?.durationSec).toBe(200);
  });

  it('rejects garbage position/duration and a position past the duration', () => {
    const a = clientSessionManager.register(fakeWs());
    registered.push(a.clientId);
    clientSessionManager.onHeartbeat(a.clientId, {
      playingIndex: 0, paused: false, queueLen: 2, positionSec: 'NaN', durationSec: -5,
    });
    let ctrl = clientSessionManager.getController();
    expect(ctrl?.positionSec).toBeNull();
    expect(ctrl?.durationSec).toBeNull();
    clientSessionManager.onHeartbeat(a.clientId, {
      playingIndex: 0, paused: false, queueLen: 2, positionSec: 500, durationSec: 200,
    });
    ctrl = clientSessionManager.getController();
    expect(ctrl?.positionSec).toBeNull();
    expect(ctrl?.durationSec).toBe(200);
  });

  it('emits session:all-gone after grace when last client leaves', () => {
    const onGone = vi.fn();
    eventBus.once('session:all-gone', onGone);
    const { clientId } = clientSessionManager.register(fakeWs());
    registered.push(clientId);
    clientSessionManager.unregister(clientId);
    registered.pop();
    expect(onGone).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30000);
    expect(onGone).toHaveBeenCalledTimes(1);
  });
});
