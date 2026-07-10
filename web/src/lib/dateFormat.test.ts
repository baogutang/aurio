import { describe, it, expect } from 'vitest';
import { formatNow } from './dateFormat';

// All dates are built with the local-time Date constructor and formatted with
// local-time formatters, so assertions hold in any timezone. vitest.config.ts
// additionally pins TZ=UTC for the whole suite.

const monday = new Date(2026, 0, 5, 9, 7, 3); // Mon 5 Jan 2026, 09:07:03
const sunday = new Date(2026, 5, 21, 18, 45); // Sun 21 Jun 2026, 18:45
const midnight = new Date(2026, 2, 1, 0, 5); // Sun 1 Mar 2026, 00:05

describe('formatNow — zh locale', () => {
  it('formats time as 24h HH:mm, weekday and date in Chinese', () => {
    const out = formatNow(monday, 'zh', 'zh-CN');
    expect(out.time).toBe('09:07');
    expect(out.weekday).toBe('星期一');
    expect(out.dateLine).toBe('2026年1月5日');
  });

  it('formats an evening time and a Sunday', () => {
    const out = formatNow(sunday, 'zh', 'zh-CN');
    expect(out.time).toBe('18:45');
    expect(out.weekday).toBe('星期日');
    expect(out.dateLine).toBe('2026年6月21日');
  });
});

describe('formatNow — en locale', () => {
  it('formats time as 24h, long weekday, and an uppercased en-GB date line', () => {
    const out = formatNow(monday, 'en', 'en-US');
    expect(out.time).toBe('09:07');
    expect(out.weekday).toBe('Monday');
    expect(out.dateLine).toBe('5 JAN 2026');
  });

  it('uppercases only the month abbreviation (first alphabetic run)', () => {
    const out = formatNow(sunday, 'en', 'en-US');
    expect(out.dateLine).toBe('21 JUN 2026');
  });

  it('uses h23 so midnight renders as 00, not 24 or 12', () => {
    expect(formatNow(midnight, 'en', 'en-US').time).toBe('00:05');
    expect(formatNow(midnight, 'zh', 'zh-CN').time).toBe('00:05');
  });
});

describe('formatNow — locale vs localeTag split', () => {
  it('time and weekday follow localeTag, but the en date line is hard-coded to en-GB', () => {
    // Characterization: when locale = "en" the dateLine ignores localeTag
    // entirely; only time/weekday react to it.
    const out = formatNow(monday, 'en', 'zh-CN');
    expect(out.weekday).toBe('星期一');
    expect(out.dateLine).toBe('5 JAN 2026');
  });

  it('zh date line follows the given localeTag', () => {
    const out = formatNow(monday, 'zh', 'zh-CN');
    expect(out.dateLine).toContain('2026年');
  });
});
