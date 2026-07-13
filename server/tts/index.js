// Voice/TTS facade. Defaults to local macOS speech so Aurio can speak without
// depending on Fish Audio's overseas endpoint. Tencent Cloud TTS is available
// as a domestic cloud option, 豆包语音 (Doubao) as the emotional radio-voice
// option; Fish remains as an explicit fallback provider.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { config, DATA_ROOT } from '../config.js';
import * as fish from './fish.js';
import * as doubao from './doubao.js';

const CACHE_DIR = path.join(DATA_ROOT, 'cache', 'tts');
const DEFAULT_TTS_TEXT = '你好，我是 Aurio，你的私人电台主播。';
const pending = new Map();

export const TTS_CACHE_DIR = CACHE_DIR;

const CACHE_MAX_FILES = 800; // keep the most-recent N synthesized clips

function ensureDir() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// Evict the oldest cached clips so cache/tts/ doesn't grow without bound. Cheap
// (one readdir + a stat per file); runs at startup and then daily.
export function pruneTtsCache(maxFiles = CACHE_MAX_FILES) {
  try {
    if (!fs.existsSync(CACHE_DIR)) return;
    const files = fs.readdirSync(CACHE_DIR)
      .filter((f) => f.endsWith('.wav') || f.endsWith('.mp3'))
      .map((f) => {
        const full = path.join(CACHE_DIR, f);
        try { return { full, mtime: fs.statSync(full).mtimeMs }; } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => b.mtime - a.mtime); // newest first
    for (const { full } of files.slice(maxFiles)) {
      try { fs.unlinkSync(full); } catch { /* best effort */ }
    }
  } catch (e) { console.error('[tts] cache prune:', e.message); }
}

let gcTimer = null;
export function startTtsCacheGc() {
  if (gcTimer) return;
  pruneTtsCache();
  gcTimer = setInterval(() => pruneTtsCache(), 24 * 60 * 60 * 1000);
  if (gcTimer.unref) gcTimer.unref(); // don't keep the process alive for GC alone
}

function voiceConfig(overrides = {}) {
  const provider = overrides.VOICE_PROVIDER || overrides.TTS_PROVIDER || config.voice.provider || 'system';
  return {
    provider,
    systemVoice: overrides.SYSTEM_TTS_VOICE || config.voice.system.voice || 'Tingting',
    tencentSecretId: overrides.TENCENT_SECRET_ID || overrides.TENCENTCLOUD_SECRET_ID || config.voice.tencent.secretId || '',
    tencentSecretKey: overrides.TENCENT_SECRET_KEY || overrides.TENCENTCLOUD_SECRET_KEY || config.voice.tencent.secretKey || '',
    tencentRegion: overrides.TENCENT_TTS_REGION || config.voice.tencent.region || 'ap-guangzhou',
    tencentVoiceType: Number(overrides.TENCENT_TTS_VOICE_TYPE || config.voice.tencent.voiceType || 1001),
  };
}

function hashFor(text, cfg = voiceConfig()) {
  return crypto.createHash('sha1')
    .update(`${cfg.provider}::${cfg.systemVoice}::${cfg.tencentVoiceType}::${text}`)
    .digest('hex');
}

function cachedLocal(text, cfg = voiceConfig()) {
  if (!text || !text.trim()) return null;
  ensureDir();
  const hash = hashFor(text, cfg);
  const ext = cfg.provider === 'tencent' ? 'mp3' : 'wav';
  const file = path.join(CACHE_DIR, `${hash}.${ext}`);
  const url = `/tts/${hash}.${ext}`;
  if (fs.existsSync(file)) return { url, cached: true };
  return null;
}

function run(cmd, args, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let err = '';
    const killer = setTimeout(() => {
      try { child.kill(); } catch { /* noop */ }
      reject(new Error(`${cmd} timed out`));
    }, timeoutMs);
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', (e) => { clearTimeout(killer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(killer);
      if (code === 0) resolve();
      else reject(new Error((err || `${cmd} exited ${code}`).trim()));
    });
  });
}

