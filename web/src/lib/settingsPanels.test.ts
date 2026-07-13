import { describe, it, expect } from 'vitest';
import {
  visibleCalendarProviders,
  calendarCardStatus,
  clampDoubaoSpeed,
  doubaoVoiceOptions,
  DOUBAO_VOICES,
  DOUBAO_DEFAULT_VOICE,
  DOUBAO_SPEED_DEFAULT,
  type CalendarSettingsLike,
} from './settingsPanels';

const base = (over: Partial<CalendarSettingsLike> = {}): CalendarSettingsLike => ({
  system: { enabled: false },
  ics: { enabled: false },
  feishu: { enabled: false, appId: '', hasSecret: false },
  dingtalk: { configured: false, appKey: '', hasSecret: false },
  wecom: { configured: false, corpId: '', hasSecret: false },
  ...over,
});

describe('visibleCalendarProviders', () => {
  it('shows the system card only when the server platform supports it', () => {
    expect(visibleCalendarProviders(base({ system: { enabled: true } })))
      .toEqual(['system', 'feishu', 'dingtalk', 'wecom', 'ics']);
    expect(visibleCalendarProviders(base()))
      .toEqual(['feishu', 'dingtalk', 'wecom', 'ics']);
  });

  it('degrades gracefully before settings load', () => {
    expect(visibleCalendarProviders(null)).toEqual(['feishu', 'dingtalk', 'wecom', 'ics']);
    expect(visibleCalendarProviders(undefined)).toEqual(['feishu', 'dingtalk', 'wecom', 'ics']);
  });
});

describe('calendarCardStatus', () => {
  it('system: connected on darwin, off elsewhere', () => {
    expect(calendarCardStatus('system', base({ system: { enabled: true } }))).toBe('connected');
    expect(calendarCardStatus('system', base())).toBe('off');
  });

  it('ics: connected once any url or file exists', () => {
    expect(calendarCardStatus('ics', base({ ics: { enabled: true } }))).toBe('connected');
    expect(calendarCardStatus('ics', base())).toBe('off');
  });

  it('feishu: connected with full creds, saved with partial, off with none', () => {
    expect(calendarCardStatus('feishu', base({ feishu: { enabled: true, appId: 'cli_x', hasSecret: true } }))).toBe('connected');
    expect(calendarCardStatus('feishu', base({ feishu: { enabled: false, appId: 'cli_x', hasSecret: false } }))).toBe('saved');
    expect(calendarCardStatus('feishu', base())).toBe('off');
  });

  it('dingtalk / wecom: never more than "saved" (events are not wired yet)', () => {
    expect(calendarCardStatus('dingtalk', base({ dingtalk: { configured: true, appKey: 'k', hasSecret: true } }))).toBe('saved');
    expect(calendarCardStatus('dingtalk', base())).toBe('off');
    expect(calendarCardStatus('wecom', base({ wecom: { configured: true, corpId: 'ww1', hasSecret: true } }))).toBe('saved');
    expect(calendarCardStatus('wecom', base())).toBe('off');
  });

  it('everything is off before settings load', () => {
    for (const id of ['system', 'feishu', 'dingtalk', 'wecom', 'ics'] as const) {
      expect(calendarCardStatus(id, null)).toBe('off');
    }
  });
});

describe('clampDoubaoSpeed', () => {
  it('passes through the valid 0.8–2.0 range and clamps outside it', () => {
    expect(clampDoubaoSpeed(0.9)).toBe(0.9);
    expect(clampDoubaoSpeed('1.5')).toBe(1.5);
    expect(clampDoubaoSpeed(0.1)).toBe(0.8);
    expect(clampDoubaoSpeed(5)).toBe(2.0);
  });

  it('falls back to the radio default on garbage', () => {
    expect(clampDoubaoSpeed('')).toBe(DOUBAO_SPEED_DEFAULT);
    expect(clampDoubaoSpeed('fast')).toBe(DOUBAO_SPEED_DEFAULT);
    expect(clampDoubaoSpeed(undefined)).toBe(DOUBAO_SPEED_DEFAULT);
    expect(clampDoubaoSpeed(NaN)).toBe(DOUBAO_SPEED_DEFAULT);
  });
});

describe('doubaoVoiceOptions', () => {
  it('returns the catalogue when the saved voice is one of ours (or empty)', () => {
    expect(doubaoVoiceOptions('')).toEqual(DOUBAO_VOICES);
    expect(doubaoVoiceOptions(DOUBAO_DEFAULT_VOICE)).toEqual(DOUBAO_VOICES);
  });

  it('keeps an unknown saved voice (e.g. a cloned S_xxx) as an extra option', () => {
    const opts = doubaoVoiceOptions('S_cloned123', 'Custom');
    expect(opts).toHaveLength(DOUBAO_VOICES.length + 1);
    expect(opts[opts.length - 1]).toEqual({ id: 'S_cloned123', label: 'Custom · S_cloned123' });
  });

  it('defaults to 深夜播客 multi-emotion', () => {
    expect(DOUBAO_DEFAULT_VOICE).toBe('zh_male_shenyeboke_emo_v2_mars_bigtts');
  });
});
