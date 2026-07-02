// Debounced micro-reactions to skip/dislike playback signals.
import { runSegment, isBusy } from '../dj.js';
import { currentIndex, hasActiveSession } from '../radio.js';

let timer = null;
let pendingRun = null;

function fireReaction(normalized, track) {
  if (!hasActiveSession()) return;
  const label = `${track.artist || ''} — ${track.title || ''}`.trim();
  const text = normalized === 'dislike'
    ? `用户不喜欢这首：${label}，换一首不同风格的`
    : `用户刚跳过了：${label}，下一首别放类似的`;
  const run = () => {
    pendingRun = null;
    runSegment(
      { kind: 'station', text },
      { mode: 'insert', currentIndex: currentIndex() },
    ).catch((e) => console.error('[feedback-reaction]', e.message));
  };
  if (isBusy()) {
    pendingRun = { normalized, track };
    const wait = () => {
      if (!pendingRun) return;
      if (isBusy()) {
        setTimeout(wait, 800);
        return;
      }
      const p = pendingRun;
      pendingRun = null;
      if (!hasActiveSession()) return;
      const lbl = `${p.track.artist || ''} — ${p.track.title || ''}`.trim();
      const txt = p.normalized === 'dislike'
        ? `用户不喜欢这首：${lbl}，换一首不同风格的`
        : `用户刚跳过了：${lbl}，下一首别放类似的`;
      runSegment({ kind: 'station', text: txt }, { mode: 'insert', currentIndex: currentIndex() })
        .catch((e) => console.error('[feedback-reaction]', e.message));
    };
    setTimeout(wait, 800);
    return;
  }
  run();
}

export function onPlaybackFeedback({ signal, track, position_sec = 0 }) {
  const normalized = signal === 'skipped' ? 'skip' : signal;
  if (!['dislike', 'skip'].includes(normalized)) return;
  if (normalized === 'skip' && position_sec > 45) return;
  if (!track?.title && !track?.id) return;

  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    fireReaction(normalized, track);
  }, 2500);
  if (timer.unref) timer.unref();
}