// macOS: `say` → AIFF, then `afconvert` → 16-bit WAV the browser can play.
async function synthesizeMac(text, cfg, hash) {
  const aiff = path.join(CACHE_DIR, `${hash}.aiff`);
  const file = path.join(CACHE_DIR, `${hash}.wav`);
  const url = `/tts/${hash}.wav`;
  try {
    const args = cfg.systemVoice ? ['-v', cfg.systemVoice, '-o', aiff, text] : ['-o', aiff, text];
    await run('/usr/bin/say', args);
  } catch {
    await run('/usr/bin/say', ['-o', aiff, text]);
  }
  await run('/usr/bin/afconvert', ['-f', 'WAVE', '-d', 'LEI16', aiff, file]);
  try { fs.unlinkSync(aiff); } catch { /* best effort */ }
  return { url, cached: false };
}

// Windows: synthesize with the built-in SAPI voices via System.Speech (PowerShell).
// The configured voice is a hint; if it isn't installed (e.g. the macOS default
// "Tingting") we fall back to any installed Chinese voice, else the system default.
// Text/script go through the OS temp dir so they never land in the web-served cache.
const WIN_TTS_SCRIPT = `param([string]$TextFile,[string]$OutFile,[string]$Voice)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Speech
$text=[System.IO.File]::ReadAllText($TextFile,[System.Text.Encoding]::UTF8)
$synth=New-Object System.Speech.Synthesis.SpeechSynthesizer
if($Voice){try{$synth.SelectVoice($Voice)}catch{$zh=$synth.GetInstalledVoices()|Where-Object{$_.Enabled -and $_.VoiceInfo.Culture.Name -like 'zh*'}|Select-Object -First 1;if($zh){$synth.SelectVoice($zh.VoiceInfo.Name)}}}
$synth.SetOutputToWaveFile($OutFile)
$synth.Speak($text)
$synth.Dispose()`;

let winScriptPath = '';
function ensureWinScript() {
  if (winScriptPath && fs.existsSync(winScriptPath)) return winScriptPath;
  winScriptPath = path.join(os.tmpdir(), 'aurio-win-tts.ps1');
  fs.writeFileSync(winScriptPath, WIN_TTS_SCRIPT, 'utf8');
  return winScriptPath;
}

async function synthesizeWindows(text, cfg, hash) {
  const file = path.join(CACHE_DIR, `${hash}.wav`);
  const url = `/tts/${hash}.wav`;
  const txtFile = path.join(os.tmpdir(), `aurio-tts-${hash}.txt`);
  fs.writeFileSync(txtFile, text, 'utf8');
  try {
    await run('powershell', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', ensureWinScript(), txtFile, file, cfg.systemVoice || '',
    ]);
  } finally {
    try { fs.unlinkSync(txtFile); } catch { /* best effort */ }
  }
  return { url, cached: false };
}

async function synthesizeSystem(text, cfg = voiceConfig()) {
  const cached = cachedLocal(text, cfg);
  if (cached) return cached;
  ensureDir();
  const hash = hashFor(text, cfg);
  if (process.platform === 'darwin') return synthesizeMac(text, cfg, hash);
  if (process.platform === 'win32') return synthesizeWindows(text, cfg, hash);
  return null; // Linux/other: no built-in voice — configure Tencent or Fish.
}

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hmac(key, data, encoding) {
  return crypto.createHmac('sha256', key).update(data).digest(encoding);
}

