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
import { bus, run, runSegment } from './dj.js';
import * as music from './music/index.js';
import { navidrome } from './music/navidrome.js';
import { ncmLogin, netease } from './music/netease.js';
import { qqmusic } from './music/qqmusic.js';
import { buildProfile, getProfile } from './taste-profile.js';
import { available as brainAvailable, providers as aiProviders, testProvider as aiTest } from './brain/index.js';
import { TTS_CACHE_DIR, testVoice, startTtsCacheGc } from './tts/index.js';
import { testWeather } from './weather/openweather.js';
import { testIcs } from './calendar/ics.js';
import { openCalendarPrivacy, testSystemCalendar } from './calendar/system.js';
import { startScheduler } from './scheduler.js';
import { enabledProviders } from './calendar/index.js';
import { cast } from './cast/upnp.js';
import { onHeartbeat, onClientGone, startRadio, currentIndex } from './radio.js';

load();
loadSettings();

{
  const q = db.getQueue();
  const clean = music.dedupeTracks(q);
  if (clean.length !== q.length) db.setQueue(clean);
}

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

function rejectControl(res, status, error) {
  return res.status(status).json({ ok: false, error });
}

app.use((req, res, next) => {
  if (!ALLOW_LAN && req.path.startsWith('/tts/') && !isLoopback(req)) {
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

// ---- Status / health ----
app.get('/api/session', (req, res) => {
  res.json({ ok: true, token: CONTROL_TOKEN });
});

app.get('/api/status', async (req, res) => {
  const q = music.dedupeTracks(db.getQueue());
  if (q.length !== db.getQueue().length) db.setQueue(q);
  res.json({
    ok: true,
    config: summarize(),
    calendars: enabledProviders(),
    queue: q.length,
    musicSource: music.getMusicSource(),
    sourceModes: music.availableSourceModes(),
    sources: music.sourceServices(),
  });
});

app.get('/api/messages', (req, res) => {
  const limit = Math.max(1, Math.min(200, Number(req.query.limit || 80) || 80));
  res.json({
    messages: db.messages(limit).map((m) => ({
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
    // weather
    'OPENWEATHER_KEY', 'WEATHER_LAT', 'WEATHER_LON', 'WEATHER_CITY',
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
  const result = await runSegment({ kind: 'chat', text }, { mode: 'auto', currentIndex: currentIndex() });
  res.json(result);
});

// ---- Manually fire a scheduled-style beat (plan / morning / mood) ----
app.post('/api/trigger', async (req, res) => {
  const kind = (req.body?.kind || 'mood').toString();
  if (!['plan', 'morning', 'mood', 'station'].includes(kind)) {
    return res.status(400).json({ ok: false, error: 'invalid trigger kind' });
  }
  const result = await run({ kind });
  res.json(result);
});

// ---- Current queue / plan ----
app.get('/api/queue', (req, res) => {
  const q = music.dedupeTracks(db.getQueue());
  if (q.length !== db.getQueue().length) db.setQueue(q);
  res.json({ queue: q });
});

// Replace the queue (reorder / remove / clear from the player UI).
app.post('/api/queue', (req, res) => {
  if (!Array.isArray(req.body?.queue)) return res.status(400).json({ ok: false, error: 'queue must be an array' });
  const q = music.dedupeTracks(req.body.queue);
  db.setQueue(q);
  res.json({ ok: true, queue: q.length });
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

async function proxyAudio(upstreamUrl, req, res, fallbackType = 'audio/mpeg') {
  const upstream = await fetch(upstreamUrl, {
    headers: req.headers.range ? { Range: req.headers.range } : {},
    signal: AbortSignal.timeout(15000),
  });
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
  if (upstream.body) Readable.fromWeb(upstream.body).pipe(res);
  else res.end();
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

// ---- Cover art proxy ----
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
  // Same trust boundary as the control API: the live channel carries the queue,
  // chat patter, and the heartbeat that drives (paid) refills.
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

  const q = music.dedupeTracks(db.getQueue());
  if (q.length !== db.getQueue().length) db.setQueue(q);
  ws.send(JSON.stringify({ type: 'hello', queue: q }));
  // Player → server heartbeat: drives the radio refill engine.
  ws.on('message', (data) => {
    try {
      const m = JSON.parse(data.toString());
      if (m.type === 'state') {
        onHeartbeat({ playingIndex: m.playingIndex, paused: m.paused, queueLen: m.queueLen });
      }
    } catch { /* ignore malformed */ }
  });
  ws.on('close', () => { if (wss.clients.size === 0) onClientGone(); });
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

bus.on('broadcast', (b) => sendAll({ type: 'broadcast', ...b }));
bus.on('tts', (b) => sendAll({ type: 'tts', ...b }));

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
      console.log(`\n  Aurio server  →  http://localhost:${config.port}`);
      console.log('  features:', JSON.stringify(summarize()));
      startScheduler();
      startRadio();
      startTtsCacheGc();
      brainAvailable().then((r) =>
        console.log(`  brain (${config.ai.provider}):  ${r.ok ? 'ready' : 'unavailable — ' + r.detail}`)
      );
      resolve(server);
    });
  });
}

// Run directly (npm run server) vs. imported by Electron. Compare proper file://
// URLs so the check is correct on Windows (backslashes, drive letters) and never
// false-fires for an unrelated entry script that happens to be named index.js.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}
