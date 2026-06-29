// API brain: call a hosted model over HTTP using a stored API key.
//   kind 'openai'    → OpenAI-compatible Chat Completions. Covers OpenAI, GLM/智谱,
//                      DeepSeek, Kimi/Moonshot, and any compatible endpoint. The
//                      configured baseUrl is used verbatim + '/chat/completions'
//                      (so GLM's `.../api/paas/v4` works — we never inject `/v1`).
//   kind 'anthropic' → Anthropic Messages API (x-api-key + anthropic-version).
import { toAction } from './parse.js';

async function openaiChat({ baseUrl, apiKey, model }, prompt) {
  if (!baseUrl) throw new Error('未配置 API 地址（Base URL）');
  if (!apiKey) throw new Error('未配置 API Key');
  if (!model) throw new Error('未配置模型名称（Model）');
  const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 0.8 }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  return (j.choices?.[0]?.message?.content || '').toString();
}

async function anthropicChat({ baseUrl, apiKey, model }, prompt) {
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
    body: JSON.stringify({ model, max_tokens: 1024, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  return (j.content?.[0]?.text || '').toString();
}

function chat(cfg, prompt) {
  return cfg.kind === 'anthropic' ? anthropicChat(cfg, prompt) : openaiChat(cfg, prompt);
}

export async function think(prompt, cfg) { return toAction(await chat(cfg, prompt)); }
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
