// RadioAction schema validation (no external deps — plain JS).

const INTENTS = new Set(['enqueue', 'steer', 'chat', 'replace', '']);
const PLACEMENTS = new Set(['next', 'append', '']);

export function normalizeRadioAction(raw = {}) {
  const play = Array.isArray(raw.play)
    ? raw.play.map((p) => ({
      query: (p?.query || p?.title || '').toString().trim(),
      title: (p?.title || '').toString().trim(),
      artist: (p?.artist || '').toString().trim(),
      reason: (p?.reason || '').toString().trim(),
      source_hint: (p?.source_hint || p?.source || '').toString().trim(),
    })).filter((p) => p.query || p.title)
    : [];

  return {
    say: (raw.say || '').toString().trim().slice(0, 200),
    segue: (raw.segue || '').toString().trim().slice(0, 90),
    reason: (raw.reason || '').toString().trim().slice(0, 300),
    intent: INTENTS.has(raw.intent) ? raw.intent : '',
    placement: PLACEMENTS.has(raw.placement) ? raw.placement : 'next',
    mood: (raw.mood || '').toString().slice(0, 80),
    play,
  };
}

export function validateRadioAction(raw) {
  const action = normalizeRadioAction(raw);
  const errors = [];
  if (action.say.length > 200) errors.push('say too long');
  if (!INTENTS.has(action.intent)) errors.push('invalid intent');
  return { ok: errors.length === 0, action, errors };
}

export function legacyToRadioTurn(legacy) {
  const action = normalizeRadioAction(legacy);
  return {
    version: '1.0',
    observation: action.reason || action.mood || '',
    actions: [{ type: 'legacy', ...action }],
    done: true,
  };
}
