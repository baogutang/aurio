// Rhythm scheduling — wakes the DJ at set times. Cron expressions use the host
// machine's local timezone.
import cron from 'node-cron';
import { run } from './dj.js';

const jobs = [];

export function startScheduler() {
  // 07:00 — plan the day's show direction.
  jobs.push(cron.schedule('0 7 * * *', () => run({ kind: 'plan' })));
  // 09:00 — morning open.
  jobs.push(cron.schedule('0 9 * * *', () => run({ kind: 'morning' })));
  // Hourly between 10:00–23:00 — mood check / micro-adjust.
  jobs.push(cron.schedule('0 10-23 * * *', () => run({ kind: 'mood' })));

  console.log('[scheduler] started:', jobs.length, 'jobs');
}

export function stopScheduler() {
  for (const j of jobs) j.stop();
  jobs.length = 0;
}
