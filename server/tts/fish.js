// Fish Audio TTS pipeline. Synthesizes the DJ's `say` text to an mp3, cached on
// disk by content hash and served at /tts/<hash>.mp3. Degrades gracefully: if no
// API key is set, returns null and the player just shows the text.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config, DATA_ROOT } from '../config.js';

const CACHE_DIR = path.join(DATA_ROOT, 'cache', 'tts');
const DEFAULT_TTS_TEXT = '你好，我是 Aurio，你的私人电台主播。';
const pending = new Map();

function ensureDir() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function hashFor(text) {
  return crypto.createHash('sha1')
    .update(`${config.fish.referenceId}::${text}`)
    .digest('hex');
}

function ttsUrl() {
  return `${config.fish.apiBaseUrl || 'https://api.fish.audio'}/v1/tts`;
}

function headersFor(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    model: config.fish.model || 's2-pro',
  };
}

function explainFetchError(e) {
  const code = e?.cause?.code || '';
  const cause = e?.cause?.message || '';
  const msg = [e?.message, cause, code].filter(Boolean).join(' ');
  if (e?.name === 'TimeoutError') return '请求 Fish Audio 超时，请稍后再试或检查网络/代理。';
  if (/UND_ERR_CONNECT_TIMEOUT|Connect Timeout/i.test(msg)) {
    return '无法连接 Fish Audio：连接 api.fish.audio 超时。请检查网络/代理；如果浏览器能打开但 Aurio 不行，需要让后端 Node 进程也走代理。';
  }
  if (/ENOTFOUND|EAI_AGAIN/i.test(msg)) return '无法解析 Fish Audio 域名，请检查 DNS 或网络。';
  if (/ECONNREFUSED|ECONNRESET|ETIMEDOUT|fetch failed/i.test(msg)) return `无法连接 Fish Audio：${code || e.message}`;
  return e?.message || 'Fish Audio 请求失败';
}

async function requestTts({ apiKey, referenceId, text }) {
  const body = { text, format: 'mp3' };
  if (referenceId) body.reference_id = referenceId;
  const res = await fetch(ttsUrl(), {
    method: 'POST',
    headers: headersFor(apiKey),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error('Fish Audio API Key 无效或没有权限');
  }
  if (res.status === 402) {
    throw new Error('Fish Audio 余额不足或额度已用完');
  }
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200);
    throw new Error(`Fish Audio HTTP ${res.status}: ${detail}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

export function cachedSynthesis(text) {
  if (!config.fish.enabled || !text || !text.trim()) return null;
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
  if (!config.fish.enabled || !text || !text.trim()) return null;
  ensureDir();
  const hash = hashFor(text);
  const file = path.join(CACHE_DIR, `${hash}.mp3`);
  const url = `/tts/${hash}.mp3`;

  try {
    const buf = await requestTts({
      apiKey: config.fish.apiKey,
      referenceId: config.fish.referenceId,
      text,
    });
    fs.writeFileSync(file, buf);
    return { url, cached: false };
  } catch (e) {
    console.error('[tts]', explainFetchError(e));
    return null;
  }
}

export function synthesizeBackground(text, onDone) {
  const cached = cachedSynthesis(text);
  if (cached) return cached;
  if (!config.fish.enabled || !text || !text.trim()) return null;

  const key = hashFor(text);
  const existing = pending.get(key);
  if (existing) {
    existing.then((tts) => { if (tts?.url) onDone?.(tts); }).catch(() => {});
    return null;
  }

  const task = synthesize(text).finally(() => pending.delete(key));
  pending.set(key, task);
  task.then((tts) => { if (tts?.url) onDone?.(tts); }).catch((e) => {
    console.error('[tts background]', e.message);
  });
  return null;
}

export const TTS_CACHE_DIR = CACHE_DIR;

// Settings "试听" test: synthesize a short sample with candidate (or saved) creds.
// Returns { ok, detail, url? } — url is a playable /tts/*.mp3 the UI can audition.
export async function testVoice({ apiKey, referenceId, text } = {}) {
  apiKey = apiKey || config.fish.apiKey;
  referenceId = referenceId || config.fish.referenceId;
  text = (text && text.trim()) || DEFAULT_TTS_TEXT;
  if (!apiKey) return { ok: false, detail: '缺少 Fish Audio API Key' };
  ensureDir();
  try {
    const buf = await requestTts({ apiKey, referenceId, text });
    const hash = crypto.createHash('sha1').update(`test::${referenceId}::${text}`).digest('hex');
    fs.writeFileSync(path.join(CACHE_DIR, `${hash}.mp3`), buf);
    return { ok: true, detail: '合成成功，正在试听…', url: `/tts/${hash}.mp3` };
  } catch (e) {
    return { ok: false, detail: explainFetchError(e) };
  }
}
