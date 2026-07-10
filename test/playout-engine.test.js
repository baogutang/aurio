import { describe, it, expect, beforeEach } from 'vitest';
import { createProgrammeLog } from '../server/playout/log.js';
import { createPlayout } from '../server/playout/playout.js';

// ---------------------------------------------------------------------------
// Fake-clock fixture — the audit's non-negotiable prerequisite («半迁移比现状
// 更糟»): a controllable wall clock + timer harness that advances the timeline
// deterministically. Two ways time can pass:
//   tick(ms)  — healthy real time: due timers fire in order AT their due time.
//   sleep(ms) — laptop-lid suspend: the wall clock jumps, timers stay frozen;
//   wake()    — pending overdue timers fire late, at the jumped-to time.
// ---------------------------------------------------------------------------
function makeClock(start = 0) {
  let t = start;
  let seq = 0;
  const timers = new Map();
  const nextDue = (limit) => [...timers.entries()]
    .filter(([, tm]) => tm.at <= limit)
    .sort((x, y) => x[1].at - y[1].at || x[0] - y[0])[0];
  return {
    now: () => t,
    setTimer: (fn, ms) => { const id = ++seq; timers.set(id, { at: t + ms, fn }); return id; },
    clearTimer: (id) => { timers.delete(id); },
    tick(ms) {
      const end = t + ms;
      for (;;) {
        const due = nextDue(end);
        if (!due) break;
        const [id, tm] = due;
        timers.delete(id);
        t = Math.max(t, tm.at);
        tm.fn();
      }
      t = end;
    },
    sleep(ms) { t += ms; },
    wake() {
      for (;;) {
        const due = nextDue(t);
        if (!due) break;
        const [id, tm] = due;
        timers.delete(id);
        tm.fn();
      }
    },
    pendingTimers: () => timers.size,
  };
}

// 10-second songs: default segue at 8000, audible end at 10000. Appended at
// t=0 the timeline is a[0..10000) b[8000..18000) c[16000..26000) …
const song = (id, extra = {}) => ({
  id,
  type: 'song',
  duration: 10000,
  track: { source: 'netease', id: String(id), title: `Song ${id}`, artist: 'Artist' },
  ...extra,
});

function record(playout) {
  const events = [];
  for (const name of ['item-start', 'item-end', 'jumped', 'horizon-low']) {
    playout.on(name, (payload) => events.push({ name, payload }));
  }
  return events;
}

function rig({ horizonMs = 1, onHorizonLow = null, start = 0 } = {}) {
  const clock = makeClock(start);
  const log = createProgrammeLog();
  const playout = createPlayout({
    log,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    horizonMs,
    onHorizonLow,
  });
  return { clock, log, playout, events: record(playout) };
}

describe('playout: real-time advancement', () => {
  let r;
  beforeEach(() => { r = rig(); });

  it('walks item boundaries at the segue points, one start/end pair each', () => {
    r.playout.start();
    r.playout.append(song('a'));
    r.playout.append(song('b'));
    r.playout.append(song('c'));
    expect(r.events.map((e) => e.name)).toEqual(['horizon-low', 'item-start']); // empty-log check + a starts at once
    expect(r.playout.current().id).toBe('a');

    r.clock.tick(8000); // a→b segue
    expect(r.playout.current().id).toBe('b');
    r.clock.tick(8000); // b→c segue
    expect(r.playout.current().id).toBe('c');
    r.clock.tick(10000); // c's audible end at 26000 — dead air begins
    expect(r.playout.current()).toBeNull();

    expect(r.events.map((e) => e.name)).toEqual([
      'horizon-low', 'item-start',            // start on empty log, then a airs
      'item-end', 'item-start',               // a → b at the segue
      'item-end', 'item-start',               // b → c at the segue
      'item-end', 'horizon-low',              // c ends into dead air, horizon dry again
    ]);
    const transitions = r.events.filter((e) => e.name === 'item-start').map((e) => e.payload.id);
    expect(transitions).toEqual(['a', 'b', 'c']);
    const ends = r.events.filter((e) => e.name === 'item-end').map((e) => e.payload.id);
    expect(ends).toEqual(['a', 'b', 'c']);
    expect(r.events.filter((e) => e.name === 'jumped')).toHaveLength(0);
  });

  it('stamps airStart = scheduledStart when an item goes to air', () => {
    r.playout.start();
    r.playout.append(song('a'));
    r.playout.append(song('b'));
    r.clock.tick(8000);
    expect(r.log.get('a').airStart).toBe(0);
    expect(r.log.get('b').airStart).toBe(8000);
  });

  it('stop() freezes the engine: no events, no cursor movement', () => {
    r.playout.start();
    r.playout.append(song('a'));
    r.playout.append(song('b'));
    r.playout.stop();
    const before = r.events.length;
    r.clock.tick(60000);
    expect(r.events.length).toBe(before);
    expect(r.playout.isRunning()).toBe(false);
  });
});

