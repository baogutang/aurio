import type { Locale } from './preferences';

export interface NowDisplay {
  time: string;
  weekday: string;
  dateLine: string;
}

export function formatNow(d: Date, locale: Locale, localeTag: string): NowDisplay {
  const time = d.toLocaleTimeString(localeTag, { hour: '2-digit', minute: '2-digit', hour12: false });
  const weekday = d.toLocaleDateString(localeTag, { weekday: 'long' });

  let dateLine: string;
  if (locale === 'zh') {
    dateLine = d.toLocaleDateString(localeTag, { year: 'numeric', month: 'long', day: 'numeric' });
  } else {
    const raw = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    dateLine = raw.replace(/([a-z]+)/i, (m) => m.toUpperCase());
  }

  return { time, weekday, dateLine };
}
