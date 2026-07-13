// Pure logic behind the 设置 → 语音 / 日历 panels (P5-S): calendar provider
// card status derivation and the Doubao (豆包/火山引擎) voice catalogue. Kept
// out of the components so it is unit-testable without React.

// ---- Calendar provider chooser ----

export type CalendarProviderId = 'system' | 'feishu' | 'dingtalk' | 'wecom' | 'ics';

// 'connected' — creds complete / source active (the live test proves it works);
// 'saved'     — credentials stored but events aren't wired yet (钉钉/企微);
// 'off'       — nothing configured.
export type CalendarCardStatus = 'connected' | 'saved' | 'off';

export interface CalendarSettingsLike {
  system?: { enabled: boolean };
  ics: { enabled: boolean };
  feishu: { enabled: boolean; appId?: string; hasSecret?: boolean };
  dingtalk: { configured?: boolean; appKey?: string; hasSecret?: boolean };
  wecom: { configured?: boolean; corpId?: string; hasSecret?: boolean };
}

// The system-calendar card only exists where the server can actually read one
// (the server reports its own platform via calendars.system.enabled — the
// AppleScript runs server-side, so the server platform is the truth).
export function visibleCalendarProviders(cal?: CalendarSettingsLike | null): CalendarProviderId[] {
  const rest: CalendarProviderId[] = ['feishu', 'dingtalk', 'wecom', 'ics'];
  return cal?.system?.enabled ? ['system', ...rest] : rest;
}

export function calendarCardStatus(id: CalendarProviderId, cal?: CalendarSettingsLike | null): CalendarCardStatus {
  if (!cal) return 'off';
  switch (id) {
    case 'system': return cal.system?.enabled ? 'connected' : 'off';
    case 'ics': return cal.ics?.enabled ? 'connected' : 'off';
    case 'feishu':
      if (cal.feishu?.enabled) return 'connected';
      return (cal.feishu?.appId || cal.feishu?.hasSecret) ? 'saved' : 'off';
    case 'dingtalk':
      return (cal.dingtalk?.configured || cal.dingtalk?.appKey || cal.dingtalk?.hasSecret) ? 'saved' : 'off';
    case 'wecom':
      return (cal.wecom?.configured || cal.wecom?.corpId || cal.wecom?.hasSecret) ? 'saved' : 'off';
  }
}

// Root settings list badge: 已配置 when ANY provider is usable or has creds.
export function anyCalendarConfigured(cal?: CalendarSettingsLike | null): boolean {
  return visibleCalendarProviders(cal).some((id) => calendarCardStatus(id, cal) !== 'off');
}

// ---- Doubao (豆包 / 火山引擎大模型语音合成) voice catalogue ----

// Voice ids verified against third-party mirrors of the official 音色列表
// (docs.volcengine.com/docs/6561/1257544 renders client-side): LinkAI's voice
// table and the sealos aiproxy doubao adaptor both list the *_moon_bigtts /
// *_mars_bigtts ids below. The default 深夜播客·多情感 (emo_v2) variant is the
// project-wide default from server/config.js (multi-emotion 1.0 voice).
export const DOUBAO_VOICES: { id: string; label: string }[] = [
  { id: 'zh_male_shenyeboke_emo_v2_mars_bigtts', label: '深夜播客 · 多情感（默认）' },
  { id: 'zh_male_shenyeboke_moon_bigtts', label: '深夜播客' },
  { id: 'zh_female_wenrouxiaoya_moon_bigtts', label: '温柔小雅' },
  { id: 'zh_male_yuanboxiaoshu_moon_bigtts', label: '渊博小叔' },
  { id: 'zh_female_zhixingnvsheng_mars_bigtts', label: '知性女声' },
  { id: 'zh_female_wanwanxiaohe_moon_bigtts', label: '湾湾小何' },
];

export const DOUBAO_DEFAULT_VOICE = DOUBAO_VOICES[0].id;

// Only multi-emotion (emo) voices react to these; '' = the voice's own register.
export const DOUBAO_EMOTIONS: { id: string; label: string }[] = [
  { id: '', label: '' }, // label filled from i18n (默认 · 音色本声)
  { id: 'happy', label: '开心 · happy' },
  { id: 'sad', label: '低落 · sad' },
  { id: 'angry', label: '生气 · angry' },
  { id: 'surprised', label: '惊讶 · surprised' },
  { id: 'fear', label: '害怕 · fear' },
  { id: 'excited', label: '兴奋 · excited' },
  { id: 'coldness', label: '冷淡 · coldness' },
  { id: 'neutral', label: '中性 · neutral' },
];

export const DOUBAO_SPEED_MIN = 0.8;
export const DOUBAO_SPEED_MAX = 2.0;
export const DOUBAO_SPEED_DEFAULT = 0.9;

// API accepts 0.8–2.0; anything unparsable falls back to the radio default.
export function clampDoubaoSpeed(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  if (!Number.isFinite(n)) return DOUBAO_SPEED_DEFAULT;
  return Math.min(DOUBAO_SPEED_MAX, Math.max(DOUBAO_SPEED_MIN, n));
}

// Options for the voice <select>: the catalogue, plus the saved value as an
// extra "custom" entry when it isn't one of ours (e.g. a cloned S_xxx voice) —
// switching panels must never silently rewrite a working custom voice.
export function doubaoVoiceOptions(current: string, customLabel = '自定义'): { id: string; label: string }[] {
  const trimmed = (current || '').trim();
  if (!trimmed || DOUBAO_VOICES.some((v) => v.id === trimmed)) return DOUBAO_VOICES;
  return [...DOUBAO_VOICES, { id: trimmed, label: `${customLabel} · ${trimmed}` }];
}
