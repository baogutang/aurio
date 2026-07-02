import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../server/store.js';
import { recordFeedback, scoreTrack } from '../server/agent/preferences.js';

beforeEach(() => {
  db.setPref('feedbackEvents', []);
  db.setPref('trackWeights', {});
});

describe('recordFeedback signal normalization', () => {
  const track = { id: '1', title: 'Song', artist: 'Artist', source: 'netease' };

  it('maps skipped → skip', () => {
    const e = recordFeedback({ signal: 'skipped', track, position_sec: 10 });
    expect(e.signal).toBe('skip');
  });

  it('maps replayed → replay', () => {
    const e = recordFeedback({ signal: 'replayed', track });
    expect(e.signal).toBe('replay');
  });

  it('increments dislike weight', () => {
    recordFeedback({ signal: 'dislike', track });
    const w = db.getPref('trackWeights', {})['Artist — Song'];
    expect(w.dislikes).toBe(1);
    expect(w.skips).toBe(1);
  });
});

describe('scoreTrack', () => {
  it('penalizes disliked tracks', () => {
    recordFeedback({ signal: 'dislike', track: { id: '1', title: 'Y', artist: 'Bad', source: 'netease' } });
    const low = scoreTrack({ title: 'Y', artist: 'Bad', source: 'netease' });
    const high = scoreTrack({ title: 'Z', artist: 'Good', source: 'netease' });
    expect(low).toBeLessThan(high);
  });
});
