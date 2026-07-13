// Broadcast-honest time display helpers for the LIVE timeline.
// All wall-clock values are station wall-clock ms epoch (Date.now() + skew).

const pad = (n: number) => String(n).padStart(2, '0');

/** `21:47:32` — the hardware-clock face of a wall-clock instant (local tz). */
export function formatWallClock(ms: number, opts?: { seconds?: boolean }): string {
  const d = new Date(ms);
  const base = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return opts?.seconds === false ? base : `${base}:${pad(d.getSeconds())}`;
}

/**
 * The wall-clock instant a media position corresponds to. Media plays
 * cueIn→cueOut, so position `posSec` means `start + (posSec*1000 − cueIn)`
 * of broadcast time. This is what makes the progress row read as a clock:
 * live it equals now, paused it freezes, on tape it shows the ORIGINAL
 * air time of what you are hearing.
 */
export function airPositionMs(itemStart: number, cueIn: number, posSec: number): number {
  return itemStart + posSec * 1000 - cueIn;
}

/** 「已连续直播 N 小时 M 分」 parts; null hides the line (field not sent yet). */
export function uptimeParts(
  stationStartedAt: number | null | undefined,
  now: number,
): { hours: number; minutes: number } | null {
  const started = Number(stationStartedAt);
  if (!Number.isFinite(started) || started <= 0) return null;
  const total = now - started;
  if (total < 0) return null;
  return { hours: Math.floor(total / 3_600_000), minutes: Math.floor(total / 60_000) % 60 };
}

/**
 * `21:47` timestamp for one transcript line (P5-D 转写流); null hides the
 * stamp for legacy lines that never recorded when they aired.
 */
export function transcriptTime(ts?: number | null): string | null {
  if (!Number.isFinite(ts) || (ts as number) <= 0) return null;
  return formatWallClock(ts as number, { seconds: false });
}

/** Fill `{name}` placeholders in an i18n template. */
export function fillTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, key: string) =>
    key in vars ? String(vars[key]) : m);
}
