// The DJ orchestrator — composes one "segment" of the show:
//   trigger → assemble context → AI brain → resolve songs → optional cached TTS
// runSegment() then applies it to the queue. The radio engine (radio.js) drives
// automatic refills (mode 'append'); user speech goes through mode 'auto', which
// reads the brain's intent to interject / steer / chat.
import { EventEmitter } from 'node:events';
import { assemble } from './context.js';
import { think } from './brain/index.js';
import { resolveQueue, playbackUrl, candidatesText, recommend, dedupeTracks } from './music/index.js';
import { cachedSynthesis, synthesizeBackground } from './tts/index.js';
import { db } from './store.js';

export const bus = new EventEmitter();

let running = false;
export function isBusy() { return running; }

// Compose one segment without touching the queue: brain picks songs + patter.
// Returns { say, segue, reason, ttsUrl, tracks, intent, placement, mood }.
export async function composeSegment(trigger = {}) {
  // Seed the prompt with real, in-library candidates so the brain picks songs
  // that actually exist instead of guessing titles not in the library.
  if (!trigger.toolResults && trigger.text) {
    try {
      const cands = await candidatesText(trigger.text, 20);
      if (cands) trigger = { ...trigger, toolResults: cands };
    } catch (e) { console.error('[dj] candidates:', e.message); }
  }

  const prompt = await assemble(trigger);
  // The brain can be down (CLI not logged in, API key wrong, network). Don't let
  // that kill the segment: degrade to an empty action so a music trigger can still
  // fall back to library recommendations (see runSegment) instead of going silent.
  let action; // { say, play[], reason, segue, intent, placement, mood }
  let degraded = false;
  try {
    action = await think(prompt);
  } catch (e) {
    console.error('[dj] brain unavailable:', e.message);
    action = { say: '', play: [], reason: '', segue: '', intent: '', placement: '', mood: '' };
    degraded = true;
  }

  let tracks = dedupeTracks(await resolveQueue(action.play));
  for (const t of tracks) t.url = await playbackUrl(t);

  const tts = cachedSynthesis(action.say);
  return {
    say: action.say, segue: action.segue, reason: action.reason,
    ttsUrl: tts?.url || null, tracks, degraded,
    intent: action.intent || '', placement: action.placement || '', mood: action.mood || '',
  };
}

function trackRef(track) {
  if (!track) return null;
  return {
    source: track.source,
    id: track.id,
    title: track.title,
    artist: track.artist,
  };
}

function sameTrack(a, b) {
  if (!a || !b) return false;
  if (a.source && b.source && a.source !== b.source) return false;
  if (a.id && b.id) return a.id === b.id;
  return !!(a.title && b.title && a.artist && b.artist && a.title === b.title && a.artist === b.artist);
}

function persistQueuedTts(track, ttsUrl) {
  if (!track || !ttsUrl) return;
  const q = db.getQueue();
  let changed = false;
  const next = q.map((item) => {
    if (!changed && sameTrack(item, track)) {
      changed = true;
      return { ...item, segueTtsUrl: ttsUrl };
    }
    return item;
  });
  if (changed) db.setQueue(next);
}

function queueTtsPatch(seg, broadcast) {
  if (!seg.say || seg.ttsUrl) return;
  const firstTrack = broadcast.mode === 'append' ? trackRef(broadcast.queue?.[0]) : null;
  synthesizeBackground(seg.say, (tts) => {
    if (firstTrack) persistQueuedTts(firstTrack, tts.url);
    bus.emit('tts', {
      ts: broadcast.ts,
      kind: broadcast.kind,
      mode: broadcast.mode,
      ttsUrl: tts.url,
      track: firstTrack,
    });
  });
}

