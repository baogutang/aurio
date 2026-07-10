import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import express from 'express';
import { WebSocketServer } from 'ws';

import { config, summarize, ROOT, DATA_ROOT } from './config.js';
import { db, load } from './store.js';
import { loadSettings, saveSettings, getSettings } from './settings.js';
import { runSegment, isBusy } from './dj.js';
import * as music from './music/index.js';
import { navidrome } from './music/navidrome.js';
import { ncmLogin, netease } from './music/netease.js';
import { qqmusic } from './music/qqmusic.js';
import { buildProfile, getProfile } from './taste-profile.js';
import { available as brainAvailable, providers as aiProviders, testProvider as aiTest } from './brain/index.js';
import { TTS_CACHE_DIR, testVoice, startTtsCacheGc } from './tts/index.js';
import { IMAGING_CACHE_DIR, startImaging } from './imaging.js';
import { testWeather } from './weather/openweather.js';
import { testIcs } from './calendar/ics.js';
import { openCalendarPrivacy, testSystemCalendar } from './calendar/system.js';
import { startScheduler } from './scheduler.js';
import { enabledProviders } from './calendar/index.js';
import { cast } from './cast/upnp.js';
import { hasActiveSession, currentIndex } from './radio.js';
import { station, setListenerGate } from './playout/station.js';
import { wireHorizonKeeper } from './playout/horizon.js';
import { clientSessionManager } from './runtime/client-session-manager.js';
import { eventBus } from './runtime/event-bus.js';
import { recordFeedback, tasteSummary } from './agent/preferences.js';
import { onPlaybackFeedback } from './agent/feedback-reaction.js';
import { registerServer, installSignalHandlers, stopServer } from './shutdown.js';
import { environmentSnapshot } from './context.js';
import { performFirstRun } from './rituals.js';

load();
loadSettings();

const app = express();

// ---- Trust boundary ----
// Control endpoints (settings, chat, trigger, integration tests, profile build…)
// can spend money, rewrite stored secrets, or fetch arbitrary URLs/files. They
// therefore need a stricter boundary than "remoteAddress is loopback": Host and
// Origin must also be local, and the renderer must present the startup session
// token. The read-only media proxies remain LAN-reachable for UPnP/DLNA speakers.
const ALLOW_LAN = String(process.env.AURIO_ALLOW_LAN || '').toLowerCase() === 'true';
const CONTROL_TOKEN = crypto.randomBytes(32).toString('base64url');
const LAN_OPEN_API = /^\/api\/(?:stream|cover|ncm\/stream|qq\/stream)\//;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function isLoopback(req) {
  const ip = (req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  return ip === '127.0.0.1' || ip === '::1';
}

function hostName(value = '') {
  const raw = value.toString().trim();
  if (!raw) return '';
  try {
    return new URL(`http://${raw}`).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  } catch {
    return raw.split(':')[0].replace(/^\[|\]$/g, '').toLowerCase();
  }
}

function isLocalHostName(name = '') {
  return name === 'localhost' || name === '127.0.0.1' || name === '::1';
}

function hasTrustedHost(req) {
  if (ALLOW_LAN) return true;
  return isLocalHostName(hostName(req.headers.host || ''));
}

function hasTrustedOrigin(req) {
  if (ALLOW_LAN) return true;
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const u = new URL(origin);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    return isLocalHostName(u.hostname.replace(/^\[|\]$/g, '').toLowerCase());
  } catch {
    return false;
  }
}

function tokenFrom(req) {
  const header = req.headers['x-aurio-token'];
  if (Array.isArray(header)) return header[0] || '';
  if (header) return String(header);
  try {
    return new URL(req.url || '/', 'http://localhost').searchParams.get('token') || '';
  } catch {
    return '';
  }
}

function hasValidToken(req) {
  return tokenFrom(req) === CONTROL_TOKEN;
}

// Trigger beats land on the shared log: opening the station adds to the
// programme (an empty log self-anchors at now); a mood beat while on air
// steers the future without touching aired history.
function triggerMode(kind) {
  const onAir = !!station.current();
  if (kind === 'mood') return onAir ? 'steer' : 'append';
  return 'append';
}

function rejectControl(res, status, error) {
  return res.status(status).json({ ok: false, error });
}

