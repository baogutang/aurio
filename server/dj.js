// The DJ orchestrator — composes one segment and lands it on the programme log.
import { assemble, buildSongMaterial } from './context.js';
import { think, ask } from './brain/index.js';
import { buildObservation, executeSearchLoop } from './agent/loop.js';
import { validateRadioAction } from './agent/schema.js';
import {
  resolveQueue, playbackUrl, requestConstraints, hasHardConstraints,
  describeConstraints, requestCandidates, candidatesToText, recommend, rankTracks,
} from './music/index.js';
import { cachedSynthesis, synthesizeBackground } from './tts/index.js';
import { judgeSay, rememberSaid } from './agent/judge.js';
import { judgeLikeHuman } from './agent/judge-llm.js';
import { consultTalkBudget, recordSpokenBreak, voiceParamsAt } from './shows.js';
import { db } from './store.js';
import { station } from './playout/station.js';
import { eventBus } from './runtime/event-bus.js';

const PRIORITY = { refill: 0, system: 1, feedback: 1, user: 2 };

let processing = false;
let pendingHighPriority = 0;
const jobQueue = [];

function segmentPriority(trigger = {}, mode = 'replace') {
  if (trigger.kind === 'refill') return PRIORITY.refill;
  if (trigger.kind === 'chat') return PRIORITY.user;
  if (['morning', 'plan', 'mood'].includes(trigger.kind)) return PRIORITY.user;
  if (trigger.kind === 'feedback') return PRIORITY.feedback;
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

// ---------------------------------------------------------------------------
// Hotline (chat 热线化, RADIO_VISION §四) — a song request behaves like calling
// in to a radio station. A non-urgent request joins the END of the show (the
// caller hears a short on-air 点歌确认 now) and leaves a pending shoutout the
// host weaves into the next spoken break: 「刚才有位听众点了X，这就来」.
// Explicit urgency — 现在/立刻/马上/… in the user text, or the model choosing
// placement 'next' — keeps the old insert-next behaviour: the 插播 channel
// stays open.
// ---------------------------------------------------------------------------

export const SHOUTOUT_KEY = 'hotlineShoutouts';
export const SHOUTOUT_TTL_MS = 30 * 60 * 1000; // unspoken shoutouts expire
const SHOUTOUT_MAX = 8;

const URGENT_RE = /现在|立刻|马上|这就|快点|先放/;
const MUSIC_REQUEST_RE = /放|听|来(?:点|首|一首)|歌|音乐|排|播|play|song|music/i;

export function isUrgentRequest(text = '') {
  return URGENT_RE.test(text || '');
}

export function looksLikeMusicRequest(text = '') {
  return MUSIC_REQUEST_RE.test(text || '');
}

// Placement for an enqueue-intent chat: the hotline default is append (the
// request joins the show) unless the listener or the model asked for right now.
function hotlinePlacement(text, modelPlacement) {
  return (isUrgentRequest(text) || modelPlacement === 'next') ? 'next' : 'append';
}

function readShoutouts(now = Date.now()) {
  const raw = db.getPref(SHOUTOUT_KEY, []);
  const list = Array.isArray(raw) ? raw.filter((s) => s && Number.isFinite(s.ts)) : [];
  return list.filter((s) => now - s.ts < SHOUTOUT_TTL_MS).sort((a, b) => a.ts - b.ts);
}

// Oldest pending shoutout — never more than one per break — pruning expired
// entries out of the stored ledger as a side effect.
function peekShoutout(now = Date.now()) {
  const raw = db.getPref(SHOUTOUT_KEY, []);
  const live = readShoutouts(now);
  if (!Array.isArray(raw) || raw.length !== live.length) db.setPref(SHOUTOUT_KEY, live);
  return live[0] || null;
}

function recordShoutout(text, tracks, now = Date.now()) {
  const list = readShoutouts(now);
  list.push({
    text: (text || '').replace(/\s+/g, ' ').trim().slice(0, 60),
    tracks: tracks.slice(0, 3).map((t) => `${t.artist} — ${t.title}`),
    ts: now,
  });
  if (list.length > SHOUTOUT_MAX) list.splice(0, list.length - SHOUTOUT_MAX);
  db.setPref(SHOUTOUT_KEY, list);
}

// Retire one shoutout. Only called when the segment actually aired a say — a
// break that went silent (budget mute, judge failure) keeps it pending.
function consumeShoutout(ts, now = Date.now()) {
  db.setPref(SHOUTOUT_KEY, readShoutouts(now).filter((s) => s.ts !== ts));
}

/** Read-only view of the pending shoutout ledger (GET /api/hotline). */
export function pendingShoutouts(now = Date.now()) {
  return readShoutouts(now);
}

// Prompt suffixes. Both land on the BASE prompt (not a per-call wrapper), so
// the judge's corrective retry — `${prompt}\n\n${correctiveNote(codes)}` —
// keeps them on the rewrite.
const HOTLINE_CONFIRM_NOTE = '（热线点歌）这位听众是打进点歌热线的，没有说要立刻听到。像电台接热线一样处理：把歌排到后面（placement 用 append），让节目自然走到它；say 写一句主播口吻的点歌确认，报出歌名最自然，20 个字以内，说完就完。不要用「收到」「好的」「明白」开头；不要提队列、歌单或任何后台安排；不要猜这位听众正在做什么，也不要替他安排（不知道他忙不忙、在不在路上，就别说）。只有当这首歌和此刻的节目气口特别搭时才用 next。';

function shoutoutNote(s) {
  const req = s.tracks?.length ? s.tracks.join('、') : s.text;
  return `（热线回应）刚才有位听众打进热线点了：${req}。请在这次口播里自然地带上一句对这位听众的回应——「刚才有位听众点了X，这就来」的口气，但不要照抄；最多一句话，只提这一位，不要罗列，不要提队列或后台。`;
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
// `show` may carry tighter per-programme length budgets (深夜航班: shorter).
// `material` is the verifiable text of this break (素材卡 + candidates + the
// listener's own words): when present, judge.js checks every year / 《title》
// in the lines against it (fabricated_fact).
function judgeAction(action, show = null, material = '') {
  const codes = [];
  if (action.say) codes.push(...judgeSay(action.say, { sayMax: show?.sayMax, material }).violations.map((v) => v.code));
  if (action.segue) codes.push(...judgeSay(action.segue, { segue: true, skipRepeat: true, segueMax: show?.segueMax, material }).violations.map((v) => v.code));
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
  same_angle: '上一版抓的具体细节和最近两段完全重叠（比如又是天气、又是时间）。换一个别的角度：正在播的这首歌本身、歌手、年份、或者听众刚做的事。',
  fabricated_listener: '上一版在猜听众正在做什么（在忙、快回来了、想必…）。你不知道的不要编：只说你真知道的——这首歌、此刻的时间、天气、他真说过的话。',
  fabricated_fact: '上一版讲了素材里没有的具体年份/名字。只讲素材卡里有的，卡里没有就把那个细节整个去掉。',
  critic_voice: '上一版在给歌下判断、打分。主播指向歌里的一个瞬间，不评价歌的好坏。',
  written_prose: '上一版是书面语句式（工整对仗、长句串接）。像随口说话那样：短句，说人话，说完就完。',
  unnatural: '上一版不像随口说出来的话。想象你正对着麦克风，顺口把这一句说出来，重来。',
};

// The listener never heard the rejected draft. Without this the model apologises
// on air for a slip nobody witnessed ("刚才嘴瓢了，音乐先接上。").
const NO_META = '这次重写对听众是不可见的：直接给出新的一句，不要提到你在重写，不要道歉，不要解释刚才发生了什么。';

function correctiveNote(codes) {
  const lines = codes.map((c) => CORRECTION[c]).filter(Boolean);
  return `（重写要求，只改口播、不改选曲）\n${lines.join('\n')}\n${NO_META}`;
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

  // Talk budget (server/shows.js): scheduled beats spend from the current
  // show's hourly allowance; the hotline (chat) always may speak. A day-plan
  // quiet window (server/plan.js — a meeting on the calendar) hard-mutes
  // non-chat breaks on top of the budget. The decision lands BEFORE the
  // prompt — so the brain picks tracks knowing the break is music-only — and
  // silence is forced BEFORE the judge, so the retry loop never fires for a
  // muted break (empty lines can't violate anything).
  const talk = consultTalkBudget(trigger.kind || 'chat');

  // The 歌曲素材 body is built ONCE and shared: the prompt shows the model its
  // verifiable facts, and the judge checks every spoken year/《title》 against
  // the same text (fabricated_fact). For the judge, the material widens to the
  // real search candidates and the listener's own words — both are verifiable
  // sources a 点歌确认 legitimately quotes from.
  let material = '';
  try { material = await buildSongMaterial(observation); } catch { material = ''; }
  const judgeMaterial = [material, trigger.toolResults, trigger.text]
    .filter((s) => typeof s === 'string' && s.trim())
    .join('\n');

  let prompt = await assemble({
    ...trigger,
    observation,
    material,
    muted: !talk.allowed,
    // A quiet-window mute has a different WHY than a spent budget — the prompt
    // says so, and the model won't try to "make up" the lost break later.
    mutedReason: talk.quiet
      ? `现在是静默窗（${talk.quiet.reason}），日程期间整段不说话。`
      : undefined,
  });

  // Hotline seams (chat 热线化). A non-urgent song request gets nudged toward
  // a one-line on-air 点歌确认; the next spoken non-chat break carries the
  // oldest pending shoutout. Suffixes join the base prompt, so the corrective
  // retry below keeps them.
  const kind = trigger.kind || 'chat';
  let shoutout = null;
  if (kind === 'chat' && trigger.text && looksLikeMusicRequest(trigger.text) && !isUrgentRequest(trigger.text)) {
    prompt += `\n\n${HOTLINE_CONFIRM_NOTE}`;
  } else if (kind !== 'chat' && kind !== 'refill' && talk.allowed) {
    shoutout = peekShoutout();
    if (shoutout) prompt += `\n\n${shoutoutNote(shoutout)}`;
  }

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

  // Budget spent: this break is music-only. Silence is a decision, not a
  // failure (dj-persona / RADIO_AUDIT「沉默的勇气」).
  if (!talk.allowed) {
    action = { ...action, say: '', segue: '' };
  }

  // Judge the spoken lines. On a violation, regenerate ONCE with a category-only
  // corrective note (never the offending phrase); if it still fails, drop the
  // say and keep the track selection. Refill lines are meant to be short/empty,
  // so we don't spend a retry on them.
  if (!degraded && trigger.kind !== 'refill') {
    const codes = judgeAction(action, talk.show, judgeMaterial);
    if (codes.length) {
      try {
        const raw2 = await think(`${prompt}\n\n${correctiveNote(codes)}`);
        const v2 = validateRadioAction(raw2);
        if (v2.ok && !judgeAction(v2.action, talk.show, judgeMaterial).length) {
          action = v2.action;
        } else {
          const codes2 = v2.ok ? judgeAction(v2.action, talk.show, judgeMaterial) : codes;
          console.error('[dj] judge failed after retry, going silent:', codes2.join(','));
          action = { ...action, say: '', segue: '' };
        }
      } catch (e) {
        console.error('[dj] judge regen failed, going silent:', e.message);
        action = { ...action, say: '', segue: '' };
      }
    }
  }

  // Second judge layer (RADIO_AUDIT idea 05): the rules catch diseases we have
  // named; this asks the one unenumerable question — does it sound like a
  // person? Scheduled kinds only: chat has a listener waiting on the reply,
  // refill stays quiet anyway. Fails open inside judgeLikeHuman.
  if (!degraded && kind !== 'refill' && kind !== 'chat' && (action.say || action.segue)) {
    // The judge needs the RAW reply — think() normalizes into a DJ action and
    // silently destroys the {"pass":…} verdict (found by the story-engine work).
    const verdict = await judgeLikeHuman({ say: action.say, segue: action.segue }, ask);
    if (!verdict.pass) {
      try {
        const raw2 = await think(`${prompt}\n\n${correctiveNote(verdict.problems)}`);
        const v2 = validateRadioAction(raw2);
        if (v2.ok && !judgeAction(v2.action, talk.show, judgeMaterial).length) {
          action = v2.action;
        } else {
          console.error('[dj] human judge failed after retry, going silent:', verdict.problems.join(','));
          action = { ...action, say: '', segue: '' };
        }
      } catch (e) {
        console.error('[dj] human judge regen failed, going silent:', e.message);
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

  // Per-show voice params (workstream C): a spoken line airing NOW is
  // synthesized in the on-air show's voice; only doubao honours the opts.
  const voiceOpts = voiceParamsAt();
  const tts = cachedSynthesis(action.say, voiceOpts || undefined);
  return {
    say: action.say, segue: action.segue, reason: action.reason,
    ttsUrl: tts?.url || null, tracks, degraded,
    intent: action.intent || '', placement: action.placement || '', mood: action.mood || '',
    constraints, hardRequest, requested: describeConstraints(constraints),
    candidateTracks,
    voiceOpts,
    // The pending hotline shoutout this break was asked to weave in (or null).
    // Retired by runSegmentInner only when the say actually airs.
    shoutout,
    // The talk-budget decision, exposed so callers (and tests) can see WHY a
    // break was silent. `show` is the name only — the object stays internal;
    // `quiet` carries the day-plan quiet window's reason (「会议静默」) or null.
    talk: {
      allowed: talk.allowed,
      exempt: talk.exempt,
      show: talk.show.name,
      spent: talk.spent,
      budget: talk.budget,
      quiet: talk.quiet ? talk.quiet.reason : null,
    },
  };
}

// Spoken lines are transient — the host talks over the bed NOW; only segues
// attached to log items ride the timeline. A cached synthesis goes out with
// the result; a cache miss synthesizes in the background and the 'say' event
// carries the voice to every connected client when it lands.
function deliverSay(base, seg) {
  if (!seg.say) return;
  if (seg.ttsUrl) {
    eventBus.emit('say', { ts: base.ts, kind: base.kind, text: seg.say, ttsUrl: seg.ttsUrl });
    return;
  }
  synthesizeBackground(seg.say, (tts) => {
    eventBus.emit('say', { ts: base.ts, kind: base.kind, text: seg.say, ttsUrl: tts.url });
  }, seg.voiceOpts || undefined);
  // No cached voice yet: push the text so every client can at least show it.
  eventBus.emit('say', { ts: base.ts, kind: base.kind, text: seg.say, ttsUrl: null });
}

async function runSegmentInner(trigger = {}, { mode = 'replace' } = {}, priority = PRIORITY.system) {
  try {
    if (priority < PRIORITY.user && pendingHighPriority > 0) {
      return { error: 'superseded' };
    }
    if (trigger.kind === 'chat' && trigger.text) db.addMessage('user', trigger.text, { kind: 'chat' });

    const seg = await composeSegment(trigger);
    if (priority < PRIORITY.user && pendingHighPriority > 0) {
      return { error: 'superseded' };
    }

    // The old 'replace' mode (wipe the queue) maps to steer in the log world:
    // aired history is immutable, the on-air item finishes, the future changes.
    let eff = mode === 'replace' ? 'steer' : mode;
    let placement = 'next';
    if (mode === 'auto') {
      const wantsMusic = looksLikeMusicRequest(trigger.text);
      const intent = seg.intent || (seg.tracks.length || wantsMusic ? 'enqueue' : 'chat');
      if (intent === 'chat' && (seg.tracks.length || wantsMusic)) {
        eff = 'insert';
        placement = hotlinePlacement(trigger.text, seg.placement);
      } else if (intent === 'chat') {
        eff = 'chat';
      } else if (intent === 'steer') {
        eff = 'steer';
      } else {
        eff = 'insert';
        placement = hotlinePlacement(trigger.text, seg.placement);
      }
    }

    if (['append', 'insert'].includes(eff) && !seg.tracks.length) {
      const filled = await fillTracks(seg, trigger, seg.candidateTracks || []);
      if (filled.length) {
        seg.tracks = filled;
      } else if (seg.hardRequest) {
        seg.say = seg.say || `你点的那首库里暂时没有，要不换一首类似的？`;
        eff = 'chat';
      }
    }

    // Degraded fallback line — but never for a budget-muted break: the show
    // said quiet, and a signal apology is still a break.
    if (seg.degraded && !seg.say && eff !== 'append' && seg.talk?.allowed !== false) {
      seg.say = seg.tracks.length
        ? '信号有点飘，我先放几首你常听的垫一下。'
        : '这会儿连不上，先陪你安静待一会儿。';
    }

    const base = {
      ts: Date.now(),
      kind: trigger.kind || 'chat',
      say: eff === 'append' ? '' : seg.say,
      segue: seg.segue,
      reason: seg.reason,
      talk: seg.talk,
    };
    let result;

    if (eff === 'append') {
      // A refill's spoken line (if any) rides the first new item as its intro
      // voice — pre-synthesized by the station before it airs, never late.
      const voice = seg.say ? { text: seg.say, ttsUrl: seg.ttsUrl || null } : null;
      const items = station.appendTracks(seg.tracks, { voice });
      result = { ...base, op: 'append', ttsUrl: null, queue: items.map((it) => it.track) };
    } else if (eff === 'insert') {
      const items = placement === 'next'
        ? station.insertNextTracks(seg.tracks)
        : station.appendTracks(seg.tracks);
      const added = items.map((it) => it.track);
      // A non-urgent hotline request joined the show: remember the caller so
      // the host can acknowledge them at the next spoken break.
      if (trigger.kind === 'chat' && placement === 'append' && added.length) {
        recordShoutout(trigger.text, added);
      }
      result = { ...base, op: 'insert', placement, ttsUrl: seg.ttsUrl, queue: added };
    } else if (eff === 'steer') {
      db.setStation({ mood: seg.mood || '', lastSteer: trigger.text || '' });
      let steerTracks = seg.tracks;
      if (!steerTracks.length) {
        try {
          steerTracks = await recommend(4, { mood: seg.mood });
          for (const t of steerTracks) t.url = await playbackUrl(t);
        } catch (e) { console.error('[dj] steer refill:', e.message); }
      }
      const items = station.steerTracks(steerTracks);
      result = {
        ...base, op: 'steer', mood: seg.mood || '', ttsUrl: seg.ttsUrl,
        queue: items.map((it) => it.track),
      };
    } else {
      result = { ...base, op: 'chat', ttsUrl: seg.ttsUrl, queue: [] };
    }

    if (seg.say && eff !== 'append') {
      db.addMessage('dj', seg.say, { kind: trigger.kind || 'chat', reason: seg.reason });
      rememberSaid(seg.say);
      // A break that actually aired spends the show's talk budget. Chat is the
      // hotline — an answer, not a break — so it never spends.
      if ((trigger.kind || 'chat') !== 'chat') recordSpokenBreak();
      // The shoutout woven into this break went on air — retire it. A muted or
      // judge-silenced break falls outside this branch and keeps it pending;
      // a degraded fallback line never saw the prompt, so it doesn't count.
      if (seg.shoutout && !seg.degraded) consumeShoutout(seg.shoutout.ts);
      deliverSay(base, seg);
    }
    if (trigger.kind === 'plan' && seg.mood) {
      db.setPlan({ date: new Date().toISOString().slice(0, 10), mood: seg.mood, note: seg.say || seg.reason });
    }
    recordSegmentMemory(trigger, seg, result);
    return result;
  } catch (e) {
    console.error('[dj] run failed:', e.message);
    const fail = {
      ts: Date.now(), error: e.message,
      say: '刚才卡了一下，再说一次？',
      queue: [],
    };
    eventBus.emit('say', { ts: fail.ts, kind: trigger.kind || 'chat', text: fail.say, ttsUrl: null });
    return fail;
  }
}

function recordSegmentMemory(trigger, seg, result) {
  const buf = db.getPref('segmentMemory', []);
  const tracks = (result?.queue?.length ? result.queue : seg.tracks || [])
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
