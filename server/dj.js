// The DJ orchestrator — composes one segment and applies it via QueueController.
import { assemble } from './context.js';
import { think } from './brain/index.js';
import { buildObservation, executeSearchLoop } from './agent/loop.js';
import { validateRadioAction } from './agent/schema.js';
import {
  resolveQueue, playbackUrl, requestConstraints, hasHardConstraints,
  describeConstraints, requestCandidates, candidatesToText, recommend, rankTracks,
} from './music/index.js';
import { cachedSynthesis, synthesizeBackground } from './tts/index.js';
import { db } from './store.js';
import { queueController } from './runtime/queue-controller.js';
import { clientSessionManager } from './runtime/client-session-manager.js';
import { eventBus } from './runtime/event-bus.js';

const PRIORITY = { refill: 0, system: 1, feedback: 1, user: 2 };

let processing = false;
let pendingHighPriority = 0;
const jobQueue = [];

function segmentPriority(trigger = {}, mode = 'replace') {
  if (trigger.kind === 'refill') return PRIORITY.refill;
  if (trigger.kind === 'chat') return PRIORITY.user;
  if (['morning', 'plan', 'mood'].includes(trigger.kind)) return PRIORITY.user;
  if (trigger.kind === 'station' && mode === 'insert') return PRIORITY.feedback;
  return PRIORITY.system;
}

function pumpQueue() {
  if (processing || !jobQueue.length) return;
  jobQueue.sort((a, b) => b.priority - a.priority);
  const job = jobQueue.shift();
  if (!job) return;
  processing = true;
  job.run()
    .then(job.resolve)
    .catch(job.reject)
    .finally(() => {
      processing = false;
      pumpQueue();
    });
}

function enqueueSegment(fn, priority) {
  return new Promise((resolve, reject) => {
    jobQueue.push({ run: fn, priority, resolve, reject });
    pumpQueue();
  });
}

function freshPlayIndex(fallback = -1) {
  const fresh = clientSessionManager.currentIndex(15000);
  if (fresh >= 0) return fresh;
  return fallback >= 0 ? fallback : -1;
}

export function isBusy() { return processing; }

