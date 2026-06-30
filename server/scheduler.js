// Rhythm scheduling — wakes the DJ at set times. Cron expressions use the host
// machine's local timezone.
import cron from 'node-cron';
import { run } from './dj.js';
import { hasActiveSession } from './radio.js';

const jobs = [];
const RUN_WITHOUT_LISTENER = String(process.env.AURIO_SCHEDULE_WITHOUT_LISTENER || '').toLowerCase() === 'true';

function runIfActive(kind) {
  if (!RUN_WITHOUT_LISTENER && !hasActiveSession()) {
    console.log('[scheduler] skipped', kind, '(no active listener)');
    return;
  }
  run({ kind }).catch((e) => console.error('[scheduler]', kind, e.message));
}

export function startScheduler() {
  // 07:00 — plan the day's show direction.
  jobs.push(cron.schedule('0 7 * * *', () => runIfActive('plan')));
  // 09:00 — morning open.
  jobs.push(cron.schedule('0 9 * * *', () => runIfActive('morning')));
  // Hourly between 10:00–23:00 — mood check / micro-adjust.
  jobs.push(cron.schedule('0 10-23 * * *', () => runIfActive('mood')));

  console.log('[scheduler] started:', jobs.length, 'jobs');
}

export function stopScheduler() {
  for (const j of jobs) j.stop();
  jobs.length = 0;
}
