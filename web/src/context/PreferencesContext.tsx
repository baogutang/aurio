import { createContext, useContext, useEffect, useMemo, useState, ReactNode, useCallback } from 'react';
import {
  loadPreferences, savePreferences, resolveTheme, resolveLocale, localeTag, resolveReducedMotion,
  type ThemeMode, type LocaleMode, type Locale, type UiPreferences,
} from '../lib/preferences';
import { t, type MessageKey } from '../lib/i18n';

interface Ctx extends UiPreferences {
  resolved: 'light' | 'dark';
  localeResolved: Locale;
  localeTag: string;
  /** System prefers-reduced-motion (live). Honor it: no infinite loops, static canvases, whole-sentence subtitles. */
  reducedMotion: boolean;
  setTheme: (t: ThemeMode) => void;
  setLocale: (l: LocaleMode) => void;
  tr: (key: MessageKey) => string;
}

const PreferencesContext = createContext<Ctx | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState(loadPreferences);
  const [resolved, setResolved] = useState<'light' | 'dark'>(() => resolveTheme(prefs.theme));
  const [localeResolved, setLocaleResolved] = useState<Locale>(() => resolveLocale(prefs.locale));
  const [reducedMotion, setReducedMotion] = useState(resolveReducedMotion);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolved);
    document.documentElement.style.colorScheme = resolved;
  }, [resolved]);

  useEffect(() => {
    document.documentElement.lang = localeResolved === 'zh' ? 'zh-CN' : 'en';
  }, [localeResolved]);

  useEffect(() => {
    const apply = () => setResolved(resolveTheme(prefs.theme));
    apply();
    if (prefs.theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [prefs.theme]);

  useEffect(() => {
    const apply = () => setLocaleResolved(resolveLocale(prefs.locale));
    apply();
    if (prefs.locale !== 'system') return;
    window.addEventListener('languagechange', apply);
    return () => window.removeEventListener('languagechange', apply);
  }, [prefs.locale]);

  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReducedMotion(mq.matches);
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  const tr = useCallback((key: MessageKey) => t(localeResolved, key), [localeResolved]);

  const value = useMemo<Ctx>(() => ({
    ...prefs,
    resolved,
    localeResolved,
    localeTag: localeTag(localeResolved),
    reducedMotion,
    tr,
    setTheme: (theme) => {
      setPrefs((p) => {
        const next = { ...p, theme };
        savePreferences(next);
        return next;
      });
    },
    setLocale: (locale) => {
      setPrefs((p) => {
        const next = { ...p, locale };
        savePreferences(next);
        return next;
      });
    },
  }), [prefs, resolved, localeResolved, reducedMotion, tr]);

  return (
    <PreferencesContext.Provider value={value}>
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences() {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error('usePreferences must be used within PreferencesProvider');
  return ctx;
}

/** Shorthand for translated strings */
export function useI18n() {
  const { tr, localeResolved, localeTag: tag } = usePreferences();
  return { t: tr, locale: localeResolved, localeTag: tag };
}
