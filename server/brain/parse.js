// Shared parsing: turn an LLM's raw reply into the DJ action object
//   { say, play: [{query, reason}], reason, segue }
// Used by every brain provider (CLI + API) so DJ-JSON handling is identical.

function tryParseJson(s) {
  try { return JSON.parse(s); } catch { return null; }
}

function stripFence(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function balancedObjects(text) {
  const out = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) out.push(text.slice(start, i + 1));
    }
  }
  return out;
}

function unescapeLooseJsonString(value = '') {
  return value.replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim();
}

function looseField(text, field) {
  if (field === 'say') {
    const say = text.match(/\\?"say\\?"\s*:\s*\\?"([\s\S]*?)\\?"\s*,\s*\\?"play\\?"/);
    return say ? unescapeLooseJsonString(say[1]) : '';
  }
  const re = new RegExp(`\\\\?"${field}\\\\?"\\s*:\\s*\\\\?"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)\\\\?"`);
  const m = text.match(re);
  return m ? unescapeLooseJsonString(m[1]) : '';
}

function looseAction(text) {
  const body = stripFence(text || '');
  const say = looseField(body, 'say');
  const play = [];
  const queryRe = /\\?"query\\?"\s*:\s*\\?"([\s\S]*?)\\?"\s*(?:,|\})/g;
  let m;
  while ((m = queryRe.exec(body))) {
    const query = unescapeLooseJsonString(m[1]);
    if (query) play.push({ query, reason: '' });
  }
  if (!say && !play.length) return null;
  return {
    say,
    play,
    reason: looseField(body, 'reason'),
    segue: looseField(body, 'segue'),
    intent: looseField(body, 'intent'),
    placement: looseField(body, 'placement'),
    mood: looseField(body, 'mood'),
  };
}

export function extractJson(text) {
  if (!text) return null;
  const queue = [text.toString()];
  const seen = new Set();

  while (queue.length) {
    const raw = queue.shift();
    if (!raw || seen.has(raw)) continue;
    seen.add(raw);

    const body = stripFence(raw);
    const direct = tryParseJson(body);
    if (direct && typeof direct === 'object') return direct;
    if (typeof direct === 'string' && direct !== raw) queue.push(direct);

    for (const candidate of balancedObjects(body)) {
      const parsed = tryParseJson(candidate);
      if (parsed && typeof parsed === 'object') return parsed;
      if (typeof parsed === 'string') queue.push(parsed);
    }
  }
  return null;
}

export function normalizeAction(obj) {
  const out = { say: '', play: [], reason: '', segue: '', intent: '', placement: '', mood: '' };
  if (!obj || typeof obj !== 'object') return out;
  out.say = typeof obj.say === 'string' ? obj.say : '';
  out.reason = typeof obj.reason === 'string' ? obj.reason : '';
  out.segue = typeof obj.segue === 'string' ? obj.segue : '';
  // Conversational intent (only meaningful when the user spoke to the DJ).
  out.intent = ['enqueue', 'steer', 'chat'].includes(obj.intent) ? obj.intent : '';
  out.placement = ['next', 'append'].includes(obj.placement) ? obj.placement : '';
  out.mood = typeof obj.mood === 'string' ? obj.mood : '';
  const play = Array.isArray(obj.play) ? obj.play : [];
  out.play = play.map((p) => {
    if (typeof p === 'string') return { query: p, reason: '' };
    return { query: p.query || p.song || p.title || '', reason: p.reason || '' };
  }).filter((p) => p.query);

  // Some models accidentally put the whole action JSON inside `say`. Treat that as
  // another action instead of sending raw JSON to the UI/TTS.
  const nested = out.say ? normalizeAction(extractJson(out.say)) : null;
  if (nested?.say || nested?.play?.length) {
    out.say = nested.say || out.say;
    if (!out.play.length) out.play = nested.play;
    out.reason = nested.reason || out.reason;
    out.segue = nested.segue || out.segue;
    out.intent = nested.intent || out.intent;
    out.placement = nested.placement || out.placement;
    out.mood = nested.mood || out.mood;
  }
  return out;
}

function looksLikeJsonReply(text) {
  const s = (text || '').toString().trim();
  return /^```(?:json)?/i.test(s)
    || /^[`"'\s]*(?:json)?\s*\{/.test(s)
    || /"say"\s*:/.test(s)
    || /"play"\s*:/.test(s);
}

// Raw model text → action. Falls back to surfacing plain patter when there's no
// parseable DJ-JSON (so a model that just chats still produces a `say`).
export function toAction(resultText) {
  const action = normalizeAction(extractJson(resultText) || looseAction(resultText));
  if (!action.say && !action.play.length) {
    const fallback = (resultText || '').toString().trim().slice(0, 800);
    action.say = looksLikeJsonReply(fallback)
      ? '刚才我把编排稿整理歪了一下，先不让这些格式打扰你。我们把音乐接上，慢慢听。'
      : fallback;
  }
  return action;
}
