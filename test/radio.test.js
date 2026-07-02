import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const runSegment = vi.fn(async () => ({ queue: [{ id: '1' }], mode: 'append' }));

vi.mock('../server/dj.js', () => ({ runSegment }));

const hasActiveSession = vi.fn(() => true);
const currentIndex = vi.fn(() => 2);

vi.mock('../server/runtime/client-session-manager.js', () => ({
  clientSessionManager: {
    getController: () => ({ playingIndex: 2, paused: false, queueLen: 6, lastSeen: Date.now() }),
    remaining: (len) => len - 3,
    hasActiveSession,
    currentIndex,
  },
}));

const { maybeRefill, remainingTracks } = await import('../server/radio.js');

describe('radio engine', () => {
  beforeEach(() => {
    runSegment.mockClear();
    hasActiveSession.mockReturnValue(true);
    currentIndex.mockReturnValue(2);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('remainingTracks uses conservative client estimate', () => {
    expect(remainingTracks()).toBeLessThanOrEqual(3);
  });

  it('maybeRefill triggers append segment when low water', async () => {
    await maybeRefill();
    expect(runSegment).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'refill' }),
      expect.objectContaining({ mode: 'append' }),
    );
  });
});
