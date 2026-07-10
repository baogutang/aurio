// Modular single-loop agent — observe → plan → validate → apply.
import { validateRadioAction, legacyToRadioTurn } from './schema.js';
import { tasteSummary, recentFeedback } from './preferences.js';
import { clientSessionManager } from '../runtime/client-session-manager.js';
import { queueController } from '../runtime/queue-controller.js';
import { db } from '../store.js';
import { detectFacts, factsPromptLine, recordWeatherObservation } from './detectors.js';
import { weather } from '../weather/openweather.js';

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
  const ctrl = clientSessionManager.getController();
  const positionSec = Number.isFinite(ctrl?.positionSec) ? ctrl.positionSec : null;
  const durationSec = Number.isFinite(ctrl?.durationSec) ? ctrl.durationSec : null;
  const remainingSec = positionSec != null && durationSec != null && durationSec > 0
    ? Math.max(0, Math.round(durationSec - positionSec))
    : null;
  // Deterministic detectors (server/agent/detectors.js): code hands the DJ a
  // verified fact instead of hoping the model notices. Weather snapshots ride
  // on the observation rhythm — weather.current() is memory-cached for 30 min,
  // so this is nearly free. Fire-and-forget: a flip surfaces next observation.
  if (weather.enabled()) {
    weather.current().then((w) => { if (w) recordWeatherObservation(w); }).catch(() => {});
  }
  const fact = detectFacts({ now: Date.now(), nowPlaying });
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
        positionSec,
        durationSec,
        remainingSec,
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
    // At most one verified fact per observation (see detectors.js). factsLine
    // is the ready-to-render prompt line, surfaced by context.js.
    facts: fact ? [fact.fact] : [],
    factsLine: fact ? factsPromptLine([fact.fact]) : '',
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
    const narrowed = q.replace(/来(?:点|首|一首)?|放|听|歌|音乐/g, ' ').replace(/\s+/g, ' ').trim();
    if (round === 0 && out.length < 6 && narrowed && narrowed !== q) {
      q = narrowed;
      continue;
    }
    if (!batch.length && round === 0) {
      q = narrowed || q;
      continue;
    }
    break;
  }
  return out;
}
