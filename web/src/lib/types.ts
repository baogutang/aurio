export interface Track {
  source: 'navidrome' | 'netease' | 'qqmusic';
  id: string;
  title: string;
  artist: string;
  album?: string;
  duration?: number;
  coverArt?: string;
  year?: number;
  url?: string;
  reason?: string;
  segue?: string;
  segueTtsUrl?: string | null;
  uid?: string; // client-side stable key for queue reorder/remove
}

export type BroadcastMode = 'replace' | 'append' | 'insert' | 'steer' | 'chat';

export interface Broadcast {
  type?: 'broadcast';
  ts?: number;
  kind?: string;
  mode?: BroadcastMode;
  placement?: 'next' | 'append';
  mood?: string;
  say?: string;
  segue?: string;
  reason?: string;
  ttsUrl?: string | null;
  queue?: Track[];
  error?: string;
}

export interface TtsPatch {
  type?: 'tts';
  ts?: number;
  kind?: string;
  mode?: BroadcastMode;
  ttsUrl?: string | null;
  track?: Pick<Track, 'source' | 'id' | 'title' | 'artist'> | null;
}

export interface StatusResp {
  ok: boolean;
  config: { port: number; ai?: string; navidrome: boolean; netease: boolean; qqmusic: boolean; fish: boolean; weather: boolean; calendars: Record<string, boolean> };
  calendars: string[];
  queue: number;
  musicSource?: 'combined' | 'netease' | 'navidrome' | 'qqmusic';
  sourceModes?: ('combined' | 'netease' | 'navidrome' | 'qqmusic')[];
  sources?: { netease: boolean; navidrome: boolean; qqmusic: boolean };
}

export interface SettingsResp {
  navidrome: { url: string; user: string; hasPass: boolean; enabled: boolean };
  netease: { loggedIn: boolean; realIP: string };
  qq: { apiUrl: string; enabled: boolean; hasCookie: boolean };
  voice?: {
    provider: string;
    enabled: boolean;
    system: { voice: string };
    tencent: { hasSecretId: boolean; hasSecretKey: boolean; region: string; voiceType: string };
  };
  ai: {
    provider: string;
    cli: { bin: string; model: string; forceLogin: boolean };
    api: { kind: string; baseUrl: string; model: string; hasKey: boolean };
  };
  fish: { hasKey: boolean; referenceId: string };
  weather: { hasKey: boolean; city: string; lat: string; lon: string; enabled: boolean };
  calendars: {
    system?: { enabled: boolean };
    ics: { urls: string; files?: string[]; enabled: boolean };
    feishu: { appId: string; hasSecret: boolean; calendarId: string; enabled: boolean };
    dingtalk: { appKey: string; hasSecret: boolean; enabled: boolean };
    wecom: { corpId: string; hasSecret: boolean; agentId: string; enabled: boolean };
  };
  onboarded: boolean;
}

export interface AiPreset { id: string; kind: 'openai' | 'anthropic'; label: string; baseUrl: string; model: string }
export interface AiProvidersResp {
  current: string;
  detected: Record<string, boolean>;
  api: { kind: string; baseUrl: string; model: string; hasKey: boolean };
  presets: AiPreset[];
}

export interface CastDevice { id: string; name: string; location: string }
export interface TestResult { ok: boolean; detail: string; url?: string }

export type ChatMsg = { role: 'user' | 'dj'; text: string; ts?: number };

export interface LyricLine { time: number | null; text: string; tr?: string }
export interface LyricsResp { ok: boolean; source: string; synced: boolean; lines: LyricLine[] }