app.use((req, res, next) => {
  if (!ALLOW_LAN && (req.path.startsWith('/tts/') || req.path.startsWith('/imaging/')) && !isLoopback(req)) {
    return res.status(403).end();
  }

  if (!req.path.startsWith('/api/') || LAN_OPEN_API.test(req.path)) return next();

  if (!ALLOW_LAN && !isLoopback(req)) {
    return rejectControl(res, 403, 'forbidden: control API is restricted to localhost');
  }
  if (!hasTrustedHost(req)) {
    return rejectControl(res, 403, 'forbidden: untrusted Host header');
  }
  if (!hasTrustedOrigin(req)) {
    return rejectControl(res, 403, 'forbidden: untrusted Origin header');
  }
  if (req.path !== '/api/session' && !hasValidToken(req)) {
    return rejectControl(res, 403, 'forbidden: missing session token');
  }
  if (!SAFE_METHODS.has(req.method)) {
    const ct = (req.headers['content-type'] || '').toString().toLowerCase();
    if (!ct.startsWith('application/json')) return rejectControl(res, 415, 'unsupported media type');
  }
  next();
});

app.use(express.json({ limit: '5mb' }));

// ---- Static: the PWA player + cached TTS audio ----
app.use('/', express.static(path.join(ROOT, 'pwa')));
app.use('/tts', express.static(TTS_CACHE_DIR));
// Imaging assets (sonic logo etc.) — same pattern as /tts, generated at startup.
app.use('/imaging', express.static(IMAGING_CACHE_DIR));

// ---- Status / health ----
app.get('/api/session', (req, res) => {
  res.json({ ok: true, token: CONTROL_TOKEN });
});

app.get('/api/status', async (req, res) => {
  const snap = station.join({ upNext: 30 });
  res.json({
    ok: true,
    config: summarize(),
    calendars: enabledProviders(),
    onAir: !!snap.current,
    queue: snap.upNext.length + (snap.current ? 1 : 0),
    horizonMs: station.horizonRemaining(),
    musicSource: music.getMusicSource(),
    sourceModes: music.availableSourceModes(),
    sources: music.sourceServices(),
    playback: clientSessionManager.getPlaybackState(),
    wsClients: clientSessionManager.clientCount(),
    hasActiveSession: hasActiveSession(),
  });
});

app.get('/api/context', async (req, res) => {
  try {
    const snapshot = await environmentSnapshot();
    res.json({ ok: true, ...snapshot });
  } catch (e) {
    res.status(500).json({ ok: false, detail: e instanceof Error ? e.message : String(e) });
  }
});

app.get('/api/health', async (req, res) => {
  let brain = { ok: false };
  try { brain = await brainAvailable(); } catch { /* noop */ }
  res.json({
    ok: true,
    uptime: process.uptime(),
    wsClients: clientSessionManager.clientCount(),
    hasActiveSession: hasActiveSession(),
    onAir: !!station.current(),
    horizonMs: station.horizonRemaining(),
    composing: isBusy(),
    brain,
  });
});

app.get('/api/ready', async (req, res) => {
  let brain = { ok: false };
  try { brain = await brainAvailable(); } catch { /* noop */ }
  const ready = !isBusy();
  res.status(ready ? 200 : 503).json({
    ok: ready,
    onAir: !!station.current(),
    horizonMs: station.horizonRemaining(),
    composing: isBusy(),
    brain,
  });
});

// Builds before 0.4.1 logged a synthetic "用户刚跳过了：…" line on every skip as
// if the listener had typed it. Those rows are still in everyone's store; hide
// them rather than rewriting the user's history.
const SYNTHETIC_USER = /^用户(刚跳过了|不喜欢这首)[：:]/;

app.get('/api/messages', (req, res) => {
  const limit = Math.max(1, Math.min(200, Number(req.query.limit || 80) || 80));
  res.json({
    messages: db.messages(limit)
      .filter((m) => !(m.role === 'user' && SYNTHETIC_USER.test((m.text || '').toString())))
      .map((m) => ({
        role: m.role === 'user' ? 'user' : 'dj',
        text: (m.text || '').toString(),
        ts: m.ts,
      })),
  });
});

