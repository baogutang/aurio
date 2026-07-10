export type ThemeMode = 'system' | 'light' | 'dark';
export type LocaleMode = 'system' | 'zh' | 'en';
export type Locale = 'zh' | 'en';

export interface UiPreferences {
  theme: ThemeMode;
  locale: LocaleMode;
}

const KEY = 'aurio.ui';

const defaults: UiPreferences = { theme: 'system', locale: 'system' };

// The 0.4.x `clock` style preference was removed when the UI converged on the
// single dot-matrix clock. Stored legacy values (`clock: 'flip' | 'neon' | …`)
// are silently ignored here and dropped on the next save.
export function loadPreferences(): UiPreferences {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...defaults };
    const p = JSON.parse(raw) as Partial<UiPreferences>;
    return {
      theme: p.theme === 'light' || p.theme === 'dark' ? p.theme : 'system',
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

// There is no manual reduced-motion setting yet; the flag follows the system.
// Exposed here (not inline in the context) so it stays testable and so a
// future stored override has one obvious place to compose in.
export function resolveReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
