// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  loadPreferences,
  savePreferences,
  resolveTheme,
  resolveLocale,
  localeTag,
  type UiPreferences,
} from './preferences';

const KEY = 'aurio.ui';
const defaults: UiPreferences = { theme: 'system', clock: 'matrix', locale: 'system' };

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
    localStorage.setItem(KEY, JSON.stringify({ theme: 'dark', clock: 'neon', locale: 'en' }));
    expect(loadPreferences()).toEqual({ theme: 'dark', clock: 'neon', locale: 'en' });
  });

  it('sanitizes unknown enum values field-by-field back to defaults', () => {
    localStorage.setItem(KEY, JSON.stringify({ theme: 'blue', clock: 'flip', locale: 'fr' }));
    expect(loadPreferences()).toEqual({ theme: 'system', clock: 'flip', locale: 'system' });
  });

  it('fills missing fields with defaults', () => {
    localStorage.setItem(KEY, JSON.stringify({ theme: 'light' }));
    expect(loadPreferences()).toEqual({ theme: 'light', clock: 'matrix', locale: 'system' });
  });

  it('round-trips through savePreferences', () => {
    const prefs: UiPreferences = { theme: 'light', clock: 'flip', locale: 'zh' };
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

describe('localeTag', () => {
  it('maps app locales to BCP 47 tags', () => {
    expect(localeTag('zh')).toBe('zh-CN');
    expect(localeTag('en')).toBe('en-US');
  });
});
