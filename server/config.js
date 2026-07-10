import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
// 可写数据目录：打包后由 Electron 设为 userData；开发时就是项目根。
export const DATA_ROOT = process.env.AURIO_DATA_DIR || ROOT;

const bool = (v) => !!(v && String(v).trim());

// Each feature's config is derived from a flat key/value source (env + saved
// settings). Keeping these as builders lets us recompute at runtime when the
// user saves settings from the UI — no restart needed.
function buildNavidrome(s) {
  return {
    enabled: bool(s.NAVIDROME_URL) && bool(s.NAVIDROME_USER),
    url: (s.NAVIDROME_URL || '').replace(/\/+$/, ''),
    user: s.NAVIDROME_USER || '',
    pass: s.NAVIDROME_PASS || '',
  };
}
function buildNetease(s) {
  return {
    // 内置 NeteaseCloudMusicApi：搜索开箱即用；扫码登录后(cookie)可播放/每日推荐
    enabled: true,
    cookie: s.NETEASE_COOKIE || '',
    loggedIn: bool(s.NETEASE_COOKIE),
    // 稳定的中国大陆 realIP，绕过“设备环境异常”风控（首次自动生成并持久化）
    realIP: s.NETEASE_REAL_IP || '',
  };
}
function buildQQ(s) {
  return {
    // 内置 QQ 音乐公共接口：搜索/歌词开箱即用；播放按 QQ vkey 权限返回，
    // 版权/VIP 曲可能没有可播 URL。QQ_API_URL 仍可选，作为自部署实例兜底。
    enabled: true,
    apiUrl: (s.QQ_API_URL || '').replace(/\/+$/, ''),
    cookie: s.QQ_COOKIE || '', // 可选：QQ Cookie 可用于更完整的权益/音质
  };
}
function buildFish(s) {
  return {
    enabled: bool(s.FISH_API_KEY),
    apiKey: s.FISH_API_KEY || '',
    referenceId: s.FISH_REFERENCE_ID || '',
    model: s.FISH_MODEL || 's2-pro',
    apiBaseUrl: (s.FISH_API_BASE_URL || 'https://api.fish.audio').replace(/\/+$/, ''),
  };
}
// 豆包语音（火山引擎大模型语音合成）：情感中文音色的可选云端 provider。
// Defaults target the late-night radio break — a warm 深夜播客 voice, slightly
// slower than neutral — because the DJ speaks 1–2 short sentences between songs.
function buildDoubao(s) {
  const speed = Number(s.DOUBAO_TTS_SPEED);
  return {
    enabled: bool(s.DOUBAO_TTS_APPID) && bool(s.DOUBAO_TTS_TOKEN),
    appid: s.DOUBAO_TTS_APPID || '',
    token: s.DOUBAO_TTS_TOKEN || '',
    cluster: s.DOUBAO_TTS_CLUSTER || 'volcano_tts',
    voiceType: s.DOUBAO_TTS_VOICE_TYPE || 'zh_male_shenyeboke_emo_v2_mars_bigtts',
    speed: Number.isFinite(speed) && speed > 0 ? speed : 0.9, // API 范围 0.8–2.0
    emotion: s.DOUBAO_TTS_EMOTION || '', // 留空 = 音色本身的电台语气
  };
}
function buildVoice(s) {
  const tencentReady = bool(s.TENCENT_SECRET_ID || s.TENCENTCLOUD_SECRET_ID)
    && bool(s.TENCENT_SECRET_KEY || s.TENCENTCLOUD_SECRET_KEY);
  const doubaoReady = bool(s.DOUBAO_TTS_APPID) && bool(s.DOUBAO_TTS_TOKEN);
  const provider = s.VOICE_PROVIDER || s.TTS_PROVIDER || 'system';
  return {
    provider,
    enabled: provider === 'system'
      || (provider === 'tencent' && tencentReady)
      || (provider === 'fish' && bool(s.FISH_API_KEY))
      || (provider === 'doubao' && doubaoReady),
    system: {
      voice: s.SYSTEM_TTS_VOICE || 'Tingting',
    },
    tencent: {
      secretId: s.TENCENT_SECRET_ID || s.TENCENTCLOUD_SECRET_ID || '',
      secretKey: s.TENCENT_SECRET_KEY || s.TENCENTCLOUD_SECRET_KEY || '',
      region: s.TENCENT_TTS_REGION || 'ap-guangzhou',
      voiceType: Number(s.TENCENT_TTS_VOICE_TYPE || 1001),
    },
  };
}
function buildWeather(s) {
  return {
    enabled: bool(s.OPENWEATHER_KEY),
    key: s.OPENWEATHER_KEY || '',
    lat: s.WEATHER_LAT || '',
    lon: s.WEATHER_LON || '',
    city: s.WEATHER_CITY || '',
  };
}
// The AI "brain" provider. `provider` selects the strategy:
//   'claude' | 'codex' | 'cli'  → spawn a local CLI (uses that tool's own login)
//   'api'                        → HTTP call (kind: 'openai'-compatible | 'anthropic')
// Defaults to the local `claude` CLI so existing setups keep working untouched.
function buildAi(s) {
  return {
    provider: s.AI_PROVIDER || 'claude',
    cli: {
      bin: s.AI_CLI_BIN || '',                 // override the binary (else preset default)
      model: s.CLAUDE_MODEL || s.AI_CLI_MODEL || '',
      forceLogin: String(s.CLAUDE_FORCE_LOGIN || '').toLowerCase() === 'true',
    },
    api: {
      kind: s.AI_API_KIND || 'openai',         // 'openai' (compatible) | 'anthropic'
      baseUrl: (s.AI_API_BASE_URL || '').replace(/\/+$/, ''),
      apiKey: s.AI_API_KEY || '',
      model: s.AI_API_MODEL || '',
    },
  };
}
// Station imaging (sonic logo / liners / hourly ID). On by default — it costs
// nothing (no LLM; TTS is cached) and is the station's identity. IMAGING_ENABLED
// only turns it off when explicitly 'false'.
function buildImaging(s) {
  const raw = s.IMAGING_ENABLED;
  const enabled = raw === undefined || raw === null || raw === ''
    ? true
    : String(raw).toLowerCase() !== 'false';
  const min = Number(s.IMAGING_LINER_INTERVAL_MIN);
  return {
    enabled,
    linerIntervalMin: Number.isFinite(min) && min > 0 ? min : 25,
  };
}
function buildCalendars(s) {
  return {
    feishu: {
      enabled: bool(s.FEISHU_APP_ID) && bool(s.FEISHU_APP_SECRET),
      appId: s.FEISHU_APP_ID || '',
      appSecret: s.FEISHU_APP_SECRET || '',
      calendarId: s.FEISHU_CALENDAR_ID || 'primary',
    },
    dingtalk: {
      enabled: bool(s.DINGTALK_APP_KEY) && bool(s.DINGTALK_APP_SECRET),
      appKey: s.DINGTALK_APP_KEY || '',
      appSecret: s.DINGTALK_APP_SECRET || '',
    },
    wecom: {
      enabled: bool(s.WECOM_CORP_ID) && bool(s.WECOM_SECRET),
      corpId: s.WECOM_CORP_ID || '',
      secret: s.WECOM_SECRET || '',
      agentId: s.WECOM_AGENT_ID || '',
    },
    ics: (() => {
      const urls = (s.CALENDAR_ICS_URLS || '').split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
      const files = (s.CALENDAR_ICS_FILES || '').split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
      return { enabled: urls.length > 0 || files.length > 0, urls, files };
    })(),
  };
}

