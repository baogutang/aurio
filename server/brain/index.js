// Brain dispatcher. Picks a provider from config.ai.provider and exposes the
// same surface the app already uses — think() / ask() / available() — plus
// providers() and testProvider() for the settings UI.
//   provider 'claude' | 'codex' | 'cli' → local CLI (brain/cli.js)
//   provider 'api'                       → hosted model (brain/api.js)
import { config } from '../config.js';
import * as cli from './cli.js';
import * as api from './api.js';

// Presets offered in the settings dropdown for the API path. baseUrl is used
// verbatim (+ /chat/completions); GLM deliberately has no /v1.
export const API_PRESETS = [
  { id: 'openai', kind: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { id: 'glm', kind: 'openai', label: 'GLM · 智谱', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { id: 'deepseek', kind: 'openai', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
  { id: 'kimi', kind: 'openai', label: 'Kimi · Moonshot', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  { id: 'anthropic', kind: 'anthropic', label: 'Anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-3-5-haiku-latest' },
];

// Map an ai-config to a concrete provider module + its argument bundle.
function pick(ai = config.ai) {
  if (ai.provider === 'api') return { mod: api, arg: ai.api };
  return { mod: cli, arg: { preset: ai.provider, ...ai.cli } }; // claude | codex | cli
}

export async function think(prompt) { const { mod, arg } = pick(); return mod.think(prompt, arg); }
export async function ask(prompt) { const { mod, arg } = pick(); return mod.ask(prompt, arg); }
export async function available() { const { mod, arg } = pick(); return mod.available(arg); }

// For GET /api/ai/providers — current selection, which local CLIs are installed,
// and the API presets the UI can offer.
export async function providers() {
  const detected = await cli.detectClis();
  return {
    current: config.ai.provider,
    detected,
    api: { kind: config.ai.api.kind, baseUrl: config.ai.api.baseUrl, model: config.ai.api.model, hasKey: !!config.ai.api.apiKey },
    presets: API_PRESETS,
  };
}

// Build a candidate ai-config from raw settings keys (body), merged over current
// config so a blank API-key field falls back to the saved one when testing.
function candidate(b = {}) {
  const get = (k, fallback) => (k in b && b[k] !== undefined ? b[k] : fallback);
  return {
    provider: get('AI_PROVIDER', config.ai.provider),
    cli: {
      bin: get('AI_CLI_BIN', config.ai.cli.bin),
      model: get('AI_CLI_MODEL', get('CLAUDE_MODEL', config.ai.cli.model)),
      forceLogin: 'CLAUDE_FORCE_LOGIN' in b ? String(b.CLAUDE_FORCE_LOGIN).toLowerCase() === 'true' : config.ai.cli.forceLogin,
    },
    api: {
      kind: get('AI_API_KIND', config.ai.api.kind),
      baseUrl: (get('AI_API_BASE_URL', config.ai.api.baseUrl) || '').replace(/\/+$/, ''),
      apiKey: b.AI_API_KEY || config.ai.api.apiKey, // blank → reuse saved key
      model: get('AI_API_MODEL', config.ai.api.model),
    },
  };
}

// POST /api/ai/test — test candidate settings without saving.
export async function testProvider(body) {
  const { mod, arg } = pick(candidate(body));
  return mod.available(arg);
}