describe('playout: suspend/resume fast-forward', () => {
  it('jumps over 3 items with a single jumped event, cursor lands mid-song', () => {
    const r = rig();
    r.playout.start();
    for (const id of ['a', 'b', 'c', 'd', 'e']) r.playout.append(song(id));
    r.clock.tick(1000); // cursor on a, timer armed for the 8000 segue
    const before = r.events.length;

    r.clock.sleep(34000); // lid closes at t=1000, opens at t=35000
    r.clock.wake();       // the 8000 timer fires 27s late

    const after = r.events.slice(before);
    expect(after.map((e) => e.name)).toEqual(['jumped']);
    const jump = after[0].payload;
    expect(jump.from.id).toBe('a');
    expect(jump.to.id).toBe('e');                                // e is audible [32000, 42000)
    expect(jump.skipped.map((i) => i.id)).toEqual(['b', 'c', 'd']);
    expect(jump.offsetMs).toBe(3000);
    expect(jump.at).toBe(35000);
    expect(r.playout.current().id).toBe('e');

    // History says the station never stopped: the skipped items aired on time.
    for (const id of ['b', 'c', 'd']) {
      expect(r.log.get(id).airStart).toBe(r.log.get(id).scheduledStart);
    }

    // join() lands the listener exactly where the wall clock says.
    const j = r.playout.join();
    expect(j.serverNow).toBe(35000);
    expect(j.current.id).toBe('e');
    expect(j.offsetMs).toBe(3000);

    // …and normal advancement resumes: e's audible end at 42000.
    r.clock.tick(7000);
    expect(r.playout.current()).toBeNull();
    expect(r.events.at(-1).name === 'item-end' || r.events.at(-1).name === 'horizon-low').toBe(true);
    expect(r.events.filter((e) => e.name === 'item-end').map((e) => e.payload.id)).toEqual(['e']);
  });

  it('a jump past the end of the log lands on dead air, still one event', () => {
    const r = rig();
    r.playout.start();
    r.playout.append(song('a'));
    r.playout.append(song('b'));
    r.clock.tick(1000);
    const before = r.events.length;

    r.clock.sleep(3600000); // one hour
    r.clock.wake();

    const jumps = r.events.slice(before).filter((e) => e.name === 'jumped');
    expect(jumps).toHaveLength(1);
    expect(jumps[0].payload.from.id).toBe('a');
    expect(jumps[0].payload.to).toBeNull();
    expect(jumps[0].payload.skipped.map((i) => i.id)).toEqual(['b']);
    expect(r.playout.current()).toBeNull();
    expect(r.events.slice(before).filter((e) => e.name === 'item-start')).toHaveLength(0);
  });

  it('wake() is callable directly (the powerMonitor seam), no timer needed', () => {
    const r = rig();
    r.playout.start();
    for (const id of ['a', 'b', 'c']) r.playout.append(song(id));
    r.clock.tick(500);
    r.clock.sleep(18500); // t=19000 → b already over, c audible [16000, 26000)
    const before = r.events.length;
    r.playout.wake();
    const after = r.events.slice(before);
    expect(after.map((e) => e.name)).toEqual(['jumped']);
    expect(after[0].payload.to.id).toBe('c');
    expect(after[0].payload.skipped.map((i) => i.id)).toEqual(['b']);
  });

  it('a late resume landing on the immediate next item is a normal transition, not a jump', () => {
    const r = rig();
    r.playout.start();
    for (const id of ['a', 'b', 'c']) r.playout.append(song(id));
    r.clock.tick(500);
    r.clock.sleep(9000); // t=9500 → b audible [8000, 18000): one step forward
    const before = r.events.length;
    r.clock.wake();
    const after = r.events.slice(before);
    expect(after.map((e) => e.name)).toEqual(['item-end', 'item-start']);
    expect(after[1].payload.id).toBe('b');
    expect(r.playout.join().offsetMs).toBe(1500);
  });
});

