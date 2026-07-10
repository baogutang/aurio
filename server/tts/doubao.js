// 豆包语音（火山引擎大模型语音合成）— the emotional-voice cloud option. One plain
// HTTPS POST with a bearer token (no request signing) returns base64 mp3, cached
// on disk by content hash and served at /tts/<hash>.mp3. Degrades gracefully: if
// appid/token are missing or the request fails, returns null and the player just
// shows the text. The default voice is 深夜播客 — a warm late-night podcast
// register that fits a DJ murmuring one or two short sentences between songs.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config, DATA_ROOT } from '../config.js';

const CACHE_DIR = path.join(DATA_ROOT, 'cache', 'tts');
const DEFAULT_TTS_TEXT = '你好，我是 Aurio，你的私人电台主播。';
const API_URL = 'https://openspeech.bytedance.com/api/v1/tts';

function ensureDir() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// Voice, emotion and speed all change the audio, so they are part of the key.
function hashFor(text) {
  const d = config.doubao;
  return crypto.createHash('sha1')
    .update(`doubao::${d.voiceType}::${d.emotion}::${d.speed}::${text}`)
    .digest('hex');
}

function explainFetchError(e) {
  const code = e?.cause?.code || '';
  const cause = e?.cause?.message || '';
  const msg = [e?.message, cause, code].filter(Boolean).join(' ');
  if (e?.name === 'TimeoutError') return '请求豆包语音超时，请稍后再试或检查网络/代理。';
  if (/UND_ERR_CONNECT_TIMEOUT|Connect Timeout/i.test(msg)) {
    return '无法连接豆包语音：连接 openspeech.bytedance.com 超时。请检查网络/代理。';
  }
  if (/ENOTFOUND|EAI_AGAIN/i.test(msg)) return '无法解析豆包语音域名，请检查 DNS 或网络。';
  if (/ECONNREFUSED|ECONNRESET|ETIMEDOUT|fetch failed/i.test(msg)) return `无法连接豆包语音：${code || e.message}`;
  return e?.message || '豆包语音请求失败';
}

async function requestTts({ appid, token, cluster, voiceType, speed, emotion, text }) {
  const audio = {
    voice_type: voiceType,
    encoding: 'mp3',
    speed_ratio: speed,
  };
  // Only the multi-emotion (emo_v2) voices accept an emotion; when unset we let
  // the voice speak in its native register (深夜播客 already sounds like radio).
  if (emotion) {
    audio.enable_emotion = true;
    audio.emotion = emotion;
  }
  const payload = {
    app: { appid, token, cluster },
    user: { uid: 'aurio' },
    audio,
    request: { reqid: crypto.randomUUID(), text, operation: 'query' },
  };
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      // 豆包的鉴权格式：Bearer 与 token 之间用分号分隔（官方文档如此）。
      Authorization: `Bearer;${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error('豆包语音 Access Token 无效或没有权限');
  }
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200);
    throw new Error(`豆包语音 HTTP ${res.status}: ${detail}`);
  }
  const body = await res.json();
  if (body?.code !== 3000 || !body?.data) {
    throw new Error(`豆包语音合成失败（code ${body?.code ?? '无'}）：${body?.message || '未返回音频'}`);
  }
  return Buffer.from(body.data, 'base64');
}

export function cachedSynthesis(text) {
  if (!config.doubao.enabled || !text || !text.trim()) return null;
  ensureDir();
  const hash = hashFor(text);
  const file = path.join(CACHE_DIR, `${hash}.mp3`);
  const url = `/tts/${hash}.mp3`;

  if (fs.existsSync(file)) return { url, cached: true };
  return null;
}

// Returns { url, cached } or null when TTS is unavailable.
export async function synthesize(text) {
  const cached = cachedSynthesis(text);
  if (cached) return cached;
  if (!config.doubao.enabled || !text || !text.trim()) return null;
  ensureDir();
  const hash = hashFor(text);
  const file = path.join(CACHE_DIR, `${hash}.mp3`);
  const url = `/tts/${hash}.mp3`;

  try {
    const buf = await requestTts({
      appid: config.doubao.appid,
      token: config.doubao.token,
      cluster: config.doubao.cluster,
      voiceType: config.doubao.voiceType,
      speed: config.doubao.speed,
      emotion: config.doubao.emotion,
      text,
    });
    fs.writeFileSync(file, buf);
    return { url, cached: false };
  } catch (e) {
    console.error('[tts]', explainFetchError(e));
    return null;
  }
}

// Settings "试听" test: synthesize a short sample with candidate (or saved) creds.
// Returns { ok, detail, url? } — url is a playable /tts/*.mp3 the UI can audition.
export async function testVoice({ appid, token, voiceType, emotion, speed, text } = {}) {
  appid = appid || config.doubao.appid;
  token = token || config.doubao.token;
  voiceType = voiceType || config.doubao.voiceType;
  emotion = emotion !== undefined && emotion !== null ? emotion : config.doubao.emotion;
  const speedNum = Number(speed);
  speed = Number.isFinite(speedNum) && speedNum > 0 ? speedNum : config.doubao.speed;
  text = (text && text.trim()) || DEFAULT_TTS_TEXT;
  if (!appid || !token) return { ok: false, detail: '缺少豆包语音 AppID 或 Access Token' };
  ensureDir();
  try {
    const buf = await requestTts({
      appid, token, cluster: config.doubao.cluster, voiceType, speed, emotion, text,
    });
    const hash = crypto.createHash('sha1').update(`test::${voiceType}::${emotion}::${speed}::${text}`).digest('hex');
    fs.writeFileSync(path.join(CACHE_DIR, `${hash}.mp3`), buf);
    return { ok: true, detail: '合成成功，正在试听…', url: `/tts/${hash}.mp3` };
  } catch (e) {
    return { ok: false, detail: explainFetchError(e) };
  }
}
