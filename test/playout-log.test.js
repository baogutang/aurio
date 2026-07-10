import { describe, it, expect } from 'vitest';
import { createProgrammeLog, normalizeItem, CROSSFADE_MS, startOf, advanceOf, audibleEndOf } from '../server/playout/log.js';

// 10-second songs keep the arithmetic legible: default seguePoint 8000, so
// each item advances the timeline by 8s and overlaps the next for 2s.
const song = (id, extra = {}) => ({
  id,
  type: 'song',
  duration: 10000,
  track: { source: 'netease', id: String(id), title: `Song ${id}`, artist: 'Artist' },
  ...extra,
});

describe('normalizeItem', () => {
  it('fills the audit defaults: cueIn 0, cueOut=duration, segue=duration-crossfade, fade end', () => {
    const it_ = normalizeItem({ duration: 180000 });
    expect(it_.cueIn).toBe(0);
    expect(it_.cueOut).toBe(180000);
    expect(it_.seguePoint).toBe(180000 - CROSSFADE_MS);
    expect(it_.endType).toBe('fade');
    expect(it_.startType).toBe('cold');
    expect(it_.type).toBe('song');
    expect(it_.id).toBeTruthy();
  });

  it('cold endings hard-cut at cueOut: seguePoint defaults to cueOut, no overlap', () => {
    const it_ = normalizeItem({ duration: 10000, endType: 'cold' });
    expect(it_.seguePoint).toBe(10000);
    expect(advanceOf(it_)).toBe(10000);
  });

  it('clamps cue metadata into the media span', () => {
    const it_ = normalizeItem({ duration: 10000, cueIn: -5, cueOut: 99999, seguePoint: 40000 });
    expect(it_.cueIn).toBe(0);
    expect(it_.cueOut).toBe(10000);
    expect(it_.seguePoint).toBe(10000);
  });

  it('rejects garbage: missing duration, unknown type', () => {
    expect(() => normalizeItem({})).toThrow(/duration/);
    expect(() => normalizeItem({ duration: 0 })).toThrow(/duration/);
    expect(() => normalizeItem({ duration: 1000, type: 'advert' })).toThrow(/type/);
  });
});

describe('scheduledStart arithmetic', () => {
  it('chains via the segue formula: start[n] = start[n-1] + (segue[n-1] - cueIn[n-1])', () => {
    const log = createProgrammeLog();
    log.append(song('a'), { at: 1000 });
    log.append(song('b', { cueIn: 3000, seguePoint: 7000 }));
    log.append(song('c'));
    const [a, b, c] = log.items();
    expect(a.scheduledStart).toBe(1000);
    expect(b.scheduledStart).toBe(1000 + 8000);           // a: segue 8000 - cueIn 0
    expect(c.scheduledStart).toBe(9000 + (7000 - 3000));  // b: segue 7000 - cueIn 3000
  });

  it('airStart overrides scheduledStart as the chain base once an item airs', () => {
    const log = createProgrammeLog();
    log.append(song('a'), { at: 1000 });
    log.append(song('b'));
    log.markAired('a', 5000);
    expect(log.get('b').scheduledStart).toBe(5000 + 8000);
  });

  it('appending onto a live tail uses the chain even when `at` (now) is earlier', () => {
    const log = createProgrammeLog();
    log.append(song('a'), { at: 1000 });
    const b = log.append(song('b'), { at: 2000 }); // a is mid-air at 2000
    expect(b.scheduledStart).toBe(9000);
    expect(b.pinned).toBe(false);
  });

  it('appending after dead air pins the item at `at`, not a stale chain point', () => {
    const log = createProgrammeLog();
    log.append(song('a'), { at: 0 }); // audible end 10000
    const b = log.append(song('b'), { at: 50000 });
    expect(b.scheduledStart).toBe(50000);
    expect(b.pinned).toBe(true);
    // A later retime must not snap the pinned item back onto the stale chain.
    log.retime();
    expect(log.get('b').scheduledStart).toBe(50000);
    // …and the chain continues from the pin.
    log.append(song('c'));
    expect(log.get('c').scheduledStart).toBe(58000);
  });

  it('empty log needs an anchor: `at`, or an explicit scheduledStart', () => {
    expect(() => createProgrammeLog().append(song('a'))).toThrow(/anchor/);
    const log = createProgrammeLog();
    log.append(song('a', { scheduledStart: 7000 }));
    expect(log.get('a').scheduledStart).toBe(7000);
  });

  it('rejects duplicate ids', () => {
    const log = createProgrammeLog();
    log.append(song('a'), { at: 0 });
    expect(() => log.append(song('a'))).toThrow(/duplicate/);
  });
});