// Run one segment end to end and broadcast it.
//   mode 'replace' (manual / open) → reset the queue.
//   mode 'append'  (stream refill) → extend the queue; bind patter to seg head.
//   mode 'auto'    (user spoke)    → branch on the brain's intent:
//        enqueue → insert (placement next/append) · steer → restyle · chat → talk only.
// `currentIndex` (the now-playing index, from the radio heartbeat) lets us place
// interjections relative to the current track without a dj→radio import cycle.
export async function runSegment(trigger = {}, { mode = 'replace', currentIndex = -1 } = {}) {
  if (running) return { error: 'busy', say: '稍等，我还在编排上一段…' };
  running = true;
  try {
    if (trigger.text) db.addMessage('user', trigger.text, { kind: trigger.kind || 'chat' });

    const seg = await composeSegment(trigger);

    // Resolve the auto mode into a concrete action from the brain's intent.
    let eff = mode;
    let placement = 'next';
    if (mode === 'auto') {
      const wantsMusic = /放|听|来(?:点|首|一首)|歌|音乐|排|播|play|song|music/i.test(trigger.text || '');
      const intent = seg.intent || (seg.tracks.length || wantsMusic ? 'enqueue' : 'chat');
      if (intent === 'chat') eff = 'chat';
      else if (intent === 'steer') eff = 'steer';
      else { eff = 'insert'; placement = seg.placement === 'append' ? 'append' : 'next'; }
    }

    // A music action must never go silent: if the brain returned no songs, top up.
    if (['append', 'insert', 'replace'].includes(eff) && !seg.tracks.length) {
      try {
        const rec = await recommend(4);
        for (const t of rec) t.url = await playbackUrl(t);
        seg.tracks = dedupeTracks(rec);
      } catch (e) { console.error('[dj] refill fallback:', e.message); }
    }

    // Brain down: keep the user informed instead of dead air. Background station
    // refills (append) stay silent — no patter to synthesize and speak every few
    // minutes — but anything the user kicked off gets an honest one-liner so the
    // UI never strands the "thinking…" placeholder.
    if (seg.degraded && !seg.say && eff !== 'append') {
      seg.say = seg.tracks.length
        ? '我的大脑这会儿连不上，先按你的曲库顺了几首，边听边等它回来。'
        : '我的大脑这会儿连不上（去设置里看看 AI 配置），先陪你安静待一会儿。';
    }

    const base = { ts: Date.now(), kind: trigger.kind || 'chat', say: seg.say, segue: seg.segue, reason: seg.reason };
    let broadcast;

    if (eff === 'append') {
      // Patter rides on the segment's first track (narrated at the boundary).
      const q = dedupeTracks(db.getQueue());
      const incoming = dedupeTracks(seg.tracks, q);
      if (incoming[0]) { incoming[0].segue = seg.say || ''; incoming[0].segueTtsUrl = seg.ttsUrl || null; }
      db.setQueue([...q, ...incoming]);
      broadcast = { ...base, mode: 'append', ttsUrl: null, queue: incoming };
    } else if (eff === 'insert') {
      // Interject: place the songs relative to the now-playing track.
      const q = dedupeTracks(db.getQueue());
      const incoming = dedupeTracks(seg.tracks, q);
      const at = placement === 'next' ? Math.max(0, currentIndex + 1) : q.length;
      q.splice(at, 0, ...incoming);
      db.setQueue(q);
      broadcast = { ...base, mode: 'insert', placement, ttsUrl: seg.ttsUrl, queue: incoming };
    } else if (eff === 'steer') {
      // Restyle the stream: remember the new mood, drop the rest of the queue so
      // the next refill comes back in the new style after the current track.
      db.setStation({ mood: seg.mood || '', lastSteer: trigger.text || '' });
      const keep = currentIndex >= 0 ? currentIndex + 1 : 0;
      db.setQueue(db.getQueue().slice(0, keep));
      broadcast = { ...base, mode: 'steer', mood: seg.mood || '', ttsUrl: seg.ttsUrl, queue: [] };
    } else if (eff === 'chat') {
      broadcast = { ...base, mode: 'chat', ttsUrl: seg.ttsUrl, queue: [] };
    } else { // replace
      const q = dedupeTracks(seg.tracks);
      if (q.length) db.setQueue(q);
      broadcast = { ...base, mode: 'replace', ttsUrl: seg.ttsUrl, queue: q };
    }

    if (seg.say) db.addMessage('dj', seg.say, { kind: trigger.kind || 'chat', reason: seg.reason });
    bus.emit('broadcast', broadcast);
    queueTtsPatch(seg, broadcast);
    return broadcast;
  } catch (e) {
    console.error('[dj] run failed:', e.message);
    const fail = { ts: Date.now(), error: e.message, say: '抱歉，我的大脑刚刚卡了一下，再试一次？', queue: [] };
    bus.emit('broadcast', fail);
    return fail;
  } finally {
    running = false;
  }
}

// Manual / open / scheduled: replace the queue with a fresh segment.
export function run(trigger = {}) {
  return runSegment(trigger, { mode: 'replace' });
}
