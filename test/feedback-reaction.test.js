import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const runSegment = vi.fn(async () => ({ mode: 'insert', queue: [] }));
const isBusy = vi.fn(() => false);
const currentIndex = vi.fn(() => 1);
const hasActiveSession = vi.fn(() => true);

vi.mock('../server/dj.js', () => ({ runSegment, isBusy }));
vi.mock('../server/radio.js', () => ({ currentIndex, hasActiveSession }));

const { onPlaybackFeedback, pendingStreak, _reset } = await import('../server/agent/feedback-reaction.js');

const track = (n) => ({ id: String(n), title: `Song ${n}`, artist: 'Artist', source: 'netease' });

/** Push `n` skips through the debounce, letting each one settle. */
function skip(n = 1, at = 10) {
  for (let i = 0; i < n; i++) {
    onPlaybackFeedback({ signal: 'skipped', track: track(i), position_sec: at });
    vi.advanceTimersByTime(2500);
  }
}

describe('feedback-reaction', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _reset();
    runSegment.mockClear();
    isBusy.mockReturnValue(false);
    hasActiveSession.mockReturnValue(true);
  });

  afterEach(() => {
    _reset();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  // The whole point of the rewrite: a skip is a taste signal, not a conversation.
  it('stays silent for a single skip', () => {
    skip(1);
    expect(runSegment).not.toHaveBeenCalled();
  });

  it('stays silent for two skips', () => {
    skip(2);
    expect(runSegment).not.toHaveBeenCalled();
  });

  it('speaks once on a streak of three', () => {
    skip(3);
    expect(runSegment).toHaveBeenCalledTimes(1);
  });

  // The old build phrased the trigger as a fake user utterance, which dj.js then
  // wrote into the chat log as if the listener had typed it.
  it('carries a fact, never fake user text', () => {
    skip(3);
    const [trigger] = runSegment.mock.calls[0];
    expect(trigger.kind).toBe('feedback');
    expect(trigger.text).toBeUndefined();
    expect(trigger.fact).toMatch(/连着跳过了 3 首/);
    expect(trigger.fact).not.toMatch(/^用户刚跳过了/);
  });

  it('honours the cooldown after speaking', () => {
    skip(3);
    expect(runSegment).toHaveBeenCalledTimes(1);
    skip(3);
    expect(runSegment).toHaveBeenCalledTimes(1);
  });

  it('speaks again once the cooldown has passed', () => {
    skip(3);
    vi.advanceTimersByTime(20 * 60 * 1000 + 1);
    skip(3);
    expect(runSegment).toHaveBeenCalledTimes(2);
  });

  it('forgets skips that fall outside the streak window', () => {
    skip(2);
    vi.advanceTimersByTime(10 * 60 * 1000 + 1);
    skip(1);
    expect(runSegment).not.toHaveBeenCalled();
  });

  it('ignores a late skip', () => {
    skip(3, 50);
    expect(runSegment).not.toHaveBeenCalled();
  });

  it('counts dislikes toward the streak and names them', () => {
    onPlaybackFeedback({ signal: 'skipped', track: track(1), position_sec: 5 });
    onPlaybackFeedback({ signal: 'dislike', track: track(2), position_sec: 5 });
    onPlaybackFeedback({ signal: 'dislike', track: track(3), position_sec: 5 });
    vi.advanceTimersByTime(2500);
    expect(runSegment).toHaveBeenCalledTimes(1);
    expect(runSegment.mock.calls[0][0].fact).toMatch(/其中 2 首明确不喜欢/);
  });

  it('no-ops without an active session', () => {
    hasActiveSession.mockReturnValue(false);
    skip(3);
    expect(runSegment).not.toHaveBeenCalled();
  });

  it('pendingStreak is pure — reading it does not consume the streak', () => {
    onPlaybackFeedback({ signal: 'skipped', track: track(1), position_sec: 5 });
    onPlaybackFeedback({ signal: 'skipped', track: track(2), position_sec: 5 });
    onPlaybackFeedback({ signal: 'skipped', track: track(3), position_sec: 5 });
    expect(pendingStreak().count).toBe(3);
    expect(pendingStreak().count).toBe(3);
    vi.advanceTimersByTime(2500);
    expect(runSegment).toHaveBeenCalledTimes(1);
  });
});
