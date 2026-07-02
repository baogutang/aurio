import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const runSegment = vi.fn(async () => ({ mode: 'insert', queue: [] }));
const isBusy = vi.fn(() => false);
const currentIndex = vi.fn(() => 1);
const hasActiveSession = vi.fn(() => true);

vi.mock('../server/dj.js', () => ({ runSegment, isBusy }));
vi.mock('../server/radio.js', () => ({ currentIndex, hasActiveSession }));

const { onPlaybackFeedback } = await import('../server/agent/feedback-reaction.js');

describe('feedback-reaction', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    runSegment.mockClear();
    isBusy.mockReturnValue(false);
    hasActiveSession.mockReturnValue(true);
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  const track = { id: '1', title: 'Song', artist: 'Artist', source: 'netease' };

  it('debounces skip into runSegment', () => {
    onPlaybackFeedback({ signal: 'skipped', track, position_sec: 10 });
    expect(runSegment).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2500);
    expect(runSegment).toHaveBeenCalledTimes(1);
  });

  it('ignores late skip', () => {
    onPlaybackFeedback({ signal: 'skipped', track, position_sec: 50 });
    vi.advanceTimersByTime(2500);
    expect(runSegment).not.toHaveBeenCalled();
  });

  it('no-ops without active session', () => {
    hasActiveSession.mockReturnValue(false);
    onPlaybackFeedback({ signal: 'dislike', track, position_sec: 0 });
    vi.advanceTimersByTime(2500);
    expect(runSegment).not.toHaveBeenCalled();
  });
});