describe('retiming after mid-log edits', () => {
  function threeSongs() {
    const log = createProgrammeLog();
    log.append(song('a'), { at: 0 });
    log.append(song('b'));
    log.append(song('c'));
    return log; // starts: a 0, b 8000, c 16000
  }

  it('insertAfter shifts everything downstream by the inserted advance', () => {
    const log = threeSongs();
    log.insertAfter('a', song('x'));
    expect(log.items().map((i) => i.id)).toEqual(['a', 'x', 'b', 'c']);
    expect(log.get('x').scheduledStart).toBe(8000);
    expect(log.get('b').scheduledStart).toBe(16000);
    expect(log.get('c').scheduledStart).toBe(24000);
  });

  it('insert next while the head is on air chains off its airStart', () => {
    const log = threeSongs();
    log.markAired('a', 500); // aired half a second late
    log.insertAfter('a', song('x'));
    expect(log.get('x').scheduledStart).toBe(500 + 8000);
    expect(log.get('b').scheduledStart).toBe(8500 + 8000);
  });

  it('refuses to insert into aired history', () => {
    const log = threeSongs();
    log.markAired('a', 0);
    log.markAired('b', 8000);
    expect(() => log.insertAfter('a', song('x'))).toThrow(/aired history/);
  });

  it('remove closes the gap and retimes downstream', () => {
    const log = threeSongs();
    log.remove('b');
    expect(log.items().map((i) => i.id)).toEqual(['a', 'c']);
    expect(log.get('c').scheduledStart).toBe(8000);
  });

  it('refuses to remove the on-air or aired item', () => {
    const log = threeSongs();
    log.markAired('a', 0);
    expect(() => log.remove('a')).toThrow(/aired/);
    expect(() => log.remove('nope')).toThrow(/no such/);
  });

  it('update to timing fields retimes downstream; derived fields are not patchable', () => {
    const log = threeSongs();
    log.update('a', { seguePoint: 5000, scheduledStart: 99999, airStart: 12345 });
    const a = log.get('a');
    expect(a.seguePoint).toBe(5000);
    expect(a.scheduledStart).toBe(0);   // stripped from the patch
    expect(a.airStart).toBeNull();      // stripped from the patch
    expect(log.get('b').scheduledStart).toBe(5000);
    expect(log.get('c').scheduledStart).toBe(13000);
  });

  it('update can attach a late-arriving voice track without touching the schedule', () => {
    const log = threeSongs();
    log.update('b', { voice: { text: '前面这首……', ttsUrl: '/tts/abc.mp3', ttsDuration: 4200 } });
    expect(log.get('b').voice.ttsUrl).toBe('/tts/abc.mp3');
    expect(log.get('c').scheduledStart).toBe(16000);
  });
});

