import type { StatusResp, SettingsResp, AiProvidersResp, CastDevice, TestResult, SegmentResult, LyricsResp, ChatMsg, ProfileResp, TasteResp, ContextResp } from './types';
import type { ProgrammeSnapshot } from './programme';

const json = async (r: Response) => {
  if (!r.ok) {
    const err = new Error(`HTTP ${r.status}`) as Error & { status?: number };
    err.status = r.status;
    throw err;
  }
  return r.json();
};

let sessionToken: string | null = null;
let sessionPromise: Promise<string> | null = null;
let wsClientId: string | null = null;

export function resetSession() {
  sessionToken = null;
  sessionPromise = null;
}

export function setWsClientId(id: string | null) {
  wsClientId = id;
}

export function session(): Promise<string> {
  if (sessionToken) return Promise.resolve(sessionToken);
  if (!sessionPromise) {
    sessionPromise = fetch('/api/session')
      .then(json)
      .then((r) => {
        sessionToken = (r?.token || '').toString();
        if (!sessionToken) throw new Error('missing session token');
        return sessionToken;
      })
      .finally(() => { sessionPromise = null; });
  }
  return sessionPromise;
}

export async function authHeaders(extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { ...extra, 'X-Aurio-Token': await session() };
  if (wsClientId) headers['X-Aurio-Client-Id'] = wsClientId;
  return headers;
}

const DEFAULT_TIMEOUT_MS = 15000;
const LONG_TIMEOUT_MS = 120000;

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

async function request(url: string, init: RequestInit = {}, { timeoutMs = DEFAULT_TIMEOUT_MS, retryOn403 = true } = {}) {
  const headers = await authHeaders(init.headers as Record<string, string> || {});
  let res = await fetchWithTimeout(url, { ...init, headers }, timeoutMs);
  if (res.status === 403 && retryOn403) {
    resetSession();
    const retryHeaders = await authHeaders(init.headers as Record<string, string> || {});
    res = await fetchWithTimeout(url, { ...init, headers: retryHeaders }, timeoutMs);
  }
  return res;
}

const get = async (url: string, opts?: { timeoutMs?: number }) =>
  request(url, {}, opts).then(json);

const post = async (url: string, body: unknown, opts?: { timeoutMs?: number }) =>
  request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, opts).then(json);

export const api = {
  session,
  resetSession,
  status: (): Promise<StatusResp> => get('/api/status'),
  context: (): Promise<ContextResp> => get('/api/context'),
  messages: (limit = 80): Promise<{ messages: ChatMsg[] }> =>
    get('/api/messages?limit=' + encodeURIComponent(limit)),
  settings: (): Promise<SettingsResp> => get('/api/settings'),
  chat: (text: string): Promise<SegmentResult> => post('/api/chat', { text }, { timeoutMs: LONG_TIMEOUT_MS }),
  trigger: (kind: string): Promise<SegmentResult> => post('/api/trigger', { kind }, { timeoutMs: LONG_TIMEOUT_MS }),
  played: (t: { id: string; title: string; artist: string; source: string; position_sec?: number; queue_index?: number }) =>
    post('/api/played', t),
  playbackEvent: (body: {
    event: 'started' | 'completed' | 'skipped' | 'replayed' | 'like' | 'dislike';
    track: { id: string; title: string; artist: string; source: string };
    position_sec?: number;
    queue_index?: number;
  }) => post('/api/playback-event', body),
  programme: (upNext = 5): Promise<{ ok: boolean } & ProgrammeSnapshot> =>
    get('/api/programme?upNext=' + encodeURIComponent(upNext)),
  skip: (): Promise<{ ok: boolean } & ProgrammeSnapshot> => post('/api/skip', {}),
  testNavidrome: (b: { url: string; user: string; pass?: string }): Promise<{ ok: boolean; detail: string }> =>
    post('/api/settings/test-navidrome', b),
  testQQ: (b: Record<string, string>): Promise<TestResult> => post('/api/settings/test-qq', b),
  saveSettings: (b: Record<string, string>) => post('/api/settings', b),
  ncmQr: (): Promise<{ key?: string; img?: string; error?: string }> => get('/api/ncm/login/qr'),
  ncmCheck: (key: string): Promise<{ status: string; nickname?: string }> =>
    get('/api/ncm/login/check?key=' + encodeURIComponent(key)),
  lyrics: (t: { source: string; id: string; title?: string; artist?: string }): Promise<LyricsResp> =>
    get('/api/lyrics?source=' + encodeURIComponent(t.source)
      + '&id=' + encodeURIComponent(t.id)
      + '&title=' + encodeURIComponent(t.title || '')
      + '&artist=' + encodeURIComponent(t.artist || '')),
  aiProviders: (): Promise<AiProvidersResp> => get('/api/ai/providers'),
  aiTest: (b: Record<string, string>): Promise<TestResult> => post('/api/ai/test', b),
  testFish: (b: Record<string, string>): Promise<TestResult> => post('/api/settings/test-fish', b),
  testWeather: (b: Record<string, string>): Promise<TestResult> => post('/api/settings/test-weather', b),
  testCalendar: (b: Record<string, string>): Promise<TestResult> => post('/api/settings/test-calendar', b),
  testSystemCalendar: (): Promise<TestResult> => post('/api/calendar/system/test', {}),
  openCalendarPrivacy: (): Promise<TestResult> => post('/api/calendar/system/open-privacy', {}),
  importCalendar: (b: { name: string; content: string }): Promise<TestResult & { files?: string[] }> =>
    post('/api/calendar/import', b),
  castDevices: (): Promise<{ devices: CastDevice[]; error?: string }> => get('/api/cast/devices'),
  castPlay: (deviceId: string, track: unknown): Promise<{ ok: boolean; error?: string }> =>
    post('/api/cast/play', { deviceId, track }),
  castControl: (deviceId: string, action: string): Promise<{ ok: boolean; error?: string }> =>
    post('/api/cast/control', { deviceId, action }),
  castVolume: (deviceId: string, pct: number): Promise<{ ok: boolean; volume?: number; error?: string }> =>
    post('/api/cast/volume', { deviceId, pct }),
  profile: (): Promise<ProfileResp> => get('/api/profile'),
  buildProfile: (): Promise<{ started: boolean; busy?: boolean }> => post('/api/profile/build', {}),
  taste: (): Promise<TasteResp> => get('/api/taste'),
  planToday: (): Promise<{ plan: { date?: string; mood?: string; note?: string } | null }> =>
    get('/api/plan/today'),
};

export const fmt = (s: number) => {
  if (!s || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
};
