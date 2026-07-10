// Fake-clock + timer harness shared by the playout cutover tests (the same
// idiom as test/playout-engine.test.js). Two ways time can pass:
//   tick(ms)  — healthy real time: due timers fire in order AT their due time.
//   sleep(ms) — laptop-lid suspend: the wall clock jumps, timers stay frozen;
//   wake()    — pending overdue timers fire late, at the jumped-to time.
export function makeClock(start = 0) {
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

/** In-memory store seam for createProgrammeLog / initStation. */
export function memStore(initial = null) {
  let data = initial;
  return {
    load: () => data,
    save: (d) => { data = d; },
    peek: () => data,
  };
}

/** In-memory prefs seam for initStation (stationStartedAt persistence). */
export function memPrefs(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    get: (k, d = null) => (m.has(k) ? m.get(k) : d),
    set: (k, v) => { m.set(k, v); },
    peek: (k) => m.get(k),
  };
}
