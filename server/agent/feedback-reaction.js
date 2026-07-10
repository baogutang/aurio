// A skip is a taste signal, not a conversation.
//
// The old implementation spoke a whole DJ segment on every qualifying skip, and
// phrased the trigger as a fake user utterance ("用户刚跳过了：X，下一首别放类似的")
// which dj.js then wrote into the message log as if the listener had said it.
// Those synthetic lines fed straight back into the next prompt, so the host spent
// its days imitating its own filler. Real radio is 85-88% music; a jock who
// comments on every skip is a nag.
//
// Now: a single skip only updates taste (recordFeedback, called separately by the
// API route). Only a STREAK earns one spoken line, and never more than once per
// cooldown. The trigger carries a structured fact — never fake user text.
import { runSegment, isBusy } from '../dj.js';
import { currentIndex, hasActiveSession } from '../radio.js';

const STREAK_THRESHOLD = 3;              // negative signals before Aurio says anything
const STREAK_WINDOW_MS = 10 * 60 * 1000; // ...within this window
const COOLDOWN_MS = 20 * 60 * 1000;      // ...and at most this often
const DEBOUNCE_MS = 2500;                // let a burst of skips settle first

let recent = [];      // { ts, normalized, track }
let lastSpokeAt = 0;
let timer = null;

/** Test seam: forget everything between cases. */
export function _reset() {
  recent = [];
  lastSpokeAt = 0;
  if (timer) clearTimeout(timer);
  timer = null;
}

function prune(now) {
  recent = recent.filter((e) => now - e.ts <= STREAK_WINDOW_MS);
}

/** The streak Aurio would react to right now, or null. Pure — no side effects. */
export function pendingStreak(now = Date.now()) {
  prune(now);
  if (recent.length < STREAK_THRESHOLD) return null;
  if (now - lastSpokeAt < COOLDOWN_MS) return null;
  return {
    count: recent.length,
    disliked: recent.filter((e) => e.normalized === 'dislike').length,
    tracks: recent.map((e) => `${e.track.artist || ''} — ${e.track.title || ''}`.trim()),
  };
}

function fireReaction() {
  if (!hasActiveSession()) return;
  const streak = pendingStreak();
  if (!streak) return;
  if (isBusy()) {
    timer = setTimeout(fireReaction, 800);
    if (timer.unref) timer.unref();
    return;
  }

  lastSpokeAt = Date.now();
  recent = [];

  // A fact for the host to voice, not a script and not a fake user message.
  const fact = streak.disliked
    ? `听众连着跳过了 ${streak.count} 首（其中 ${streak.disliked} 首明确不喜欢）：${streak.tracks.join('、')}。换个方向。`
    : `听众连着跳过了 ${streak.count} 首：${streak.tracks.join('、')}。换个方向。`;

  runSegment(
    { kind: 'feedback', fact },
    { mode: 'insert', currentIndex: currentIndex() },
  ).catch((e) => console.error('[feedback-reaction]', e.message));
}

export function onPlaybackFeedback({ signal, track, position_sec = 0 }) {
  const normalized = signal === 'skipped' ? 'skip' : signal;
  if (!['dislike', 'skip'].includes(normalized)) return;
  if (normalized === 'skip' && position_sec > 45) return;
  if (!track?.title && !track?.id) return;

  const now = Date.now();
  prune(now);
  recent.push({ ts: now, normalized, track });

  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    fireReaction();
  }, DEBOUNCE_MS);
  if (timer.unref) timer.unref();
}
