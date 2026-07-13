// 今日节目单 (P5 workstream B) — the structured day plan:「为你定制今日电台」.
//
// Two layers, honestly separated:
//   · DETERMINISTIC — quiet windows derive from calendar events in code: every
//     timed (non-all-day) event silences the host from start−10min to its end.
//     The LLM never invents or drops a meeting.
//   · LLM — one ask() call (raw JSON, story.js conventions) turns the day's
//     facts (events / weather / shows / taste) into segment intents + a
//     one-line note. Validated hard; invalid → one retry → a deterministic
//     skeleton built from the shows schedule (windows only, no invented plan).
//
// Persisted as db pref `dayPlan` keyed by local date; regenerated only when
// the date changes or a trigger forces (the 07:00 cron). Enforcement seams:
//   · isQuietNow(ts)      → shows.consultTalkBudget (hard mute, chat exempt),
//                           imaging liners/hourly IDs, station voice tracking
//   · planOpenFact(now)   → the morning show-open reads the plan on air
import { db } from './store.js';
import { todayEvents } from './calendar/index.js';
import { weather } from './weather/openweather.js';
import { extractJson } from './brain/parse.js';

export const DAY_PLAN_KEY = 'dayPlan';
export const PLAN_ANNOUNCED_KEY = 'dayPlanAnnouncedOn';

export const PLAN_KINDS = ['open', 'focus', 'energy', 'winddown', 'quiet'];
export const KIND_LABEL = { open: '开场', focus: '专注', energy: '能量', winddown: '收束', quiet: '安静' };

const QUIET_LEAD_MIN = 10;        // silence begins this long before a meeting
const DEFAULT_EVENT_MIN = 60;     // an event without an end is assumed an hour
const MAX_QUIET_WINDOWS = 8;      // sanity cap after merging
const MAX_SEGMENTS = 10;
const ALL_DAY_MS = 23 * 60 * 60 * 1000; // ≥23h of "meeting" is an all-day event

const DAY_MIN = 1440;
const MIN_MS = 60000;

// --- small time helpers ------------------------------------------------------

