// Rhythm scheduling — wakes the DJ at set times. Cron expressions use the host
// machine's local timezone.
//
// The rhythm follows the programme schedule (user/shows.json → server/shows.js):
//
//   · 07:00 plan     — unchanged: sketches the day's mood note.
//   · show starts    — one 'show-open' beat per show boundary: a single spoken
//                      opening in the incoming show's tone. Delivered in 'chat'
//                      mode — a spoken line and NOTHING else — because every
//                      queue-touching alternative is destructive or mute:
//                      'steer' truncates a user-curated Up Next (the audit's
//                      steerAndAppend complaint), 'insert' shoves tracks ahead
//                      of the listener's picks, and 'append' never airs its
//                      say. The new show's music direction follows organically:
//                      every refill now reads the show block in the prompt.
//   · Friday 21:05   — the weekly recap ritual inside 《深夜航班》: a
//                      deterministic fact from play history (server/rituals.js),
//                      silently skipped when there is nothing to count.
//   · hourly ID      — imaging's zero-LLM time call (unchanged).
//
// The old hourly 'mood' cron is gone, absorbed by the schedule: the show block
// gives every segment its daypart direction continuously, the talk budget
// (shows.js) decides who may speak, and imaging already marks the hour. An LLM
// call every hour to "check the mood" bought nothing but queue truncation.
import cron from 'node-cron';
import { runSegment } from './dj.js';
import { hasActiveSession, currentIndex } from './radio.js';
import { hourlyStationId } from './imaging.js';
import { listShows, currentShow } from './shows.js';
import { weeklyRecapFact } from './rituals.js';

const jobs = [];
const RUN_WITHOUT_LISTENER = String(process.env.AURIO_SCHEDULE_WITHOUT_LISTENER || '').toLowerCase() === 'true';

function gate(kind) {
  if (!RUN_WITHOUT_LISTENER && !hasActiveSession()) {
    console.log('[scheduler] skipped', kind, '(no active listener)');
    return false;
  }
  return true;
}

function runPlan() {
  if (!gate('plan')) return;
  const mode = hasActiveSession() ? 'append' : 'replace';
  runSegment({ kind: 'plan' }, { mode, currentIndex: currentIndex() })
    .catch((e) => console.error('[scheduler] plan', e.message));
}

// One spoken opening for the show that just started. The guard re-resolves the
// schedule: with overlapping shows, first-match-wins may hand this slot to an
// earlier show, in which case the loser's cron stays quiet.
export function openShow(name, now = new Date()) {
  if (currentShow(now).name !== name) return null;
  return runSegment({ kind: 'show-open' }, { mode: 'chat', currentIndex: currentIndex() })
    .catch((e) => console.error('[scheduler] show-open', e.message));
}

// The Friday-night recap:「本周你听得最多的是……」. Empty history → no segment
// at all; a ritual with nothing to say does not exist that week.
export function fridayRecap() {
  const fact = weeklyRecapFact();
  if (!fact) return null;
  return runSegment({ kind: 'recap', fact }, { mode: 'chat', currentIndex: currentIndex() })
    .catch((e) => console.error('[scheduler] recap', e.message));
}

// ISO weekday (Mon=1 … Sun=7) → cron dow (Sun=0 … Sat=6).
const isoToCronDow = (d) => d % 7;

/** Show-boundary cron expressions derived from the schedule. */
export function showOpenCrons(shows = listShows()) {
  return shows
    .filter((s) => !s.isDefault)
    .map((s) => ({
      name: s.name,
      expr: `${s.startMin % 60} ${Math.floor(s.startMin / 60)} * * ${s.days ? s.days.map(isoToCronDow).join(',') : '*'}`,
    }));
}

export function startScheduler() {
  jobs.push(cron.schedule('0 7 * * *', runPlan));
  for (const c of showOpenCrons()) {
    jobs.push(cron.schedule(c.expr, () => {
      if (gate(`show-open:${c.name}`)) openShow(c.name);
    }));
  }
  jobs.push(cron.schedule('5 21 * * 5', () => {
    if (gate('recap')) fridayRecap();
  }));
  // Hourly station ID (整点台呼) — deterministic template + cached TTS, zero LLM.
  // Gating (imaging enabled + active listener) lives inside hourlyStationId.
  jobs.push(cron.schedule('0 * * * *', () => {
    try { hourlyStationId(); } catch (e) { console.error('[scheduler] station-id', e.message); }
  }));
  console.log('[scheduler] started:', jobs.length, 'jobs');
}

export function stopScheduler() {
  for (const j of jobs) j.stop();
  jobs.length = 0;
}
