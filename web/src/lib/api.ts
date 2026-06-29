import type { StatusResp, SettingsResp, AiProvidersResp, CastDevice, TestResult, Broadcast, LyricsResp, ChatMsg } from './types';

const json = (r: Response) => r.json();
const post = (url: string, body: unknown) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const api = {
  status: (): Promise<StatusResp> => fetch('/api/status').then(json),
  messages: (limit = 80): Promise<{ messages: ChatMsg[] }> =>
    fetch('/api/messages?limit=' + encodeURIComponent(limit)).then(json),
  settings: (): Promise<SettingsResp> => fetch('/api/settings').then(json),
  chat: (text: string): Promise<Broadcast> => post('/api/chat', { text }).then(json),
  trigger: (kind: string): Promise<Broadcast> => post('/api/trigger', { kind }).then(json),
  played: (t: { id: string; title: string; artist: string; source: string }) => post('/api/played', t),
  setQueue: (queue: unknown[]): Promise<{ ok: boolean; queue: number }> => post('/api/queue', { queue }).then(json),
  testNavidrome: (b: { url: string; user: string; pass?: string }): Promise<{ ok: boolean; detail: string }> =>
    post('/api/settings/test-navidrome', b).then(json),
  testQQ: (b: Record<string, string>): Promise<TestResult> => post('/api/settings/test-qq', b).then(json),
  saveSettings: (b: Record<string, string>) => post('/api/settings', b).then(json),
  ncmQr: (): Promise<{ key?: string; img?: string; error?: string }> => fetch('/api/ncm/login/qr').then(json),
  ncmCheck: (key: string): Promise<{ status: string; nickname?: string }> =>
    fetch('/api/ncm/login/check?key=' + encodeURIComponent(key)).then(json),
  lyrics: (t: { source: string; id: string; title?: string; artist?: string }): Promise<LyricsResp> =>
    fetch('/api/lyrics?source=' + encodeURIComponent(t.source)
      + '&id=' + encodeURIComponent(t.id)
      + '&title=' + encodeURIComponent(t.title || '')
      + '&artist=' + encodeURIComponent(t.artist || '')).then(json),

  // AI brain
  aiProviders: (): Promise<AiProvidersResp> => fetch('/api/ai/providers').then(json),
  aiTest: (b: Record<string, string>): Promise<TestResult> => post('/api/ai/test', b).then(json),

  // Per-integration tests (candidate values in body, fall back to saved)
  testFish: (b: Record<string, string>): Promise<TestResult> => post('/api/settings/test-fish', b).then(json),
  testWeather: (b: Record<string, string>): Promise<TestResult> => post('/api/settings/test-weather', b).then(json),
  testCalendar: (b: Record<string, string>): Promise<TestResult> => post('/api/settings/test-calendar', b).then(json),
  testSystemCalendar: (): Promise<TestResult> => post('/api/calendar/system/test', {}).then(json),
  openCalendarPrivacy: (): Promise<TestResult> => post('/api/calendar/system/open-privacy', {}).then(json),
  importCalendar: (b: { name: string; content: string }): Promise<TestResult & { files?: string[] }> =>
    post('/api/calendar/import', b).then(json),

  // UPnP casting
  castDevices: (): Promise<{ devices: CastDevice[]; error?: string }> => fetch('/api/cast/devices').then(json),
  castPlay: (deviceId: string, track: unknown): Promise<{ ok: boolean; error?: string }> =>
    post('/api/cast/play', { deviceId, track }).then(json),
  castControl: (deviceId: string, action: string): Promise<{ ok: boolean; error?: string }> =>
    post('/api/cast/control', { deviceId, action }).then(json),
  castVolume: (deviceId: string, pct: number): Promise<{ ok: boolean; volume?: number; error?: string }> =>
    post('/api/cast/volume', { deviceId, pct }).then(json),
};

export const fmt = (s: number) => {
  if (!s || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
};