describe('playout: horizon-low', () => {
  it('fires once when scheduled airtime runs low, re-arms after append', () => {
    const calls = [];
    const r = rig({ horizonMs: 15000, onHorizonLow: (info) => calls.push(info) });
    r.playout.start(); // empty log → immediately low (remaining 0)
    expect(calls).toHaveLength(1);
    expect(calls[0].remainingMs).toBe(0);

    // Append 3 songs: last audible end 26000, remaining 26000 ≥ 15000 → re-armed.
    for (const id of ['a', 'b', 'c']) r.playout.append(song(id));
    expect(calls).toHaveLength(1);

    // The threshold crossing is at 26000-15000 → fires just past 11000, once.
    r.clock.tick(12000);
    expect(calls).toHaveLength(2);
    expect(calls[1].remainingMs).toBeLessThan(15000);
    r.clock.tick(3000); // more syncs happen (b→c boundary at 16000 not yet) — no re-fire
    expect(calls).toHaveLength(2);

    // Append lifts the horizon → latch re-arms → a later dip fires again.
    r.playout.append(song('d')); // end 34000, remaining at 15000 = 19000
    r.clock.tick(10000);         // crossing at 19001
    expect(calls).toHaveLength(3);

    // The emitter event mirrors the callback seam.
    expect(r.events.filter((e) => e.name === 'horizon-low')).toHaveLength(3);
  });
});

describe('playout: join()', () => {
  it('during a crossfade returns the incoming item plus the audible outgoing tail', () => {
    const r = rig();
    r.playout.start();
    r.playout.append(song('a'));
    r.playout.append(song('b'));
    r.playout.append(song('c'));
    r.clock.tick(9000); // inside the a→b crossfade [8000, 10000)
    const j = r.playout.join();
    expect(j.serverNow).toBe(9000);
    expect(j.current.id).toBe('b');
    expect(j.offsetMs).toBe(1000);
    expect(j.ending.id).toBe('a');
    expect(j.ending.offsetMs).toBe(9000);
    expect(j.upNext.map((i) => i.id)).toEqual(['c']);
  });

  it('respects the upNext cap', () => {
    const r = rig();
    r.playout.start();
    for (let i = 0; i < 8; i++) r.playout.append(song(`s${i}`));
    r.clock.tick(1000);
    expect(r.playout.join({ upNext: 2 }).upNext.map((i) => i.id)).toEqual(['s1', 's2']);
  });

  it('on an empty log reports honest dead air', () => {
    const r = rig();
    r.playout.start();
    const j = r.playout.join();
    expect(j.current).toBeNull();
    expect(j.upNext).toEqual([]);
  });
});

