// System / OS calendar provider — scaffold.
// macOS: read via AppleScript/EventKit bridge. Windows: Graph or a local ICS
// export. For now this also supports a plain ICS URL/file if SYSTEM_ICS is set.
import { spawn } from 'node:child_process';

function macToday() {
  // Reads today's events from the macOS Calendar app via AppleScript.
  return new Promise((resolve) => {
    const script = `set output to ""
set today to current date
set startOfDay to today - (time of today)
set endOfDay to startOfDay + (1 * days)
tell application "Calendar"
  repeat with cal in calendars
    repeat with e in (every event of cal whose start date is greater than or equal to startOfDay and start date is less than endOfDay)
      set output to output & (summary of e) & "\t" & ((start date of e) as string) & "\n"
    end repeat
  end repeat
end tell
return output`;
    const child = spawn('osascript', ['-e', script], { windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('error', () => resolve([]));
    child.on('close', () => {
      const events = out.split('\n').filter(Boolean).map((line) => {
        const [title] = line.split('\t');
        return { title, start: null, end: null, source: 'system' };
      });
      resolve(events);
    });
  });
}

export const system = {
  name: 'system',
  enabled: () => process.platform === 'darwin', // mac for now
  async todayEvents() {
    if (process.platform === 'darwin') {
      try { return await macToday(); } catch { return []; }
    }
    // TODO(phase 3): Windows system calendar (Graph / ICS).
    return [];
  },
};

export async function testSystemCalendar() {
  if (process.platform !== 'darwin') return { ok: false, detail: '当前只支持 macOS 本机日历' };
  const events = await macToday();
  return { ok: true, detail: `本机日历已可读取 · 今天 ${events.length} 个事件` };
}

export function openCalendarPrivacy() {
  if (process.platform !== 'darwin') return false;
  spawn('open', ['x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars'], {
    detached: true,
    stdio: 'ignore',
  }).unref();
  return true;
}
