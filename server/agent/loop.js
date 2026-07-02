// Modular single-loop agent — observe → plan → validate → apply.
import { validateRadioAction, legacyToRadioTurn } from './schema.js';
import { tasteSummary, recentFeedback } from './preferences.js';
import { clientSessionManager } from '../runtime/client-session-manager.js';
import { queueController } from '../runtime/queue-controller.js';
import { db } from '../store.js';

export const AGENT_TOOLS = [
  { name: 'search', desc: 'Search the user music library for candidate tracks' },
  { name: 'enqueue', desc: 'Insert or append tracks to the live queue' },
  { name: 'steer', desc: 'Adjust station mood and trim the upcoming queue' },
  { name: 'chat', desc: 'Respond without changing music' },
];

export function buildObservation(trigger = {}) {
  const playback = clientSessionManager.getPlaybackState();
  const { queue, revision } = queueController.peekSnapshot();
  const idx = playback.playingIndex ?? -1;
  const nowPlaying = idx >= 0 && idx < queue.length ? queue[idx] : playback.currentTrack;
  const upNext = idx >= 0 ? queue.slice(idx + 1, idx + 6) : queue.slice(0, 5);
  const recent = recentFeedback(5);
  const plan = db.getPlan();
  return {
    version: '1.1',
    trigger: {
      kind: trigger.kind || 'chat',
      text: (trigger.text || '').toString().slice(0, 500),
    },
    playback: {
      ...playback,
      queueLen: queue.length,
      revision,
      remaining: clientSessionManager.remaining(queue.length),
      nowPlaying: nowPlaying ? {
        title: nowPlaying.title,
        artist: nowPlaying.artist,
        source: nowPlaying.source,
      } : null,
      upNext: upNext.map((t) => `${t.artist} — ${t.title}`),
    },
    taste: tasteSummary(),
    recentFeedback: recent.map((e) => ({
      signal: e.signal,
      track: e.track ? `${e.track.artist} — ${e.track.title}` : '',
      position_sec: e.position_sec,
    })),
    plan: plan?.date === new Date().toISOString().slice(0, 10) ? plan : null,
    ts: Date.now(),
  };
}

export async function planSegment(composeFn, trigger = {}, observation = null) {
  const obs = observation || buildObservation(trigger);
  const seg = await composeFn({ ...trigger, observation: obs });
  const action = validateRadioAction({
    say: seg.say,
    segue: seg.segue,
    reason: seg.reason,
    intent: seg.intent,
    placement: seg.placement,
    mood: seg.mood,
    play: (seg.tracks || []).map((t) => ({
      query: `${t.artist} - ${t.title}`,
      title: t.title,
      artist: t.artist,
      reason: t.reason,
      source_hint: t.source,
    })),
  });
  return {
    observation: obs,
    segment: seg,
    action: action.action,
    valid: action.ok,
    errors: action.errors,
    turn: legacyToRadioTurn(action.action),
  };
}

export async function runAgentTurn(composeFn, trigger = {}) {
  const planned = await planSegment(composeFn, trigger);
  if (!planned.valid) {
    return { error: 'invalid_action', errors: planned.errors, observation: planned.observation };
  }
  return planned;
}

/** Multi-round library search — broadens query when the first pass is thin. */
export async function executeSearchLoop(query, searchFn, maxRounds = 2) {
  let q = (query || '').trim();
  if (!q) return [];
  const seen = new Set();
  const out = [];
  for (let round = 0; round < maxRounds; round++) {
    const batch = await searchFn(q, 20);
    for (const t of batch) {
      const key = `${t.source || ''}:${t.id || ''}:${t.title}:${t.artist}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }
    if (out.length >= 6) break;
    if (!batch.length && round === 0) {
      q = q.replace(/来(?:点|首|一首)?|放|听|歌|音乐/g, ' ').replace(/\s+/g, ' ').trim() || q;
      continue;
    }
    break;
  }
  return out;
}
