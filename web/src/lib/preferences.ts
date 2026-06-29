export type ThemeMode = 'system' | 'light' | 'dark';
export type ClockStyle = 'matrix' | 'flip' | 'neon';
export type LocaleMode = 'system' | 'zh' | 'en';
export type Locale = 'zh' | 'en';

export interface UiPreferences {
  theme: ThemeMode;
  clock: ClockStyle;
  locale: LocaleMode;
}

const KEY = 'aurio.ui';

const defaults: UiPreferences = { theme: 'system', clock: 'matrix', locale: 'system' };

export function loadPreferences(): UiPreferences {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...defaults };
    const p = JSON.parse(raw) as Partial<UiPreferences>;
    return {
      theme: p.theme === 'light' || p.theme === 'dark' ? p.theme : 'system',
      clock: p.clock === 'flip' || p.clock === 'neon' ? p.clock : 'matrix',
      locale: p.locale === 'zh' || p.locale === 'en' ? p.locale : 'system',
    };
  } catch {
    return { ...defaults };
  }
}

export function savePreferences(p: UiPreferences) {
  localStorage.setItem(KEY, JSON.stringify(p));
}

export function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'light' || mode === 'dark') return mode;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function resolveLocale(mode: LocaleMode): Locale {
  if (mode === 'zh' || mode === 'en') return mode;
  const lang = (navigator.language || 'en').toLowerCase();
  return lang.startsWith('zh') ? 'zh' : 'en';
}

export function localeTag(locale: Locale): string {
  return locale === 'zh' ? 'zh-CN' : 'en-US';
}
