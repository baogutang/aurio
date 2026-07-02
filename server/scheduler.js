// Rhythm scheduling — wakes the DJ at set times. Cron expressions use the host
// machine's local timezone.
import cron from 'node-cron';
import { runSegment } from './dj.js';
import { hasActiveSession, currentIndex } from './radio.js';

const jobs = [];
const RUN_WITHOUT_LISTENER = String(process.env.AURIO_SCHEDULE_WITHOUT_LISTENER || '').toLowerCase() === 'true';

function segmentMode(kind) {
  const active = hasActiveSession();
  const idx = currentIndex();
  if (kind === 'mood') {
    if (active && idx >= 0) return 'steer';
    return active ? 'append' : 'replace';
  }
  return active ? 'append' : 'replace';
}

function runIfActive(kind) {
  if (!RUN_WITHOUT_LISTENER && !hasActiveSession()) {
    console.log('[scheduler] skipped', kind, '(no active listener)');
    return;
  }
  const mode = segmentMode(kind);
  runSegment({ kind }, { mode, currentIndex: currentIndex() })
    .catch((e) => console.error('[scheduler]', kind, e.message));
}

export function startScheduler() {
  jobs.push(cron.schedule('0 7 * * *', () => runIfActive('plan')));
  jobs.push(cron.schedule('0 9 * * *', () => runIfActive('morning')));
  jobs.push(cron.schedule('0 10-23 * * *', () => runIfActive('mood')));
  console.log('[scheduler] started:', jobs.length, 'jobs');
}

export function stopScheduler() {
  for (const j of jobs) j.stop();
  jobs.length = 0;
}