app.post('/api/music-source', (req, res) => {
  try {
    music.setMusicSource((req.body?.source || '').toString());
    res.json({ ok: true, musicSource: music.getMusicSource() });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ---- Settings (in-app config: creds, keys, AI, integrations) ----
// Returns non-secret status for every integration (booleans for secrets) so the
// UI can show 已配置/未配置 and pre-fill non-secret fields without leaking keys.
app.get('/api/settings', (req, res) => {
  const cal = config.calendars;
  res.json({
    navidrome: {
      url: config.navidrome.url,
      user: config.navidrome.user,
      hasPass: !!config.navidrome.pass,
      enabled: config.navidrome.enabled,
    },
    netease: { loggedIn: config.netease.loggedIn, realIP: config.netease.realIP },
    qq: { apiUrl: config.qq.apiUrl, enabled: config.qq.enabled, hasCookie: !!config.qq.cookie },
    voice: {
      provider: config.voice.provider,
      enabled: config.voice.enabled,
      system: { voice: config.voice.system.voice },
      tencent: {
        hasSecretId: !!config.voice.tencent.secretId,
        hasSecretKey: !!config.voice.tencent.secretKey,
        region: config.voice.tencent.region,
        voiceType: String(config.voice.tencent.voiceType),
      },
    },
    ai: {
      provider: config.ai.provider,
      cli: { bin: config.ai.cli.bin, model: config.ai.cli.model, forceLogin: config.ai.cli.forceLogin },
      api: { kind: config.ai.api.kind, baseUrl: config.ai.api.baseUrl, model: config.ai.api.model, hasKey: !!config.ai.api.apiKey },
    },
    fish: { hasKey: config.fish.enabled, referenceId: config.fish.referenceId },
    weather: { hasKey: !!config.weather.key, city: config.weather.city, lat: config.weather.lat, lon: config.weather.lon, enabled: config.weather.enabled },
    imaging: { enabled: config.imaging.enabled, linerIntervalMin: config.imaging.linerIntervalMin },
    calendars: {
      system: { enabled: process.platform === 'darwin' },
      ics: { urls: (cal.ics?.urls || []).join('\n'), files: cal.ics?.files || [], enabled: !!cal.ics?.enabled },
      feishu: { appId: cal.feishu.appId, hasSecret: !!cal.feishu.appSecret, calendarId: cal.feishu.calendarId, enabled: cal.feishu.enabled },
      dingtalk: { appKey: cal.dingtalk.appKey, hasSecret: !!cal.dingtalk.appSecret, configured: cal.dingtalk.enabled, enabled: false },
      wecom: { corpId: cal.wecom.corpId, hasSecret: !!cal.wecom.secret, agentId: cal.wecom.agentId, configured: cal.wecom.enabled, enabled: false },
    },
    onboarded: !!getSettings().ONBOARDED,
  });
});

app.post('/api/settings/test-navidrome', async (req, res) => {
  const { url, user } = req.body || {};
  let pass = req.body?.pass;
  if (pass === undefined || pass === '') pass = config.navidrome.pass; // reuse stored
  res.json(await navidrome.testConnection({ url, user, pass }));
});

// Test QQ Music. Without QQ_API_URL this checks the built-in public adapter;
// with QQ_API_URL it still verifies the optional self-hosted fallback instance.
app.post('/api/settings/test-qq', async (req, res) => {
  const apiUrl = ((req.body?.QQ_API_URL || config.qq.apiUrl) || '').replace(/\/+$/, '');
  if (!apiUrl) {
    try {
      const hits = await qqmusic.search('周杰伦', 1);
      return res.json({ ok: hits.length > 0, detail: hits.length > 0 ? '内置 QQ 音乐搜索可用' : '内置 QQ 音乐连通但没有结果' });
    } catch (e) {
      return res.json({ ok: false, detail: e.name === 'TimeoutError' ? '连接超时' : e.message });
    }
  }
  try {
    const u = new URL(apiUrl + '/search');
    u.searchParams.set('key', '周杰伦');
    u.searchParams.set('pageSize', '1');
    const r = await fetch(u, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return res.json({ ok: false, detail: `实例返回 HTTP ${r.status}` });
    const b = await r.json();
    const n = (b?.data?.list || b?.data?.song?.list || b?.data?.songs || []).length;
    return res.json({ ok: n > 0, detail: n > 0 ? '连接成功，可以搜索' : '连通但无搜索结果（检查实例接口路径）' });
  } catch (e) {
    return res.json({ ok: false, detail: e.name === 'TimeoutError' ? '连接超时' : e.message });
  }
});

// Per-integration tests (candidate values in body, fall back to saved). All
// return { ok, detail } so the UI can show one consistent success/error line.
app.post('/api/settings/test-fish', async (req, res) => {
  const b = req.body || {};
  res.json(await testVoice(b));
});
app.post('/api/settings/test-weather', async (req, res) => {
  const b = req.body || {};
  res.json(await testWeather({ key: b.OPENWEATHER_KEY, city: b.WEATHER_CITY, lat: b.WEATHER_LAT, lon: b.WEATHER_LON }));
});
app.post('/api/settings/test-calendar', async (req, res) => {
  const b = req.body || {};
  res.json(await testIcs(b.CALENDAR_ICS_URLS || '', b.CALENDAR_ICS_FILES || config.calendars.ics.files || []));
});

app.post('/api/calendar/system/test', async (req, res) => {
  res.json(await testSystemCalendar());
});

app.post('/api/calendar/system/open-privacy', (req, res) => {
  res.json({ ok: openCalendarPrivacy(), detail: '已打开系统日历授权设置' });
});

app.post('/api/calendar/import', (req, res) => {
  const name = (req.body?.name || 'calendar.ics').toString();
  const content = (req.body?.content || '').toString();
  if (!content.trim()) return res.status(400).json({ ok: false, detail: '文件内容为空' });
  if (content.length > 4 * 1024 * 1024) return res.status(400).json({ ok: false, detail: '文件太大，请控制在 4MB 内' });
  const dir = path.join(DATA_ROOT, 'data', 'calendar-imports');
  fs.mkdirSync(dir, { recursive: true });
  const safeBase = name.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'calendar.ics';
  const hash = crypto.createHash('sha1').update(content).digest('hex').slice(0, 10);
  const file = path.join(dir, `${hash}-${safeBase.endsWith('.ics') ? safeBase : `${safeBase}.ics`}`);
  fs.writeFileSync(file, content);
  const existing = config.calendars.ics.files || [];
  const files = Array.from(new Set([...existing, file]));
  try {
    saveSettings({ CALENDAR_ICS_FILES: files.join('\n') });
  } catch (e) {
    return res.status(500).json({ ok: false, detail: e.message });
  }
  res.json({ ok: true, detail: `已导入 ${name}`, files });
});

app.post('/api/settings', (req, res) => {
  const body = req.body || {};
  const allowed = [
    // music sources
    'NAVIDROME_URL', 'NAVIDROME_USER', 'NAVIDROME_PASS',
    'NETEASE_COOKIE', 'NETEASE_REAL_IP',
    'QQ_API_URL', 'QQ_COOKIE',
    // AI brain
    'AI_PROVIDER', 'AI_CLI_BIN', 'AI_CLI_MODEL', 'CLAUDE_MODEL', 'CLAUDE_FORCE_LOGIN',
    'AI_API_KIND', 'AI_API_BASE_URL', 'AI_API_KEY', 'AI_API_MODEL',
    // voice
    'VOICE_PROVIDER', 'TTS_PROVIDER', 'SYSTEM_TTS_VOICE',
    'TENCENT_SECRET_ID', 'TENCENT_SECRET_KEY', 'TENCENTCLOUD_SECRET_ID', 'TENCENTCLOUD_SECRET_KEY',
    'TENCENT_TTS_REGION', 'TENCENT_TTS_VOICE_TYPE',
    'FISH_API_KEY', 'FISH_REFERENCE_ID', 'FISH_MODEL', 'FISH_API_BASE_URL',
    'DOUBAO_TTS_APPID', 'DOUBAO_TTS_TOKEN', 'DOUBAO_TTS_CLUSTER',
    'DOUBAO_TTS_VOICE_TYPE', 'DOUBAO_TTS_SPEED', 'DOUBAO_TTS_EMOTION',
    // weather
    'OPENWEATHER_KEY', 'WEATHER_LAT', 'WEATHER_LON', 'WEATHER_CITY',
    // station imaging (sonic logo / liners / hourly ID)
    'IMAGING_ENABLED', 'IMAGING_LINER_INTERVAL_MIN',
    // calendars
    'CALENDAR_ICS_URLS', 'CALENDAR_ICS_FILES',
    'FEISHU_APP_ID', 'FEISHU_APP_SECRET', 'FEISHU_CALENDAR_ID',
    'DINGTALK_APP_KEY', 'DINGTALK_APP_SECRET',
    'WECOM_CORP_ID', 'WECOM_SECRET', 'WECOM_AGENT_ID',
    // onboarding flag
    'ONBOARDED',
  ];
  const partial = {};
  for (const k of allowed) if (k in body) partial[k] = body[k];
  try {
    saveSettings(partial);
    res.json({ ok: true, config: summarize() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---- AI brain: list providers (+ detected local CLIs) and test one ----
app.get('/api/ai/providers', async (req, res) => {
  res.json(await aiProviders());
});
app.post('/api/ai/test', async (req, res) => {
  // Test candidate settings without saving: merge body over current config.
  res.json(await aiTest(req.body || {}));
});

// ---- UPnP / DLNA casting to home speakers ----
app.get('/api/cast/devices', async (req, res) => {
  try { res.json({ devices: await cast.discover() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/cast/play', async (req, res) => {
  const track = req.body?.track || {};
  const deviceId = (req.body?.deviceId || '').toString();
  try {
    // Resolve a LAN-reachable absolute URL the speaker can fetch.
    const streamUrl = await music.castUrl(track);
    if (!streamUrl) return res.status(400).json({ ok: false, error: '无法解析可投放的播放地址' });
    res.json(await cast.playTo(deviceId, { streamUrl, title: track.title, artist: track.artist }));
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
app.post('/api/cast/control', async (req, res) => {
  const { deviceId, action } = req.body || {};
  try { res.json(await cast.control((deviceId || '').toString(), (action || '').toString())); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
app.post('/api/cast/volume', async (req, res) => {
  const { deviceId, pct } = req.body || {};
  try { res.json(await cast.volume((deviceId || '').toString(), Number(pct))); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ---- 网易云扫码登录 ----
app.get('/api/ncm/login/qr', async (req, res) => {
  try {
    const key = await ncmLogin.qrKey();
    if (!key) return res.json({ error: '获取二维码失败' });
    const img = await ncmLogin.qrCreate(key);
    if (!img) return res.json({ error: '生成二维码失败' });
    res.json({ key, img });
  } catch (e) { res.json({ error: e.message }); }
});

app.get('/api/ncm/login/check', async (req, res) => {
  const key = (req.query.key || '').toString();
  if (!key) return res.json({ status: 'expired' });
  try {
    const body = await ncmLogin.qrCheck(key);
    const code = body?.code;
    if (code === 803) {                 // 授权成功
      saveSettings({ NETEASE_COOKIE: body.cookie || '' });
      const prof = await ncmLogin.profile(body.cookie || '');
      return res.json({ status: 'authorized', nickname: prof?.nickname || '' });
    }
    if (code === 800) return res.json({ status: 'expired' });
    if (code === 802) return res.json({ status: 'scanned' });
    return res.json({ status: 'waiting' });
  } catch { res.json({ status: 'waiting' }); }
});

// ---- 品味画像：扫描曲库生成 / 读取 ----
let profileBuilding = false;
app.post('/api/profile/build', (req, res) => {
  if (profileBuilding) return res.json({ started: false, busy: true });
  profileBuilding = true;
  res.json({ started: true });
  buildProfile((p) => sendAll({ type: 'profile', ...p }))
    .catch((e) => sendAll({ type: 'profile', error: e.message, pct: 100 }))
    .finally(() => { profileBuilding = false; });
});
app.get('/api/profile', (req, res) => res.json(getProfile()));
app.get('/api/taste', (req, res) => res.json({ ok: true, ...tasteSummary() }));

// ---- Music search ----
app.get('/api/search', async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) return res.json({ results: [] });
  try { res.json({ results: await music.search(q, 12) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- Lyrics for a track (synced LRC → time-stamped lines) ----
app.get('/api/lyrics', async (req, res) => {
  const source = (req.query.source || '').toString();
  const id = (req.query.id || '').toString();
  const title = (req.query.title || '').toString();
  const artist = (req.query.artist || '').toString();
  if (!source) return res.status(400).json({ ok: false, error: 'missing source' });
  try {
    const r = await music.lyricsLines({ source, id, title, artist });
    res.json({ ok: true, source, ...r });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---- Talk to the DJ ----
app.post('/api/chat', async (req, res) => {
  const text = (req.body?.text || '').toString().trim();
  if (!text) return res.status(400).json({ error: 'empty' });
  try {
    const result = await runSegment({ kind: 'chat', text }, { mode: 'auto', currentIndex: currentIndex() });
    res.json(result);
  } catch (e) {
    console.error('[chat] segment failed:', e);
    res.json({ ok: false, error: e?.message || String(e), say: '我这边刚才卡了一下，别急，播放还在。' });
  }
});

// ---- Manually fire a scheduled-style beat (plan / morning / mood) ----
// 'first-run' is the 开台仪式 (RADIO_VISION §六): performed at most once per
// data dir — the guard and the library-scan fact live in server/rituals.js.
app.post('/api/trigger', async (req, res) => {
  const kind = (req.body?.kind || 'mood').toString();
  if (!['plan', 'morning', 'mood', 'station', 'first-run'].includes(kind)) {
    return res.status(400).json({ ok: false, error: 'invalid trigger kind' });
  }
  try {
    const result = kind === 'first-run'
      ? await performFirstRun({ runSegment, currentIndex: currentIndex() })
      : await runSegment({ kind }, { mode: triggerMode(kind), currentIndex: currentIndex() });
    res.json(result);
  } catch (e) {
    console.error('[trigger] segment failed:', e);
    res.json({ ok: false, error: e?.message || String(e), say: '刚才这一段没接稳，我先保持当前播放。' });
  }
});

// ---- The programme (what is on air right now + what's coming) ----
app.get('/api/programme', (req, res) => {
  const upNext = Math.max(1, Math.min(30, Number(req.query.upNext || 5) || 5));
  res.json({ ok: true, ...station.join({ upNext }) });
});

// Skip is a server log operation: the on-air item ends now, for everyone.
app.post('/api/skip', (req, res) => {
  station.skip();
  res.json({ ok: true, ...station.join() });
});

app.get('/api/plan/today', (req, res) => res.json({ plan: db.getPlan() }));

// ---- Record a play (renderer tells us when a track actually starts) ----
app.post('/api/played', (req, res) => {
  const t = req.body || {};
  if (!t.id) return res.status(400).json({ error: 'no id' });
  db.addPlay(t);
  if (t.source === 'navidrome') navidrome.scrobble(t.id);
  res.json({ ok: true });
});

app.post('/api/playback-event', (req, res) => {
  const { event, track, position_sec, queue_index } = req.body || {};
  const allowed = new Set(['started', 'completed', 'skipped', 'replayed', 'like', 'dislike']);
  if (!allowed.has(event) || !track?.id) {
    return res.status(400).json({ ok: false, error: 'invalid playback event' });
  }
  const signal = event === 'like' ? 'like' : event === 'dislike' ? 'dislike' : event;
  recordFeedback({ signal, track, position_sec, queue_index });
  onPlaybackFeedback({ signal, track, position_sec });
  res.json({ ok: true });
});

async function proxyAudio(upstreamUrl, req, res, fallbackType = 'audio/mpeg') {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  let upstream;
  try {
    upstream = await fetch(upstreamUrl, {
      headers: req.headers.range ? { Range: req.headers.range } : {},
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timeout);
    return res.status(502).json({ error: e.message || 'upstream fetch failed' });
  } finally {
    clearTimeout(timeout);
  }

  if (!upstream) return res.status(502).json({ error: 'upstream unavailable' });
  const ct = upstream.headers.get('content-type') || fallbackType;
  if (!upstream.ok) {
    res.status(upstream.status);
    return res.end();
  }
  if (ct && !/^(audio\/|video\/|application\/octet-stream)/i.test(ct)) {
    return res.status(502).json({ error: 'upstream did not return media' });
  }
  res.status(upstream.status);
  for (const h of ['content-type', 'content-length', 'accept-ranges', 'content-range']) {
    const v = h === 'content-type' ? ct : upstream.headers.get(h);
    if (v) res.setHeader(h, v);
  }
  res.on('close', () => controller.abort());
  if (upstream.body) {
    const stream = Readable.fromWeb(upstream.body);
    stream.on('error', (e) => {
      if (!res.destroyed) res.destroy(e);
    });
    stream.pipe(res);
  } else {
    res.end();
  }
}

// ---- Stream proxy: hides Navidrome creds, supports Range for seeking ----
app.get('/api/stream/:id', async (req, res) => {
  if (!navidrome.enabled()) return res.status(404).end();
  try {
    await proxyAudio(navidrome.streamUrl(req.params.id), req, res);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ---- Netease stream proxy: makes playback *same-origin* (so the Web Audio
// waveform works and audio isn't silenced as cross-origin) + supports Range.
// The signed CDN URL is resolved fresh here, avoiding expiry from queue time.
app.get('/api/ncm/stream/:id', async (req, res) => {
  try {
    const url = await netease.streamUrl(req.params.id);
    if (!url) return res.status(404).json({ error: '版权受限或无法解析播放地址' });
    await proxyAudio(url, req, res);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ---- QQ stream proxy: same-origin playback (cross-origin CDN) + Range. ----
app.get('/api/qq/stream/:id', async (req, res) => {
  try {
    const url = await qqmusic.streamUrl(req.params.id);
    if (!url) return res.status(404).json({ error: '版权受限或无法解析播放地址' });
    await proxyAudio(url, req, res);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ---- Cover art proxy (same-origin image bytes) ----
// The client extracts colours from a <canvas>, so a cross-origin image would
// taint it. We resolve art *server-side* from (source, id) and never accept a
// caller-supplied URL (that would be an SSRF hole). Bounded FIFO cache of the
// resolved upstream URLs; 404 (never 500) when there is no art.
const coverUrlCache = new Map(); // `${source}:${id}` -> resolved image URL
const COVER_CACHE_MAX = 200;

function cacheCoverUrl(key, url) {
  if (coverUrlCache.has(key)) coverUrlCache.delete(key);
  coverUrlCache.set(key, url);
  while (coverUrlCache.size > COVER_CACHE_MAX) {
    coverUrlCache.delete(coverUrlCache.keys().next().value);
  }
}

async function resolveCoverUrl(source, id) {
  const key = `${source}:${id}`;
  if (coverUrlCache.has(key)) return coverUrlCache.get(key);
  let url = null;
  if (source === 'navidrome') {
    if (navidrome.enabled()) url = navidrome.coverUrl(id, 512);
  } else if (source === 'netease') {
    url = await netease.coverArt(id);
  }
  // qqmusic: the cover lives at albumMid, which we can't derive from a bare
  // songMid without extra per-song state — resolve to 404 rather than hack it.
  if (url) cacheCoverUrl(key, url);
  return url;
}

app.get('/api/cover/:source/:id', async (req, res) => {
  const source = (req.params.source || '').toString();
  const id = (req.params.id || '').toString();
  if (!['navidrome', 'netease', 'qqmusic'].includes(source)) return res.status(404).end();
  let url = null;
  try { url = await resolveCoverUrl(source, id); } catch { url = null; }
  if (!url) return res.status(404).end();
  try {
    const upstream = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!upstream.ok) return res.status(404).end();
    const ct = upstream.headers.get('content-type') || 'image/jpeg';
    if (!/^image\//i.test(ct)) return res.status(404).end();
    res.status(200);
    res.setHeader('content-type', ct);
    res.setHeader('cache-control', 'public, max-age=86400');
    if (upstream.body) Readable.fromWeb(upstream.body).pipe(res);
    else res.end();
  } catch {
    res.status(404).end();
  }
});

// ---- Cover art proxy (legacy single-id, Navidrome only) ----
app.get('/api/cover/:id', async (req, res) => {
  if (!navidrome.enabled()) return res.status(404).end();
  try {
    const upstream = await fetch(navidrome.coverUrl(req.params.id, 400), { signal: AbortSignal.timeout(10000) });
    res.status(upstream.status);
    const ct = upstream.headers.get('content-type');
    if (upstream.ok && ct && !ct.toLowerCase().startsWith('image/')) return res.status(502).end();
    if (ct) res.setHeader('content-type', ct);
    if (upstream.body) Readable.fromWeb(upstream.body).pipe(res);
    else res.end();
  } catch (e) {
    res.status(502).end();
  }
});

// ---- HTTP + WebSocket ----
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/stream' });

wss.on('connection', (ws, req) => {
  if (
    (!ALLOW_LAN && !isLoopback(req))
    || !hasTrustedHost(req)
    || !hasTrustedOrigin(req)
    || !hasValidToken(req)
  ) {
    try { ws.close(1008, 'forbidden'); } catch { /* noop */ }
    return;
  }

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  const { clientId } = clientSessionManager.register(ws, { userAgent: req.headers['user-agent'] });
  ws.clientId = clientId;

  // Join in progress: the client receives the on-air item + media offset +
  // what's coming, and starts playback AT THE OFFSET. Everything after this
  // is a delta-shaped push of the same snapshot.
  ws.send(JSON.stringify({ type: 'hello', clientId }));
  ws.send(JSON.stringify({ type: 'programme', reason: 'join', ...station.join() }));
  // A listener arriving un-parks the horizon keeper (and turns the brain on).
  horizonKeeper?.poke({ reset: true });

  ws.on('message', (data) => {
    try {
      const m = JSON.parse(data.toString());
      if (m.type === 'state') {
        clientSessionManager.onHeartbeat(clientId, {
          paused: m.paused,
          currentTrack: m.currentTrack,
          itemId: m.itemId,
          positionSec: m.positionSec,
          durationSec: m.durationSec,
        });
      } else if (m.type === 'op' && m.op === 'skip') {
        station.skip();
      }
    } catch { /* ignore malformed */ }
  });
  ws.on('close', () => {
    clientSessionManager.unregister(clientId);
  });
});

// Reap dead sockets (laptop sleep, network drop, killed tab) so the radio engine
// stops composing — and stops spending — when nobody is actually listening. The
// browser answers protocol-level pings automatically, so this needs no client code.
const wsPing = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch { /* noop */ }
  }
}, 30000);
// Don't let this timer alone keep the process alive (a listening server already
// does) — so merely importing this module, e.g. in CI smoke tests, still exits.
if (wsPing.unref) wsPing.unref();
wss.on('close', () => clearInterval(wsPing));

function sendAll(obj) {
  const msg = JSON.stringify(obj);
  for (const ws of wss.clients) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

// Programme deltas: every log change ships a fresh join() snapshot with the
// reason attached — the client has ONE reconcile path instead of five modes.
eventBus.on('programme', ({ reason }) => {
  if (!wss.clients.size) return;
  sendAll({ type: 'programme', reason, ...station.join() });
});

// Transient spoken lines (chat answers, scheduled beats) — talked over the
// bed now, not part of the timeline.
eventBus.on('say', (s) => sendAll({ type: 'say', ...s }));

// The horizon keeper is wired at startup (station + dj + music recommend).
let horizonKeeper = null;

export function startServer() {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('error', onError);
      wss.off('error', onError);
      reject(error);
    };
    server.once('error', onError);
    wss.once('error', onError);
    server.listen(config.port, async () => {
      server.off('error', onError);
      wss.off('error', onError);
      registerServer(server, wss);
      installSignalHandlers();
      console.log(`\n  Aurio server  →  http://localhost:${config.port}`);
      console.log('  features:', JSON.stringify(summarize()));
      // The playout timeline is authoritative: restore the log, start the
      // cursor (it advances whether or not anyone connects), gate spend on the
      // listener roster, and keep the horizon fed.
      setListenerGate(() => clientSessionManager.hasActiveSession());
      station.start();
      horizonKeeper = wireHorizonKeeper({
        station,
        runSegment,
        recommend: music.recommend,
        playbackUrl: music.playbackUrl,
        hasListener: () => clientSessionManager.hasActiveSession(),
      });
      horizonKeeper.poke();
      startScheduler();
      startImaging();
      startTtsCacheGc();
      brainAvailable().then((r) =>
        console.log(`  brain (${config.ai.provider}):  ${r.ok ? 'ready' : 'unavailable — ' + r.detail}`)
      );
      resolve(server);
    });
  });
}

export { stopServer };

// Run directly (npm run server) vs. imported by Electron.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}
