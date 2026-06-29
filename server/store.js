// Tiny JSON-backed state store. Personal-scale; swap for SQLite later if needed.
// Holds: messages (DJ + user turns), plays (scrobble-ish history), plan (today),
// prefs (key/value), queue (current playlist).
import fs from 'node:fs';
import path from 'node:path';
import { DATA_ROOT } from './config.js';

const DATA_DIR = path.join(DATA_ROOT, 'data');
const FILE = path.join(DATA_DIR, 'state.json');

const DEFAULT = {
  messages: [], // { role, text, ts, meta }
  plays: [],    // { id, title, artist, source, ts }
  plan: null,   // { date, segments: [...] }
  prefs: {},    // arbitrary
  queue: [],    // resolved tracks
};

let state = structuredClone(DEFAULT);
let saveTimer = null;

// Ephemeral "station" state for the radio stream (mood/steer/uptime). Not
// persisted — it describes the live show, rebuilt each session.
let station = { mood: '', lastSteer: '', startedAt: 0 };

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function load() {
  try {
    ensureDir();
    if (fs.existsSync(FILE)) {
      state = { ...structuredClone(DEFAULT), ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
    }
  } catch (e) {
    console.error('[store] failed to load, starting fresh:', e.message);
    state = structuredClone(DEFAULT);
  }
  return state;
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      ensureDir();
      // Atomic write: a crash/power-loss mid-write would otherwise truncate
      // state.json and lose the queue + play history. Write a temp file, then
      // rename (atomic on the same volume) so the real file is never partial.
      const tmp = `${FILE}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
      fs.renameSync(tmp, FILE);
    } catch (e) {
      console.error('[store] save failed:', e.message);
    }
  }, 300);
}

export const db = {
  get state() { return state; },

  addMessage(role, text, meta = {}) {
    const m = { role, text, ts: Date.now(), meta };
    state.messages.push(m);
    if (state.messages.length > 500) state.messages = state.messages.slice(-500);
    scheduleSave();
    return m;
  },

  recentMessages(n = 12) {
    return state.messages.slice(-n);
  },

  messages(n = 80) {
    return state.messages.slice(-n);
  },

  addPlay(track) {
    state.plays.push({
      id: track.id, title: track.title, artist: track.artist,
      source: track.source, ts: Date.now(),
    });
    if (state.plays.length > 2000) state.plays = state.plays.slice(-2000);
    scheduleSave();
  },

  topPlays(n = 20) {
    const counts = new Map();
    for (const p of state.plays) {
      const k = `${p.artist} — ${p.title}`;
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
      .map(([name, count]) => ({ name, count }));
  },

  recentPlays(n = 20) {
    return state.plays.slice(-n).reverse();
  },

  setPlan(plan) { state.plan = plan; scheduleSave(); },
  getPlan() { return state.plan; },

  setQueue(q) { state.queue = q; scheduleSave(); },
  getQueue() { return state.queue; },

  setPref(k, v) { state.prefs[k] = v; scheduleSave(); },
  getPref(k, d = null) { return k in state.prefs ? state.prefs[k] : d; },

  getStation() { return station; },
  setStation(patch = {}) { station = { ...station, ...patch }; return station; },
};