/** Local calendar date of a timestamp as 'YYYY-MM-DD' (the plan's day key). */
export function localDateKey(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayStartMs(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// "HH:MM" → minutes since midnight (24:00 allowed as a day-end), or null.
// Same grammar as shows.js's parser; local so plan.js stays cycle-free.
function parseHM(value) {
  const m = /^([01]?\d|2[0-4]):([0-5]\d)$/.exec((value || '').toString().trim());
  if (!m) return null;
  const mins = Number(m[1]) * 60 + Number(m[2]);
  return mins > DAY_MIN ? null : mins;
}

function toHM(mins) {
  const m = Math.max(0, Math.min(DAY_MIN, Math.round(mins)));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function clip(value, max) {
  const t = (value ?? '').toString().replace(/\s+/g, ' ').trim();
  const cp = Array.from(t);
  return cp.length <= max ? t : `${cp.slice(0, max - 1).join('')}…`;
}

// --- deterministic layer: quiet windows --------------------------------------

// Is this calendar event all-day-ish (never a quiet window)? Untimed rows
// (macOS system provider gives start:null), day-long spans, and the ICS
// all-day shape (midnight start, no end — rrule expansions land there).
function isAllDayish(ev, dayStart) {
  const start = Number(ev?.start);
  if (!Number.isFinite(start) || start <= 0) return true;
  const end = Number(ev?.end);
  if (Number.isFinite(end) && end > 0 && end - start >= ALL_DAY_MS) return true;
  if (start === dayStart && !(Number.isFinite(end) && end > 0)) return true;
  return false;
}

/**
 * Quiet windows for `now`'s local day, derived from calendar events in pure
 * code. Every timed event ⇒ quiet from start−10min to its end (start+60min
 * when the event has no end), clipped to today; overlapping/touching windows
 * merge; capped at 8. Returns [{ start:'HH:MM', end:'HH:MM', reason }].
 */
export function deriveQuietWindows(events = [], now = Date.now()) {
  const dayStart = dayStartMs(now);
  const raw = [];
  for (const ev of Array.isArray(events) ? events : []) {
    if (isAllDayish(ev, dayStart)) continue;
    const evStart = Number(ev.start);
    const evEnd = Number.isFinite(Number(ev.end)) && Number(ev.end) > evStart
      ? Number(ev.end)
      : evStart + DEFAULT_EVENT_MIN * MIN_MS;
    const startMin = Math.max(0, Math.floor((evStart - QUIET_LEAD_MIN * MIN_MS - dayStart) / MIN_MS));
    const endMin = Math.min(DAY_MIN, Math.ceil((evEnd - dayStart) / MIN_MS));
    if (endMin <= 0 || startMin >= DAY_MIN || endMin <= startMin) continue; // not today
    const at = toHM(Math.max(0, Math.round((evStart - dayStart) / MIN_MS)));
    const title = clip(ev.title, 16);
    raw.push({ startMin, endMin, reason: `${at} 的${title || '日程'}` });
  }
  raw.sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

  const merged = [];
  for (const w of raw) {
    const last = merged[merged.length - 1];
    if (last && w.startMin <= last.endMin) {
      last.endMin = Math.max(last.endMin, w.endMin);
      if (!last.reasons.includes(w.reason)) last.reasons.push(w.reason);
    } else {
      merged.push({ startMin: w.startMin, endMin: w.endMin, reasons: [w.reason] });
    }
  }
  return merged.slice(0, MAX_QUIET_WINDOWS).map((w) => ({
    start: toHM(w.startMin),
    end: toHM(w.endMin),
    reason: w.reasons.slice(0, 2).join('、'),
  }));
}

// --- the stored plan ----------------------------------------------------------

function storedPlan(now = Date.now()) {
  const raw = db.getPref(DAY_PLAN_KEY, null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (raw.date !== localDateKey(now)) return null; // yesterday's plan is dead
  if (!Array.isArray(raw.segments) || !Array.isArray(raw.quietWindows)) return null;
  return raw;
}

/** The contract-shaped plan for GET /api/plan (null when today has none). */
export function publicPlan(now = Date.now()) {
  const plan = storedPlan(now);
  if (!plan) return null;
  const { date, generatedAt, segments, quietWindows, note } = plan;
  return { date, generatedAt, segments, quietWindows, note: note || '' };
}

/**
 * The quiet window covering `now` (or null). Truthy result means the host is
 * hard-muted: consultTalkBudget denies non-chat breaks, imaging skips liners
 * and hourly IDs, the station skips pre-synthesizing voice that won't speak.
 */
export function isQuietNow(now = Date.now()) {
  const plan = storedPlan(now);
  if (!plan) return null;
  const d = new Date(now);
  const m = d.getHours() * 60 + d.getMinutes();
  for (const w of plan.quietWindows) {
    const startMin = parseHM(w?.start);
    const endMin = parseHM(w?.end);
    if (startMin == null || endMin == null) continue;
    if (m >= startMin && m < endMin) return { start: w.start, end: w.end, reason: w.reason || '' };
  }
  return null;
}

// --- LLM layer: segment intents + the day note --------------------------------

function eventLine(ev, dayStart) {
  const startOk = Number.isFinite(Number(ev.start)) && Number(ev.start) > 0;
  const at = startOk ? toHM(Math.round((Number(ev.start) - dayStart) / MIN_MS)) : '全天/未定时';
  const endOk = Number.isFinite(Number(ev.end)) && Number(ev.end) > Number(ev.start);
  const til = endOk ? `–${toHM(Math.round((Number(ev.end) - dayStart) / MIN_MS))}` : '';
  return `  - ${at}${til} ${clip(ev.title, 24) || '(无标题)'}`;
}

function tasteLines() {
  try {
    const top = db.topPlays(6);
    if (!top.length) return '';
    return `听得最多：${top.map((t) => t.name).join('、')}`;
  } catch {
    return '';
  }
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

function buildPlanPrompt({ now, events, weatherNow, shows, quietWindows }) {
  const d = new Date(now);
  const dayStart = dayStartMs(now);
  const lines = [
    '你是 Aurio 私人电台的节目编排。根据下面的事实，为这位听众规划今天的电台分段。',
    `今天：${localDateKey(now)}（周${WEEKDAYS[d.getDay()]}），现在 ${toHM(d.getHours() * 60 + d.getMinutes())}。`,
  ];
  if (weatherNow) {
    lines.push(`天气：${weatherNow.city || ''} ${weatherNow.desc || ''} ${weatherNow.temp}°C（体感 ${weatherNow.feels}°C）`);
  }
  if (events.length) {
    lines.push('今日日程：');
    for (const ev of events.slice(0, 12)) lines.push(eventLine(ev, dayStart));
  } else {
    lines.push('今日日程：暂无');
  }
  if (quietWindows.length) {
    lines.push('静默窗（由日程在代码里确定，程序会强制执行；你不需要安排它们，只需要让分段意图绕开/顺应）：');
    for (const w of quietWindows) lines.push(`  - ${w.start}–${w.end}（${w.reason}）`);
  }
  if (shows.length) {
    lines.push('节目表（电台既有的框架，分段应大体顺着它走）：');
    for (const s of shows) lines.push(`  - 《${s.name}》${s.start}–${s.end}：${clip(s.tone, 24)}`);
  }
  const taste = tasteLines();
  if (taste) lines.push(taste);
  lines.push(
    '',
    `把今天分成 3–8 段（最多 ${MAX_SEGMENTS} 段），每段一个 kind，五选一：open（开场/唤醒）、focus（专注）、energy（能量/运动）、winddown（收束/夜晚）、quiet（安静陪伴）。`,
    '时间用 24 小时制 HH:MM（一天结束可写 24:00），段落按时间排序、不重叠。label 是给听众看的短名字（12 字以内），reason 一句为什么（30 字以内），note 是一句话的当天基调（40 字以内）。',
    '只输出一个原始 JSON 对象，不要 markdown，不要代码块，不要任何解释，格式：',
    '{"note":"一句话的当天基调","segments":[{"start":"09:00","end":"11:00","kind":"focus","label":"上午第一段","reason":"一句为什么"}]}',
  );
  return lines.join('\n');
}

// Hard validation: every segment's times must parse, kinds must come from the
// enum, everything clipped to today, ≤10 segments. One bad segment fails the
// whole reply — a half-trusted plan is worse than the skeleton.
export function validatePlanReply(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const raw = parsed.segments;
  if (!Array.isArray(raw) || !raw.length || raw.length > MAX_SEGMENTS) return null;
  const segments = [];
  for (const s of raw) {
    if (!s || typeof s !== 'object') return null;
    const startMin = parseHM(s.start);
    let endMin = parseHM(s.end);
    if (startMin == null || endMin == null) return null;
    if (startMin >= DAY_MIN) return null;           // must begin today
    endMin = Math.min(endMin, DAY_MIN);             // clipped to today
    if (endMin <= startMin) return null;
    const kind = (s.kind || '').toString().trim();
    if (!PLAN_KINDS.includes(kind)) return null;
    segments.push({
      start: toHM(startMin),
      end: toHM(endMin),
      kind,
      label: clip(s.label, 12) || KIND_LABEL[kind],
      reason: clip(s.reason, 30),
    });
  }
  segments.sort((a, b) => parseHM(a.start) - parseHM(b.start));
  return { segments, note: clip(parsed.note, 40) };
}

// The deterministic fallback: today's shows become the segments — no invented
// intents, just the schedule the listener already wrote — windows unchanged.
export function skeletonSegments(shows = [], now = Date.now()) {
  const d = new Date(now);
  const isoDay = d.getDay() === 0 ? 7 : d.getDay();
  const segments = [];
  for (const s of shows) {
    if (s.isDefault) continue;
    if (s.days && !s.days.includes(isoDay)) continue;
    const startMin = s.startMin;
    const endMin = s.endMin < s.startMin ? DAY_MIN : Math.min(s.endMin, DAY_MIN); // crossing shows clip at midnight
    if (endMin <= startMin) continue;
    const kind = startMin < 9 * 60 ? 'open' : startMin >= 20 * 60 ? 'winddown' : 'focus';
    segments.push({
      start: toHM(startMin),
      end: toHM(endMin),
      kind,
      label: s.name,
      reason: `节目表《${s.name}》照常`,
    });
    if (segments.length >= MAX_SEGMENTS) break;
  }
  return segments;
}

// --- generation ----------------------------------------------------------------

// brain.ask is imported lazily (story.js pattern) so merely importing plan.js —
// shows.js pulls it for isQuietNow — never loads a brain provider.
let brainAsk = null;
async function llmAsk(prompt) {
  if (!brainAsk) {
    const brain = await import('./brain/index.js');
    brainAsk = brain.ask;
  }
  if (typeof brainAsk !== 'function') throw new Error('brain ask unavailable');
  return brainAsk(prompt);
}

let inflight = null; // concurrent generates (07:00 cron + morning show-open) coalesce

/**
 * Generate (or return) today's plan. Regenerates only when the stored plan's
 * date is stale or `force` is set — the 07:00 cron forces, everyone else
 * reuses. Seams (`ask`/`events`/`weather`/`shows`) are test injection points;
 * production callers pass nothing. Never throws; the worst outcome is the
 * deterministic skeleton.
 */
export async function generatePlan({
  now = Date.now(),
  force = false,
  ask: askFn,
  events: eventsIn,
  weather: weatherIn,
  shows: showsIn,
} = {}) {
  const existing = storedPlan(now);
  if (existing && !force) return existing;
  if (inflight) return inflight;

  const job = (async () => {
    let events = [];
    try {
      events = eventsIn ?? await todayEvents();
    } catch (e) {
      console.error('[plan] calendar:', e.message);
    }
    const quietWindows = deriveQuietWindows(events, now);

    let weatherNow = null;
    try {
      weatherNow = weatherIn !== undefined ? weatherIn : await weather.current();
    } catch { weatherNow = null; }

    let shows = [];
    try {
      // Dynamic on purpose: shows.js statically imports isQuietNow from here.
      shows = showsIn ?? (await import('./shows.js')).listShows();
    } catch (e) {
      console.error('[plan] shows:', e.message);
    }

    const prompt = buildPlanPrompt({ now, events, weatherNow, shows, quietWindows });
    const asker = askFn || llmAsk;
    let validated = null;
    for (let attempt = 0; attempt < 2 && !validated; attempt++) {
      try {
        const reply = await asker(prompt);
        validated = validatePlanReply(extractJson(typeof reply === 'string' ? reply : JSON.stringify(reply ?? '')));
      } catch (e) {
        console.error('[plan] ask:', e.message);
      }
    }

    const plan = {
      date: localDateKey(now),
      generatedAt: now,
      segments: validated ? validated.segments : skeletonSegments(shows, now),
      quietWindows,
      note: validated ? validated.note : (shows.length ? '按节目表照常播' : ''),
      source: validated ? 'llm' : 'skeleton',
    };
    db.setPref(DAY_PLAN_KEY, plan);
    console.log(`[plan] ${plan.date} generated (${plan.source}): ${plan.segments.length} segments, ${plan.quietWindows.length} quiet windows`);
    return plan;
  })().finally(() => { inflight = null; });

  inflight = job;
  return job;
}

// --- the morning announcement ---------------------------------------------------

/** Deterministic Chinese summary of a plan — trigger.fact material, not a script. */
export function planFactText(plan) {
  if (!plan) return '';
  const lines = [`今天的节目单刚排好（${plan.date}）。`];
  if (plan.quietWindows.length) {
    lines.push(`静默窗（这些时段我只放歌不说话）：${plan.quietWindows.map((w) => `${w.start}–${w.end}（${w.reason}）`).join('、')}。`);
  } else {
    lines.push('今天日程上没有需要静默避开的安排。');
  }
  if (plan.segments.length) {
    lines.push(`分段走向：${plan.segments.slice(0, 8).map((s) => `${s.start}–${s.end} ${s.label}（${KIND_LABEL[s.kind] || s.kind}${s.reason ? `，${s.reason}` : ''}）`).join('；')}。`);
  }
  if (plan.note) lines.push(`当天基调：${plan.note}`);
  return lines.join('\n');
}

/**
 * The plan summary the morning show-open carries as trigger.fact (recap
 * pattern: code states the facts, the host words them on air). Only in the
 * morning (before noon), at most once per day, generating the plan on demand
 * if the 07:00 cron found nobody listening. The announced flag commits when
 * the fact is handed out — a break that then goes silent loses the one shot;
 * better than re-announcing the day's plan every show boundary.
 */
export async function planOpenFact(now = new Date(), opts = {}) {
  const ts = now instanceof Date ? now.getTime() : Number(now) || Date.now();
  if (new Date(ts).getHours() >= 12) return null;
  const plan = await generatePlan({ now: ts, ...opts });
  if (!plan) return null;
  if (db.getPref(PLAN_ANNOUNCED_KEY, null) === plan.date) return null;
  db.setPref(PLAN_ANNOUNCED_KEY, plan.date);
  return planFactText(plan);
}

/** Test seam: forget the in-flight generation between cases. */
export function _resetPlanState() {
  inflight = null;
  brainAsk = null;
}