export const config = {
  root: ROOT,
  port: Number(process.env.PORT || 8080),
  // UI/host locale. The persona and voice bible stay Chinese, but date
  // formatting and weather language follow this so an English shell doesn't
  // wrap a host who errors in Chinese.
  locale: process.env.AURIO_LOCALE || 'zh-CN',
  claude: {
    bin: process.env.CLAUDE_BIN || 'claude',
    model: process.env.CLAUDE_MODEL || '',
    // Force Max/OAuth-login mode by stripping any inherited API key / auth token
    // from the child env (fixes "401 Invalid bearer token" when a stray
    // ANTHROPIC_AUTH_TOKEN is present in the environment).
    forceLogin: String(process.env.CLAUDE_FORCE_LOGIN || '').toLowerCase() === 'true',
  },
  navidrome: buildNavidrome(process.env),
  netease: buildNetease(process.env),
  qq: buildQQ(process.env),
  fish: buildFish(process.env),
  doubao: buildDoubao(process.env),
  voice: buildVoice(process.env),
  weather: buildWeather(process.env),
  imaging: buildImaging(process.env),
  calendars: buildCalendars(process.env),
  ai: buildAi(process.env),
};

// Merge saved settings over env and recompute. Settings take priority over env.
// Modules read config.<feature>.<field> at call time, so updates apply live.
export function applyOverrides(overrides = {}) {
  const s = { ...process.env, ...overrides };
  config.locale = s.AURIO_LOCALE || 'zh-CN';
  config.navidrome = buildNavidrome(s);
  config.netease = buildNetease(s);
  config.qq = buildQQ(s);
  config.fish = buildFish(s);
  config.doubao = buildDoubao(s);
  config.voice = buildVoice(s);
  config.weather = buildWeather(s);
  config.imaging = buildImaging(s);
  config.calendars = buildCalendars(s);
  config.ai = buildAi(s);
}

export function summarize() {
  return {
    port: config.port,
    ai: config.ai.provider,
    navidrome: config.navidrome.enabled,
    netease: config.netease.loggedIn,
    qqmusic: config.qq.enabled,
    fish: config.fish.enabled,
    doubao: config.doubao.enabled,
    voice: config.voice.enabled,
    weather: config.weather.enabled,
    imaging: config.imaging.enabled,
    calendars: Object.fromEntries(
      Object.entries(config.calendars).map(([k, v]) => [k, v.enabled])
    ),
  };
}
