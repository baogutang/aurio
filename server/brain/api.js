// API brain: call a hosted model over HTTP using a stored API key.
//   kind 'openai'    → OpenAI-compatible Chat Completions. Covers OpenAI, GLM/智谱,
//                      DeepSeek, Kimi/Moonshot, and any compatible endpoint. The
//                      configured baseUrl is used verbatim + '/chat/completions'
//                      (so GLM's `.../api/paas/v4` works — we never inject `/v1`).
//   kind 'anthropic' → Anthropic Messages API (x-api-key + anthropic-version).
import { toAction } from './parse.js';

// The DJ task wants structured JSON + a bit of personality. A moderate
// temperature and a token cap keep replies parseable and bounded; `json` turns on
// OpenAI-style JSON mode (with a plain-text retry for providers that reject it).
const THINK_TEMPERATURE = 0.6;
const MAX_TOKENS = 1024;

async function openaiChat({ baseUrl, apiKey, model }, prompt, { json = false } = {}) {
  if (!baseUrl) throw new Error('未配置 API 地址（Base URL）');
  if (!apiKey) throw new Error('未配置 API Key');
  if (!model) throw new Error('未配置模型名称（Model）');
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const send = async (useJson) => {
    const body = {
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: json ? THINK_TEMPERATURE : 0.8,
      max_tokens: MAX_TOKENS,
    };
    if (useJson) body.response_format = { type: 'json_object' };
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = await res.json();
    return (j.choices?.[0]?.message?.content || '').toString();
  };
  if (json) {
    // Not every OpenAI-compatible provider supports response_format; fall back to
    // a plain request (parse.js still extracts the JSON) instead of failing hard.
    try { return await send(true); }
    catch (e) { console.error('[brain:api] json mode failed, retrying plain:', e.message); return send(false); }
  }
  return send(false);
}

async function anthropicChat({ baseUrl, apiKey, model }, prompt, { json = false } = {}) {
  if (!apiKey) throw new Error('未配置 API Key');
  if (!model) throw new Error('未配置模型名称（Model）');
  const base = (baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '');
  const res = await fetch(`${base}/v1/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: MAX_TOKENS,
      temperature: json ? THINK_TEMPERATURE : 0.8,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  return (j.content?.[0]?.text || '').toString();
}

function chat(cfg, prompt, opts) {
  return cfg.kind === 'anthropic' ? anthropicChat(cfg, prompt, opts) : openaiChat(cfg, prompt, opts);
}

export async function think(prompt, cfg) { return toAction(await chat(cfg, prompt, { json: true })); }
export async function ask(prompt, cfg) { return await chat(cfg, prompt); }

export async function available(cfg) {
  try {
    const text = await chat(cfg, 'Reply with exactly: OK');
    if (!text.trim()) return { ok: false, detail: '模型返回为空' };
    return { ok: true, detail: text.trim().slice(0, 60) };
  } catch (e) {
    return { ok: false, detail: e.name === 'TimeoutError' ? '请求超时' : e.message };
  }
}