describe('snapshotAt', () => {
  function twoSongs() {
    const log = createProgrammeLog();
    log.append(song('a'), { at: 0 });  // audible [0, 10000), segue at 8000
    log.append(song('b'));             // audible [8000, 18000)
    return log;
  }

  it('mid-item: current + media offset (cueIn + elapsed)', () => {
    const log = createProgrammeLog();
    log.append(song('a', { cueIn: 2000 }), { at: 1000 });
    const snap = log.snapshotAt(4000);
    expect(snap.current.id).toBe('a');
    expect(snap.offsetMs).toBe(2000 + 3000);
    expect(snap.ending).toBeNull();
  });

  it('at the exact boundary the incoming item is current (start-inclusive)', () => {
    const snap = twoSongs().snapshotAt(8000);
    expect(snap.current.id).toBe('b');
    expect(snap.offsetMs).toBe(0);
    expect(snap.ending.id).toBe('a');
    expect(snap.ending.offsetMs).toBe(8000);
  });

  it('inside the crossfade window both items are reported', () => {
    const snap = twoSongs().snapshotAt(9000);
    expect(snap.current.id).toBe('b');
    expect(snap.offsetMs).toBe(1000);
    expect(snap.ending.id).toBe('a');
    expect(snap.ending.offsetMs).toBe(9000);
  });

  it('once the outgoing tail falls silent, ending is null', () => {
    const snap = twoSongs().snapshotAt(10000);
    expect(snap.current.id).toBe('b');
    expect(snap.ending).toBeNull();
  });

  it('before the show: no current, the schedule is upNext', () => {
    const log = createProgrammeLog();
    log.append(song('a'), { at: 5000 });
    log.append(song('b'));
    const snap = log.snapshotAt(1000);
    expect(snap.current).toBeNull();
    expect(snap.offsetMs).toBe(0);
    expect(snap.upNext.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('after the show: dead air, nothing upNext', () => {
    const snap = twoSongs().snapshotAt(99999);
    expect(snap.current).toBeNull();
    expect(snap.upNext).toEqual([]);
  });

  it('empty log snapshots cleanly', () => {
    expect(createProgrammeLog().snapshotAt(0)).toEqual({ current: null, offsetMs: 0, ending: null, upNext: [] });
  });

  it('upNext is capped and ordered', () => {
    const log = createProgrammeLog();
    for (let i = 0; i < 6; i++) log.append(song(`s${i}`), { at: 0 });
    const snap = log.snapshotAt(1000, { upNext: 3 });
    expect(snap.current.id).toBe('s0');
    expect(snap.upNext.map((i) => i.id)).toEqual(['s1', 's2', 's3']);
  });

  it('single-item log: current mid-item, empty upNext', () => {
    const log = createProgrammeLog();
    log.append(song('only'), { at: 0 });
    const snap = log.snapshotAt(3000);
    expect(snap.current.id).toBe('only');
    expect(snap.upNext).toEqual([]);
  });
});

describe('horizon inspection', () => {
  it('reports scheduled airtime remaining after t', () => {
    const log = createProgrammeLog();
    log.append(song('a'), { at: 0 });
    log.append(song('b')); // last audible end 18000
    expect(log.horizonRemaining(0)).toBe(18000);
    expect(log.horizonRemaining(12000)).toBe(6000);
    expect(log.horizonRemaining(20000)).toBe(0);
    expect(createProgrammeLog().horizonRemaining(0)).toBe(0);
  });
});

describe('persistence seam', () => {
  it('saves a plain object after every mutation and restores identically', () => {
    let saved = null;
    const store = { load: () => null, save: (data) => { saved = data; } };
    const log = createProgrammeLog({ store });
    log.append(song('a'), { at: 0 });
    log.append(song('b', { cueIn: 1000, seguePoint: 6000 }));
    log.markAired('a', 250);
    expect(saved).not.toBeNull();

    // Full JSON round-trip — what any store will actually do to it.
    const revived = createProgrammeLog({ data: JSON.parse(JSON.stringify(saved)) });
    expect(revived.items()).toEqual(log.items());
    expect(revived.snapshotAt(9000)).toEqual(log.snapshotAt(9000));
    expect(revived.get('a').airStart).toBe(250);
  });

  it('hydrates from store.load() at creation', () => {
    const log1 = createProgrammeLog();
    log1.append(song('a'), { at: 0 });
    const store = { load: () => log1.toJSON() };
    const log2 = createProgrammeLog({ store });
    expect(log2.items()).toEqual(log1.items());
  });

  it('helpers agree with the stored shape', () => {
    const log = createProgrammeLog();
    const a = log.append(song('a'), { at: 100 });
    expect(startOf(a)).toBe(100);
    expect(advanceOf(a)).toBe(8000);
    expect(audibleEndOf(a)).toBe(10100);
  });
});