function signTencent(payload, cfg) {
  const service = 'tts';
  const host = 'tts.tencentcloudapi.com';
  const action = 'TextToVoice';
  const version = '2019-08-23';
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n`;
  const signedHeaders = 'content-type;host;x-tc-action';
  const canonicalRequest = [
    'POST',
    '/',
    '',
    canonicalHeaders,
    signedHeaders,
    sha256Hex(payload),
  ].join('\n');
  const credentialScope = `${date}/${service}/tc3_request`;
  const stringToSign = [
    'TC3-HMAC-SHA256',
    timestamp,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const secretDate = hmac(`TC3${cfg.tencentSecretKey}`, date);
  const secretService = hmac(secretDate, service);
  const secretSigning = hmac(secretService, 'tc3_request');
  const signature = hmac(secretSigning, stringToSign, 'hex');
  const authorization = `TC3-HMAC-SHA256 Credential=${cfg.tencentSecretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { authorization, timestamp, host, action, version };
}

async function synthesizeTencent(text, cfg = voiceConfig()) {
  const cached = cachedLocal(text, cfg);
  if (cached) return cached;
  if (!cfg.tencentSecretId || !cfg.tencentSecretKey) return null;
  ensureDir();
  const hash = hashFor(text, cfg);
  const file = path.join(CACHE_DIR, `${hash}.mp3`);
  const url = `/tts/${hash}.mp3`;
  const payload = JSON.stringify({
    Text: text,
    SessionId: hash.slice(0, 32),
    ModelType: 1,
    VoiceType: cfg.tencentVoiceType,
    Codec: 'mp3',
  });
  const sig = signTencent(payload, cfg);
  const res = await fetch(`https://${sig.host}`, {
    method: 'POST',
    headers: {
      Authorization: sig.authorization,
      'Content-Type': 'application/json; charset=utf-8',
      Host: sig.host,
      'X-TC-Action': sig.action,
      'X-TC-Timestamp': String(sig.timestamp),
      'X-TC-Version': sig.version,
      'X-TC-Region': cfg.tencentRegion,
    },
    body: payload,
    signal: AbortSignal.timeout(30000),
  });
  const body = await res.json();
  if (body?.Response?.Error) throw new Error(body.Response.Error.Message || body.Response.Error.Code);
  const audio = body?.Response?.Audio;
  if (!audio) throw new Error('腾讯云未返回音频');
  fs.writeFileSync(file, Buffer.from(audio, 'base64'));
  return { url, cached: false };
}

// Per-call voice options (workstream C: per-show/segment voice) ride an
// additive `opts` param: { voiceType?, speed?, emotion? } merged over the
// provider's configured voice. Only doubao understands them today; system /
// tencent / fish ignore them gracefully and speak in their configured voice.

// In-flight coalescing key: the base text hash plus whatever per-call knobs
// change the audio, so the same line in two voices is two syntheses.
function pendingKey(text, opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  return `${hashFor(text)}::${[o.voiceType, o.speed, o.emotion].map((v) => v ?? '').join(':')}`;
}

export function cachedSynthesis(text, opts = undefined) {
  const cfg = voiceConfig();
  if (cfg.provider === 'fish') return fish.cachedSynthesis(text);
  if (cfg.provider === 'doubao') return doubao.cachedSynthesis(text, opts);
  return cachedLocal(text, cfg);
}

export async function synthesize(text, opts = undefined) {
  const cfg = voiceConfig();
  try {
    if (cfg.provider === 'tencent') return await synthesizeTencent(text, cfg);
    if (cfg.provider === 'fish') return await fish.synthesize(text);
    if (cfg.provider === 'doubao') return await doubao.synthesize(text, opts);
    return await synthesizeSystem(text, cfg);
  } catch (e) {
    console.error(`[tts:${cfg.provider}]`, e.message);
    return null;
  }
}

export function synthesizeBackground(text, onDone, opts = undefined) {
  const cached = cachedSynthesis(text, opts);
  if (cached) return cached;
  if (!text || !text.trim()) return null;

  const key = pendingKey(text, opts);
  const existing = pending.get(key);
  if (existing) {
    existing.then((tts) => { if (tts?.url) onDone?.(tts); }).catch(() => {});
    return null;
  }

  const task = synthesize(text, opts).finally(() => pending.delete(key));
  pending.set(key, task);
  task.then((tts) => { if (tts?.url) onDone?.(tts); }).catch((e) => {
    console.error('[tts background]', e.message);
  });
  return null;
}

export async function testVoice(body = {}) {
  const cfg = voiceConfig(body);
  const text = (body.text && body.text.trim()) || DEFAULT_TTS_TEXT;
  try {
    if (cfg.provider === 'fish') {
      return fish.testVoice({ apiKey: body.FISH_API_KEY, referenceId: body.FISH_REFERENCE_ID, text });
    }
    if (cfg.provider === 'doubao') {
      return doubao.testVoice({
        appid: body.DOUBAO_TTS_APPID,
        token: body.DOUBAO_TTS_TOKEN,
        voiceType: body.DOUBAO_TTS_VOICE_TYPE,
        emotion: body.DOUBAO_TTS_EMOTION,
        speed: body.DOUBAO_TTS_SPEED,
        text,
      });
    }
    const tts = cfg.provider === 'tencent'
      ? await synthesizeTencent(text, cfg)
      : await synthesizeSystem(text, cfg);
    if (!tts?.url) return { ok: false, detail: cfg.provider === 'tencent' ? '缺少腾讯云密钥' : '本机语音不可用' };
    return { ok: true, detail: '合成成功，正在试听…', url: tts.url };
  } catch (e) {
    return { ok: false, detail: e.message || '语音合成失败' };
  }
}
