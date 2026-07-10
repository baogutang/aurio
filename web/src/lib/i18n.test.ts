import { describe, it, expect } from 'vitest';
import { t, zh, en, type MessageKey } from './i18n';

describe('i18n message tables', () => {
  it('zh and en expose exactly the same set of keys', () => {
    const zhKeys = Object.keys(zh).sort();
    const enKeys = Object.keys(en).sort();
    expect(enKeys).toEqual(zhKeys);
  });

  it('has no empty or whitespace-only messages in either locale', () => {
    for (const [key, value] of Object.entries(zh)) {
      expect(value.trim(), `zh.${key}`).not.toBe('');
    }
    for (const [key, value] of Object.entries(en)) {
      expect(value.trim(), `en.${key}`).not.toBe('');
    }
  });

  it('keeps the {version} placeholder in both locales for updatesAvailable', () => {
    expect(zh.updatesAvailable).toContain('{version}');
    expect(en.updatesAvailable).toContain('{version}');
  });
});

describe('t()', () => {
  it('resolves a key in the requested locale', () => {
    expect(t('zh', 'connOn')).toBe('已连接');
    expect(t('en', 'connOn')).toBe('Connected');
  });

  it('returns identical strings for keys intentionally shared across locales', () => {
    // Brand/product terms stay unlocalized.
    expect(t('zh', 'onAir')).toBe(t('en', 'onAir'));
    expect(t('zh', 'fmTitle')).toBe(t('en', 'fmTitle'));
  });

  it('has no safety net for unknown keys — returns undefined, not the key name', () => {
    // Characterization: the `?? en[key]` fallback only covers a locale table
    // missing a key, which the types already prevent. A truly unknown key
    // falls through both tables.
    const bogus = 'definitely-not-a-key' as MessageKey;
    expect(t('zh', bogus)).toBeUndefined();
    expect(t('en', bogus)).toBeUndefined();
  });
});
