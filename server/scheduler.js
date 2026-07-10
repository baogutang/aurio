// Rhythm scheduling — wakes the DJ at set times. Cron expressions use the host
// machine's local timezone.
//
// The rhythm follows the programme schedule (user/shows.json → server/shows.js):
//
//   · 07:00 plan     — unchanged: sketches the day's mood note.
//   · show starts    — one 'show-open' beat per show boundary, hot-reloaded:
//                      a periodic re-stat of user/shows.json re-derives the
//                      boundary crons when the file changes (syncShowCrons),
//                      so editing the schedule needs no restart. Each opening
//                      is a single spoken line in the incoming show's tone,
//                      delivered in 'chat' mode — that and NOTHING else —
//                      because every queue-touching alternative is destructive
//                      or mute: 'steer' truncates a user-curated Up Next (the
//                      audit's steerAndAppend complaint), 'insert' shoves
//                      tracks ahead of the listener's picks, and 'append'
//                      never airs its say. The new show's music direction
//                      follows organically: every refill now reads the show
//                      block in the prompt.
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
import { listShows, currentShow, showsFileBroken } from './shows.js';
import { weeklyRecapFact } from './rituals.js';

const jobs = [];                 // fixed jobs: plan, recap, hourly ID
const showJobs = new Map();      // "name@expr" → live show-open cron
let reloadTimer = null;
const SHOWS_RELOAD_MS = 30000;   // re-stat cadence for user/shows.json
// Scheduled beats are pure spend (LLM + TTS). The playout cursor advances
// regardless (server/playout); a beat with no listener would talk to an empty
// room and burn tokens, so spend waits for one. The old
// AURIO_SCHEDULE_WITHOUT_LISTENER escape hatch is gone — post-cutover its only
// meaning was "spend with nobody listening".
function gate(kind) {
  if (!hasActiveSession()) {
    console.log('[scheduler] skipped', kind, '(no active listener)');
    return false;
  }
  return true;
}

function runPlan() {
  if (!gate('plan')) return;
  runSegment({ kind: 'plan' }, { mode: 'append', currentIndex: currentIndex() })
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

// Bring the live show-open crons in line with user/shows.json, without a
// restart. Diff by "name@expr": untouched shows keep their jobs, removed or
// re-timed shows have theirs stopped, new boundaries get fresh ones. The
// plan/recap/hourly-ID jobs live in `jobs` and are never touched here.
//
// Change detection is a re-stat, not fs.watch: editors replace files
// atomically (rename swaps the inode, watchers go stale) and packaged
// Electron apps miss rename events on some platforms, while listShows()
// already caches by mtime+size so a no-change pass costs one stat. A
// malformed edit keeps the previous schedule — better a stale boundary than
// none, and openShow()'s first-match guard keeps any stale cron from
// mis-firing. Returns whether anything changed.
export function syncShowCrons() {
  if (showsFileBroken()) return false;
  const desired = new Map(showOpenCrons().map((c) => [`${c.name}@${c.expr}`, c]));
  let changed = false;
  for (const [key, job] of showJobs) {
    if (desired.has(key)) continue;
    job.stop();
    showJobs.delete(key);
    changed = true;
  }
  for (const [key, c] of desired) {
    if (showJobs.has(key)) continue;
    showJobs.set(key, cron.schedule(c.expr, () => {
      if (gate(`show-open:${c.name}`)) openShow(c.name);
    }));
    changed = true;
  }
  if (changed) {
    console.log('[scheduler] show-open crons:', [...showJobs.keys()].join(', ') || '(none)');
  }
  return changed;
}

/** The installed show-open crons as "name@expr" keys (observability/tests). */
export function activeShowCrons() {
  return [...showJobs.keys()];
}

export function startScheduler() {
  jobs.push(cron.schedule('0 7 * * *', runPlan));
  jobs.push(cron.schedule('5 21 * * 5', () => {
    if (gate('recap')) fridayRecap();
  }));
  // Hourly station ID (整点台呼) — deterministic template + cached TTS, zero LLM.
  // Gating (imaging enabled + active listener) lives inside hourlyStationId.
  jobs.push(cron.schedule('0 * * * *', () => {
    try { hourlyStationId(); } catch (e) { console.error('[scheduler] station-id', e.message); }
  }));
  syncShowCrons();
  reloadTimer = setInterval(() => {
    try { syncShowCrons(); } catch (e) { console.error('[scheduler] shows reload', e.message); }
  }, SHOWS_RELOAD_MS);
  if (reloadTimer.unref) reloadTimer.unref(); // never pin the process for a poll
  console.log('[scheduler] started:', jobs.length + showJobs.size, 'jobs');
}

export function stopScheduler() {
  for (const j of jobs) j.stop();
  jobs.length = 0;
  for (const j of showJobs.values()) j.stop();
  showJobs.clear();
  if (reloadTimer) clearInterval(reloadTimer);
  reloadTimer = null;
}
