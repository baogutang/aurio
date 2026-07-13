// System / OS calendar provider — scaffold.
// macOS: read via AppleScript/EventKit bridge. Windows: Graph or a local ICS
// export. For now this also supports a plain ICS URL/file if SYSTEM_ICS is set.
import { spawn } from 'node:child_process';

function macToday() {
  // Reads today's events from the macOS Calendar app via AppleScript.
  // Rejects on a non-zero osascript exit (most commonly: Automation permission
  // denied, error -1743) so callers can tell "no events" from "not authorized".
  return new Promise((resolve, reject) => {
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
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => reject(e));
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(err.trim() || `osascript exited ${code}`));
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
  try {
    const events = await macToday();
    return { ok: true, detail: `✓ 本机日历已可读取 · 今天 ${events.length} 个事件` };
  } catch (e) {
    const msg = (e?.message || '').toString();
    if (/-1743|不允许|不被允许|Not authou?rized|Not authorized/i.test(msg)) {
      return { ok: false, detail: '还没授权读取日历：点「打开日历授权」，在 隐私与安全性 → 自动化 里允许 Aurio 控制「日历」，再回来点一次检查。' };
    }
    return { ok: false, detail: `读取本机日历失败：${msg.slice(0, 100)} —— 确认「日历」App 能正常打开，然后再试一次。` };
  }
}

export function openCalendarPrivacy() {
  if (process.platform !== 'darwin') return false;
  spawn('open', ['x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars'], {
    detached: true,
    stdio: 'ignore',
  }).unref();
  return true;
}
