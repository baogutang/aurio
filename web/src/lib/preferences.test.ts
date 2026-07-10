// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  loadPreferences,
  savePreferences,
  resolveTheme,
  resolveLocale,
  resolveReducedMotion,
  localeTag,
  type UiPreferences,
} from './preferences';

const KEY = 'aurio.ui';
const defaults: UiPreferences = { theme: 'system', locale: 'system' };

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('loadPreferences', () => {
  it('returns defaults when nothing is stored', () => {
    expect(loadPreferences()).toEqual(defaults);
  });

  it('returns a fresh object each time (no shared mutable defaults)', () => {
    const a = loadPreferences();
    const b = loadPreferences();
    expect(a).not.toBe(b);
  });

  it('returns defaults for invalid JSON', () => {
    localStorage.setItem(KEY, '{not json');
    expect(loadPreferences()).toEqual(defaults);
  });

  it('returns defaults when the stored value is JSON null', () => {
    // JSON.parse succeeds, property access throws, catch kicks in.
    localStorage.setItem(KEY, 'null');
    expect(loadPreferences()).toEqual(defaults);
  });

  it('keeps valid stored values', () => {
    localStorage.setItem(KEY, JSON.stringify({ theme: 'dark', locale: 'en' }));
    expect(loadPreferences()).toEqual({ theme: 'dark', locale: 'en' });
  });

  it('sanitizes unknown enum values field-by-field back to defaults', () => {
    localStorage.setItem(KEY, JSON.stringify({ theme: 'blue', locale: 'fr' }));
    expect(loadPreferences()).toEqual({ theme: 'system', locale: 'system' });
  });

  it('fills missing fields with defaults', () => {
    localStorage.setItem(KEY, JSON.stringify({ theme: 'light' }));
    expect(loadPreferences()).toEqual({ theme: 'light', locale: 'system' });
  });

  // The clock-style preference was removed when the UI converged on the
  // single dot-matrix clock; 0.4.x installs may still have it stored.
  it('silently ignores the legacy clock field', () => {
    localStorage.setItem(KEY, JSON.stringify({ theme: 'dark', clock: 'neon', locale: 'zh' }));
    expect(loadPreferences()).toEqual({ theme: 'dark', locale: 'zh' });
  });

  it('drops the legacy clock field on the next save round-trip', () => {
    localStorage.setItem(KEY, JSON.stringify({ theme: 'dark', clock: 'flip', locale: 'zh' }));
    savePreferences(loadPreferences());
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ theme: 'dark', locale: 'zh' });
  });

  it('round-trips through savePreferences', () => {
    const prefs: UiPreferences = { theme: 'light', locale: 'zh' };
    savePreferences(prefs);
    expect(loadPreferences()).toEqual(prefs);
  });
});

describe('resolveTheme', () => {
  it('passes explicit light/dark through without consulting the system', () => {
    const spy = vi.fn();
    window.matchMedia = spy as unknown as typeof window.matchMedia;
    expect(resolveTheme('light')).toBe('light');
    expect(resolveTheme('dark')).toBe('dark');
    expect(spy).not.toHaveBeenCalled();
  });

  it('resolves "system" from the prefers-color-scheme media query', () => {
    const spy = vi.fn().mockReturnValue({ matches: true });
    window.matchMedia = spy as unknown as typeof window.matchMedia;
    expect(resolveTheme('system')).toBe('light');
    expect(spy).toHaveBeenCalledWith('(prefers-color-scheme: light)');

    spy.mockReturnValue({ matches: false });
    expect(resolveTheme('system')).toBe('dark');
  });
});

describe('resolveLocale', () => {
  it('passes explicit zh/en through', () => {
    expect(resolveLocale('zh')).toBe('zh');
    expect(resolveLocale('en')).toBe('en');
  });

  it.each([
    ['zh-CN', 'zh'],
    ['zh-TW', 'zh'],
    ['ZH-HANS', 'zh'], // case-insensitive
    ['en-US', 'en'],
    ['en-GB', 'en'],
    ['ja-JP', 'en'], // anything non-Chinese falls back to English
    ['', 'en'], // empty language falls back to English
  ])('"system" with navigator.language=%j resolves to %s', (language, expected) => {
    vi.stubGlobal('navigator', { language });
    expect(resolveLocale('system')).toBe(expected);
  });
});

describe('resolveReducedMotion', () => {
  it('follows the prefers-reduced-motion media query', () => {
    const spy = vi.fn().mockReturnValue({ matches: true });
    window.matchMedia = spy as unknown as typeof window.matchMedia;
    expect(resolveReducedMotion()).toBe(true);
    expect(spy).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');

    spy.mockReturnValue({ matches: false });
    expect(resolveReducedMotion()).toBe(false);
  });

  it('defaults to false when matchMedia is unavailable', () => {
    const original = window.matchMedia;
    // @ts-expect-error simulating an environment without matchMedia
    window.matchMedia = undefined;
    expect(resolveReducedMotion()).toBe(false);
    window.matchMedia = original;
  });
});

describe('localeTag', () => {
  it('maps app locales to BCP 47 tags', () => {
    expect(localeTag('zh')).toBe('zh-CN');
    expect(localeTag('en')).toBe('en-US');
  });
});
