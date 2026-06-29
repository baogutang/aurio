// 通用 ICS 订阅日历 provider —— 覆盖钉钉 / 企业微信 / Google / Apple / Outlook 等
// 任意可导出「日历订阅(.ics)链接」的日历。在设置里填一个或多个 ICS URL
// （CALENDAR_ICS_URLS，逗号或换行分隔）即可，无需 OAuth、跨平台。
import { config } from '../config.js';
import ical from 'node-ical';

function collectToday(data, start, end) {
  const out = [];
  let total = 0;
  for (const k of Object.keys(data)) {
    const ev = data[k];
    if (!ev || ev.type !== 'VEVENT') continue;
    total++;
    // 普通（非重复）事件落在今天
    if (ev.start && ev.start >= start && ev.start < end) {
      out.push({ title: ev.summary || '(无标题)', start: +ev.start, end: ev.end ? +ev.end : null, source: 'ics' });
    }
    // 重复事件：展开今天的发生
    if (ev.rrule) {
      try {
        for (const d of ev.rrule.between(start, end, true)) {
          out.push({ title: ev.summary || '(无标题)', start: +d, end: null, source: 'ics' });
        }
      } catch { /* skip bad rrule */ }
    }
  }
  return { events: out, total };
}

export const ics = {
  name: 'ics',
  enabled: () => (config.calendars.ics?.urls || []).length > 0 || (config.calendars.ics?.files || []).length > 0,

  async todayEvents() {
    const urls = config.calendars.ics?.urls || [];
    const files = config.calendars.ics?.files || [];
    if (!urls.length && !files.length) return [];
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(start.getTime() + 86400000);
    const out = [];

    for (const url of urls) {
      try {
        const data = await ical.async.fromURL(url);
        out.push(...collectToday(data, start, end).events);
      } catch (e) { console.error('[ics]', url, e.message); }
    }
    for (const file of files) {
      try {
        const data = await ical.async.parseFile(file);
        out.push(...collectToday(data, start, end).events);
      } catch (e) { console.error('[ics file]', file, e.message); }
    }
    return out;
  },
};

// Settings "测试" — fetch candidate ICS link(s) and report counts (no save needed).
export async function testIcs(urls = [], files = []) {
  const list = (Array.isArray(urls) ? urls : String(urls).split(/[\n,]/))
    .map((s) => s.trim()).filter(Boolean);
  const fileList = (Array.isArray(files) ? files : String(files).split(/[\n,]/))
    .map((s) => s.trim()).filter(Boolean);
  if (!list.length && !fileList.length) return { ok: false, detail: '请添加至少一个 ICS 订阅或导入文件' };
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start.getTime() + 86400000);
  let total = 0, today = 0;
  for (const url of list) {
    try {
      const data = await ical.async.fromURL(url);
      const picked = collectToday(data, start, end);
      total += picked.total;
      today += picked.events.length;
    } catch (e) {
      return { ok: false, detail: `订阅失败：${(e.message || '').slice(0, 80)}` };
    }
  }
  for (const file of fileList) {
    try {
      const data = await ical.async.parseFile(file);
      const picked = collectToday(data, start, end);
      total += picked.total;
      today += picked.events.length;
    } catch (e) {
      return { ok: false, detail: `文件读取失败：${(e.message || '').slice(0, 80)}` };
    }
  }
  return { ok: true, detail: `${list.length} 个订阅 · ${fileList.length} 个文件 · 共 ${total} 个事件 · 今天 ${today} 个` };
}