export async function drainDj(timeoutMs = 5000) {
  const start = Date.now();
  while (processing && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function fillTracks(seg, trigger, candidateTracks) {
  if (seg.tracks.length) return seg.tracks;
  if (seg.hardRequest) {
    if (seg.constraints?.source && !seg.constraints?.artist) {
      try {
        const rec = await recommend(4, seg.constraints);
        for (const t of rec) t.url = await playbackUrl(t);
        return rec;
      } catch (e) { console.error('[dj] constrained fallback:', e.message); }
    }
    return [];
  }
  if (candidateTracks.length) {
    const ranked = rankTracks(candidateTracks).slice(0, 4);
    for (const t of ranked) t.url = await playbackUrl(t);
    return ranked;
  }
  try {
    const rec = await recommend(4, seg.constraints || {});
    for (const t of rec) t.url = await playbackUrl(t);
    return rec;
  } catch (e) { console.error('[dj] refill fallback:', e.message); }
  return [];
}

export async function composeSegment(trigger = {}) {
  const constraints = trigger.text ? requestConstraints(trigger.text) : {};
  const hardRequest = hasHardConstraints(constraints);
  let candidateTracks = [];

  if (!trigger.toolResults && trigger.text) {
    try {
      candidateTracks = await executeSearchLoop(trigger.text, requestCandidates, 2);
      const cands = candidatesToText(candidateTracks);
      if (cands) trigger = { ...trigger, toolResults: cands };
    } catch (e) { console.error('[dj] candidates:', e.message); }
  }

  const observation = buildObservation(trigger);
  const prompt = await assemble({ ...trigger, observation });
  let action;
  let degraded = false;
  try {
    const raw = await think(prompt);
    const validated = validateRadioAction(raw);
    if (!validated.ok) throw new Error(validated.errors.join(', ') || 'invalid action');
    action = validated.action;
  } catch (e) {
    console.error('[dj] brain unavailable:', e.message);
    action = { say: '', play: [], reason: '', segue: '', intent: '', placement: '', mood: '' };
    degraded = true;
  }

  let tracks = rankTracks(await resolveQueue(action.play, constraints));
  tracks = tracks.filter((t, i, arr) => arr.findIndex((x) => x.source === t.source && x.id === t.id) === i);
  if (!tracks.length && candidateTracks.length) {
    tracks = rankTracks(candidateTracks).slice(0, 4);
  }
  if (!tracks.length && trigger.text && !hardRequest) {
    try {
      const broader = await executeSearchLoop(trigger.text, requestCandidates, 3);
      tracks = rankTracks(broader).slice(0, 4);
    } catch { /* noop */ }
  }
  for (const t of tracks) t.url = await playbackUrl(t);

  const tts = cachedSynthesis(action.say);
  return {
    say: action.say, segue: action.segue, reason: action.reason,
    ttsUrl: tts?.url || null, tracks, degraded,
    intent: action.intent || '', placement: action.placement || '', mood: action.mood || '',
    constraints, hardRequest, requested: describeConstraints(constraints),
    candidateTracks,
  };
}

function trackRef(track) {
  if (!track) return null;
  return { source: track.source, id: track.id, title: track.title, artist: track.artist };
}

function queueTtsPatch(seg, broadcast, playIdx) {
  if (!seg.say || seg.ttsUrl) return;
  const upcoming = playIdx >= 0
    ? broadcast.queue?.[playIdx + 1]
    : broadcast.queue?.[0];
  const firstTrack = trackRef(upcoming);
  synthesizeBackground(seg.say, (tts) => {
    const ref = firstTrack || trackRef(broadcast.queue?.[playIdx + 1] || broadcast.queue?.[0]);
    if (ref) queueController.patchSegueTts(ref, tts.url);
    eventBus.emit('tts', {
      ts: broadcast.ts,
      kind: broadcast.kind,
      mode: broadcast.mode,
      ttsUrl: tts.url,
      track: ref,
    });
  });
}

function revisionNow() {
  return queueController.peekSnapshot().revision;
}

async function runSegmentInner(trigger = {}, { mode = 'replace', currentIndex: playIdx = -1 } = {}, priority = PRIORITY.system) {
  try {
    if (trigger.text) db.addMessage('user', trigger.text, { kind: trigger.kind || 'chat' });

    const seg = await composeSegment(trigger);
    if (priority < PRIORITY.user && pendingHighPriority > 0) {
      return { error: 'superseded', revision: revisionNow() };
    }

    let eff = mode;
    let placement = 'next';
    if (mode === 'auto') {
      const wantsMusic = /放|听|来(?:点|首|一首)|歌|音乐|排|播|play|song|music/i.test(trigger.text || '');
      const intent = seg.intent || (seg.tracks.length || wantsMusic ? 'enqueue' : 'chat');
      if (intent === 'chat') eff = 'chat';
      else if (intent === 'steer') eff = 'steer';
      else { eff = 'insert'; placement = seg.placement === 'append' ? 'append' : 'next'; }
    }

    if (['append', 'insert', 'replace'].includes(eff) && !seg.tracks.length) {
      const filled = await fillTracks(seg, trigger, seg.candidateTracks || []);
      if (filled.length) {
        seg.tracks = filled;
      } else if (seg.hardRequest) {
        seg.say = `我在${seg.requested || '指定范围'}里没找到能播的歌，先不乱放。`;
        eff = 'chat';
      }
    }

    if (seg.degraded && !seg.say && eff !== 'append') {
      seg.say = seg.tracks.length
        ? '我的大脑这会儿连不上，先按你的曲库顺了几首，边听边等它回来。'
        : '我的大脑这会儿连不上（去设置里看看 AI 配置），先陪你安静待一会儿。';
    }

    const idxNow = freshPlayIndex(playIdx);
    const base = {
      ts: Date.now(),
      kind: trigger.kind || 'chat',
      say: eff === 'append' ? '' : seg.say,
      segue: seg.segue,
      reason: seg.reason,
      revision: revisionNow(),
    };
    let broadcast;

    if (eff === 'append') {
      const { added } = queueController.append(seg.tracks);
      broadcast = { ...base, mode: 'append', ttsUrl: null, queue: added, revision: revisionNow() };
    } else if (eff === 'insert') {
      const snap = queueController.peekSnapshot();
      const at = placement === 'next' ? Math.max(0, idxNow + 1) : snap.queue.length;
      const { added } = queueController.insert(seg.tracks, { at, dedupeAgainst: snap.queue });
      broadcast = { ...base, mode: 'insert', placement, ttsUrl: seg.ttsUrl, queue: added, revision: revisionNow() };
    } else if (eff === 'steer') {
      db.setStation({ mood: seg.mood || '', lastSteer: trigger.text || '' });
      let steerTracks = seg.tracks;
      if (!steerTracks.length) {
        try {
          steerTracks = await recommend(4, { mood: seg.mood });
          for (const t of steerTracks) t.url = await playbackUrl(t);
        } catch (e) { console.error('[dj] steer refill:', e.message); }
      }
      const { snapshot } = queueController.steerAndAppend(idxNow, steerTracks);
      broadcast = {
        ...base, mode: 'steer', mood: seg.mood || '', ttsUrl: seg.ttsUrl,
        queue: snapshot.queue, revision: snapshot.revision,
      };
    } else if (eff === 'chat') {
      broadcast = { ...base, mode: 'chat', ttsUrl: seg.ttsUrl, queue: [], revision: revisionNow() };
    } else {
      const { snapshot } = queueController.replace(seg.tracks);
      broadcast = { ...base, mode: 'replace', ttsUrl: seg.ttsUrl, queue: snapshot.queue, revision: snapshot.revision };
    }

    if (seg.say && eff !== 'append') db.addMessage('dj', seg.say, { kind: trigger.kind || 'chat', reason: seg.reason });
    if (trigger.kind === 'plan' && seg.mood) {
      db.setPlan({ date: new Date().toISOString().slice(0, 10), mood: seg.mood, note: seg.say || seg.reason });
    }
    recordSegmentMemory(trigger, seg, broadcast);
    eventBus.emit('broadcast', broadcast);
    queueTtsPatch(seg, broadcast, idxNow);
    return broadcast;
  } catch (e) {
    console.error('[dj] run failed:', e.message);
    const fail = {
      ts: Date.now(), error: e.message,
      say: '抱歉，我的大脑刚刚卡了一下，再试一次？',
      queue: [], revision: revisionNow(),
    };
    eventBus.emit('broadcast', fail);
    return fail;
  }
}

function recordSegmentMemory(trigger, seg, broadcast) {
  const buf = db.getPref('segmentMemory', []);
  const tracks = (broadcast?.queue?.length ? broadcast.queue : seg.tracks || [])
    .slice(0, 6)
    .map((t) => `${t.artist} — ${t.title}`);
  buf.push({
    ts: Date.now(),
    kind: trigger.kind || 'chat',
    say: (seg.say || '').slice(0, 120),
    reason: seg.reason || '',
    tracks,
  });
  if (buf.length > 10) buf.splice(0, buf.length - 10);
  db.setPref('segmentMemory', buf);
}

export async function runSegment(trigger = {}, opts = {}) {
  const priority = segmentPriority(trigger, opts.mode);
  if (priority >= PRIORITY.user) pendingHighPriority++;
  try {
    return await enqueueSegment(
      () => runSegmentInner(trigger, opts, priority),
      priority,
    );
  } finally {
    if (priority >= PRIORITY.user) pendingHighPriority--;
  }
}

export function run(trigger = {}) {
  return runSegment(trigger, { mode: 'replace' });
}
