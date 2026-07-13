// The macOS calendar parser: AppleScript date SUBTRACTION (integer seconds
// from midnight) is locale-proof; the old `as string` format was thrown away
// entirely and silently disabled quiet windows for the system calendar.
import { describe, it, expect } from 'vitest';
import { parseMacCalendarOutput } from '../server/calendar/system.js';

const DAY = 1783900800000; // an arbitrary local midnight

describe('parseMacCalendarOutput', () => {
  it('converts seconds-from-midnight into epoch ms with real end times', () => {
    const [ev] = parseMacCalendarOutput('晨会\t34200\t36000\tfalse\n', DAY);
    expect(ev).toMatchObject({
      title: '晨会', start: DAY + 34200 * 1000, end: DAY + 36000 * 1000,
      allDay: false, source: 'system',
    });
  });

  it('flags all-day events and keeps their midnight-to-midnight span', () => {
    const [ev] = parseMacCalendarOutput('生日\t0\t86400\ttrue\n', DAY);
    expect(ev.allDay).toBe(true);
    expect(ev.start).toBe(DAY);
    expect(ev.end).toBe(DAY + 86400 * 1000);
  });

  it('degrades garbage lines to null times instead of throwing', () => {
    const events = parseMacCalendarOutput('坏行\n\t\t\t\n', DAY);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ title: '坏行', start: null, end: null });
  });

  it('rejects an end that does not follow its start', () => {
    const [ev] = parseMacCalendarOutput('倒着的\t36000\t34200\tfalse\n', DAY);
    expect(ev.start).toBe(DAY + 36000 * 1000);
    expect(ev.end).toBeNull();
  });

  it('empty output → no events', () => {
    expect(parseMacCalendarOutput('', DAY)).toEqual([]);
  });
});