describe('playout: edits re-arm the timeline', () => {
  it('insertNext places after the on-air item and shifts the rest', () => {
    const r = rig();
    r.playout.start();
    for (const id of ['a', 'b', 'c']) r.playout.append(song(id));
    r.clock.tick(1000);
    r.playout.insertNext(song('x'));
    expect(r.playout.join().upNext.map((i) => i.id)).toEqual(['x', 'b', 'c']);
    expect(r.log.get('x').scheduledStart).toBe(8000);
    expect(r.log.get('b').scheduledStart).toBe(16000);
    r.clock.tick(7000); // t=8000: the segue goes to x, not b
    expect(r.playout.current().id).toBe('x');
  });

  it('remove closes the gap and the next boundary honours the retime', () => {
    const r = rig();
    r.playout.start();
    for (const id of ['a', 'b', 'c']) r.playout.append(song(id));
    r.clock.tick(1000);
    r.playout.remove('b');
    expect(r.log.get('c').scheduledStart).toBe(8000);
    r.clock.tick(7000);
    expect(r.playout.current().id).toBe('c');
  });

  it('refuses to remove the on-air item', () => {
    const r = rig();
    r.playout.start();
    r.playout.append(song('a'));
    expect(() => r.playout.remove('a')).toThrow(/aired/);
  });

  it('append during dead air restarts the station now, not at a stale chain point', () => {
    const r = rig();
    r.playout.start();
    r.playout.append(song('a'));
    r.clock.tick(20000); // a ended at 10000; dead air since
    expect(r.playout.current()).toBeNull();
    r.playout.append(song('f'));
    expect(r.log.get('f').scheduledStart).toBe(20000);
    expect(r.playout.current().id).toBe('f'); // starts immediately
    expect(r.playout.join().offsetMs).toBe(0);
  });

  it('update reschedules downstream and the armed timer follows', () => {
    const r = rig();
    r.playout.start();
    r.playout.append(song('a'));
    r.playout.append(song('b'));
    r.clock.tick(1000);
    r.playout.update('a', { seguePoint: 4000 }); // a now segues at 4000
    expect(r.log.get('b').scheduledStart).toBe(4000);
    r.clock.tick(3000); // t=4000
    expect(r.playout.current().id).toBe('b');
  });
});

describe('playout: single-item and restart edges', () => {
  it('a single item plays out and ends into dead air', () => {
    const r = rig();
    r.playout.start();
    r.playout.append(song('only'));
    r.clock.tick(10000);
    expect(r.playout.current()).toBeNull();
    expect(r.events.filter((e) => e.name === 'item-end').map((e) => e.payload.id)).toEqual(['only']);
  });

  it('restoring a mid-show log and starting later fast-forwards with one jumped', () => {
    // Session 1: build a log, persist through the store seam.
    let saved = null;
    const store = { load: () => null, save: (d) => { saved = d; } };
    const log1 = createProgrammeLog({ store });
    log1.append(song('a'), { at: 0 });
    log1.append(song('b'));
    log1.append(song('c'));
    log1.markAired('a', 0);

    // Session 2: process restarts at t=20000 — c is audible [16000, 26000).
    const clock = makeClock(20000);
    const log2 = createProgrammeLog({ data: JSON.parse(JSON.stringify(saved)) });
    const playout = createPlayout({
      log: log2, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer,
    });
    const events = record(playout);
    playout.start();
    // One jump — and the engine immediately notices the horizon is nearly
    // dry (6s left vs the default threshold), which is exactly what should
    // trigger composition on wake.
    expect(events.map((e) => e.name)).toEqual(['jumped', 'horizon-low']);
    expect(events[0].payload.from).toBeNull();
    expect(events[0].payload.to.id).toBe('c');
    // skipped = everything between the (fresh) cursor and the landing item —
    // including items that aired before the restart; from/to carry the story.
    expect(events[0].payload.skipped.map((i) => i.id)).toEqual(['a', 'b']);
    expect(playout.current().id).toBe('c');
    expect(playout.join().offsetMs).toBe(4000);
    expect(log2.get('b').airStart).toBe(8000); // b aired while the process was down
  });
});
