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
import { judgeSay, rememberSaid } from './agent/judge.js';
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
    if (candidateTracks.length) {
      const matched = rankTracks(candidateTracks).slice(0, 4);
      for (const t of matched) t.url = await playbackUrl(t);
      if (matched.length) return matched;
    }
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

// Run the (rule-based, deterministic) judge over an action's spoken lines.
// Returns the deduped set of violated category codes — never the phrases.
function judgeAction(action) {
  const codes = [];
  if (action.say) codes.push(...judgeSay(action.say).violations.map((v) => v.code));
  if (action.segue) codes.push(...judgeSay(action.segue, { segue: true, skipRepeat: true }).violations.map((v) => v.code));
  return [...new Set(codes)];
}

// Corrective note for a retry. Names the violated CATEGORY only — quoting the
// offending phrase would reintroduce the priming we removed from the prompt.
const CORRECTION = {
  assistant_voice: '上一版带了客服／AI 助手腔，请彻底去掉那种语气，像真人主播随口说。',
  stilted: '上一版用了生硬做作的「氛围腔」，请换成自然的口语。',
  meta_narration: '上一版在解释自己的工作流程（意图、选曲、编排），听众不需要知道，删掉。',
  tech_words: '上一版出现了技术词，请不要提任何技术相关的词。',
  too_long: '上一版太长了，请压到一句话。',
  repetition: '上一版和最近说过的话太像了，请换一个完全不同的开头和说法。',
};

function correctiveNote(codes) {
  const lines = codes.map((c) => CORRECTION[c]).filter(Boolean);
  return `（重写要求，只改口播、不改选曲）\n${lines.join('\n')}`;
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

  // Judge the spoken lines. On a violation, regenerate ONCE with a category-only
  // corrective note (never the offending phrase); if it still fails, drop the
  // say and keep the track selection. Refill lines are meant to be short/empty,
  // so we don't spend a retry on them.
  if (!degraded && trigger.kind !== 'refill') {
    const codes = judgeAction(action);
    if (codes.length) {
      try {
        const raw2 = await think(`${prompt}\n\n${correctiveNote(codes)}`);
        const v2 = validateRadioAction(raw2);
        if (v2.ok && !judgeAction(v2.action).length) {
          action = v2.action;
        } else {
          const codes2 = v2.ok ? judgeAction(v2.action) : codes;
          console.error('[dj] judge failed after retry, going silent:', codes2.join(','));
          action = { ...action, say: '', segue: '' };
        }
      } catch (e) {
        console.error('[dj] judge regen failed, going silent:', e.message);
        action = { ...action, say: '', segue: '' };
      }
    }
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
    if (priority < PRIORITY.user && pendingHighPriority > 0) {
      return { error: 'superseded', revision: revisionNow() };
    }
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
      if (intent === 'chat' && (seg.tracks.length || wantsMusic)) {
        eff = 'insert';
        placement = seg.placement === 'append' ? 'append' : 'next';
      } else if (intent === 'chat') {
        eff = 'chat';
      } else if (intent === 'steer') {
        eff = 'steer';
      } else {
        eff = 'insert';
        placement = seg.placement === 'append' ? 'append' : 'next';
      }
    }

    if (['append', 'insert', 'replace'].includes(eff) && !seg.tracks.length) {
      const filled = await fillTracks(seg, trigger, seg.candidateTracks || []);
      if (filled.length) {
        seg.tracks = filled;
      } else if (seg.hardRequest) {
        seg.say = seg.say || `你点的那首库里暂时没有，要不换一首类似的？`;
        eff = 'chat';
      }
    }

    if (seg.degraded && !seg.say && eff !== 'append') {
      seg.say = seg.tracks.length
        ? '信号有点飘，我先放几首你常听的垫一下。'
        : '这会儿连不上，先陪你安静待一会儿。';
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

    if (seg.say && eff !== 'append') {
      db.addMessage('dj', seg.say, { kind: trigger.kind || 'chat', reason: seg.reason });
      rememberSaid(seg.say);
    }
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
      say: '刚才卡了一下，再说一次？',
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
