// The API contract the web client is built against, exercised end-to-end: the
// real HTTP server + WS on an ephemeral port over a fresh temp data dir.
//   · WS join snapshot and every `programme` message carry
//     `listeners` + `stationStartedAt`; a `{type:'listeners'}` push fires
//     when the honest count changes (join / heartbeat / leave).
//   · GET /api/tape?hours=N — aired items oldest→newest, bounded (N capped at
//     12), voice {text, ttsUrl} refs intact. Same session guard as
//     /api/programme.
//   · GET /api/hotline — read-only view of the pending shoutout ledger.
//
// Session token mechanics under test too: GET /api/session (loopback-only, no
// token needed) hands out the startup token; every other /api/* call presents
// it via the X-Aurio-Token header, the WS via the ?token= query param.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const H = 60 * 60 * 1000;
const NOW = Date.now();

let tmpDir;
let server;
let port;
let token;
let db;
let dj;
let stopServer;
const sockets = [];

const seededSong = (id, airStart, duration, extra = {}) => ({
  id, type: 'song', airStart, scheduledStart: airStart, duration,
  track: { source: 'netease', id: `t-${id}`, title: `Song ${id}`, artist: 'Artist' },
  streamUrl: `/api/ncm/stream/t-${id}`,
  ...extra,
});

function api(p, opts = {}) {
  return fetch(`http://127.0.0.1:${port}${p}`, {
    ...opts,
    headers: { 'x-aurio-token': token, ...(opts.headers || {}) },
  });
}

// A WS client that records every message. waitFor consumes messages IN ORDER
// through a cursor: each call scans forward from where the previous match
// left off, so two pushes with the same payload — e.g. listeners going
// 1 → 2 → 1 — are told apart by position, not content.
function connect() {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/stream?token=${token}`);
  sockets.push(ws);
  const messages = [];
  let cursor = 0;
  let waiter = null;
  const scan = () => {
    if (!waiter) return;
    for (let i = cursor; i < messages.length; i++) {
      if (waiter.pred(messages[i])) {
        cursor = i + 1;
        clearTimeout(waiter.timer);
        const { resolve } = waiter;
        waiter = null;
        resolve(messages[i]);
        return;
      }
    }
  };
  ws.on('message', (data) => {
    messages.push(JSON.parse(data.toString()));
    scan();
  });
  const waitFor = (pred, ms = 5000) => new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out waiting for WS message (saw: ${messages.map((m) => m.type).join(', ')})`)),
      ms,
    );
    waiter = { pred, resolve, timer };
    scan();
  });
  const opened = new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });
  const heartbeat = (state = {}) => ws.send(JSON.stringify({ type: 'state', paused: false, ...state }));
  return { ws, messages, waitFor, opened, heartbeat };
}

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurio-api-'));
  process.env.AURIO_DATA_DIR = tmpDir;
  process.env.PORT = '0'; // ephemeral port
  // Neutralize every spend/network path (set BEFORE import; dotenv never
  // overrides existing env): no brain, no TTS, no imaging crons, no weather.
  process.env.AI_PROVIDER = 'api';
  process.env.AI_API_KEY = '';
  process.env.VOICE_PROVIDER = 'none';
  process.env.IMAGING_ENABLED = 'false';
  process.env.OPENWEATHER_KEY = '';
  process.env.NAVIDROME_URL = '';
  process.env.NETEASE_COOKIE = '';
  process.env.QQ_COOKIE = '';

  const index = await import('../server/index.js');
  stopServer = index.stopServer;
  ({ db } = await import('../server/store.js'));
  dj = await import('../server/dj.js');
  const { PROGRAMME_LOG_PREF } = await import('../server/playout/station.js');

  // Seed a persisted programme log BEFORE the station starts: 13h/8h/2h/1h of
  // aired history, a 2h on-air item (so the horizon keeper stays idle for the
  // whole test), and one scheduled item.
  db.setPref(PROGRAMME_LOG_PREF, {
    items: [
      seededSong('thirteen-h', NOW - 13 * H, 180000), // beyond the 12h tape window
      seededSong('eight-h', NOW - 8 * H, 180000),     // inside 12h, outside 6h
      seededSong('two-h', NOW - 2 * H, 180000, {
        voice: { text: '两小时前的口播', ttsUrl: '/tts/aa.mp3' },
      }),
      {
        id: 'vt-1h', type: 'voicetrack', airStart: NOW - 1 * H, scheduledStart: NOW - 1 * H,
        duration: 15000, track: null, streamUrl: null,
        voice: { text: '一小时前的台呼', ttsUrl: '/tts/bb.mp3' },
      },
      seededSong('current', NOW - 60000, 2 * H),
      seededSong('next', null, 180000, { scheduledStart: NOW + 2 * H - 60000 }),
    ],
  });
  // Hotline ledger: one live shoutout, one past the 30-min TTL.
  db.setPref(dj.SHOUTOUT_KEY, [
    { text: '点一首夜曲', tracks: ['周杰伦 — 夜曲'], ts: NOW - 60000 },
    { text: '过期的点歌', tracks: [], ts: NOW - dj.SHOUTOUT_TTL_MS - 60000 },
  ]);

  server = await index.startServer();
  port = server.address().port;
  token = (await (await fetch(`http://127.0.0.1:${port}/api/session`)).json()).token;
}, 20000);

afterAll(async () => {
  for (const ws of sockets) { try { ws.close(); } catch { /* noop */ } }
  await stopServer?.();
  delete process.env.AURIO_DATA_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
}, 20000);

describe('session guard', () => {
  it('hands out the token on /api/session, then requires it', async () => {
    expect(token).toMatch(/^[\w-]{20,}$/);
    for (const p of ['/api/tape', '/api/hotline', '/api/programme', '/api/plan']) {
      const bare = await fetch(`http://127.0.0.1:${port}${p}`);
      expect(bare.status).toBe(403);
      expect((await api(p)).status).toBe(200);
    }
  });
});

describe('GET /api/plan (今日节目单)', () => {
  const localDate = (ts = Date.now()) => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  it('serves today\'s plan in exactly the contract shape (source stripped)', async () => {
    db.setPref('dayPlan', {
      date: localDate(),
      generatedAt: NOW,
      segments: [
        { start: '09:00', end: '11:00', kind: 'focus', label: '上午第一段', reason: '会前专注' },
      ],
      quietWindows: [{ start: '10:50', end: '11:30', reason: '11:00 的会' }],
      note: '十一点前少说话',
      source: 'llm', // internal — must not leak
    });
    const body = await (await api('/api/plan')).json();
    expect(body).toEqual({
      ok: true,
      plan: {
        date: localDate(),
        generatedAt: NOW,
        segments: [
          { start: '09:00', end: '11:00', kind: 'focus', label: '上午第一段', reason: '会前专注' },
        ],
        quietWindows: [{ start: '10:50', end: '11:30', reason: '11:00 的会' }],
        note: '十一点前少说话',
      },
    });
  });

  it('plan is null when absent or stale', async () => {
    db.setPref('dayPlan', {
      date: '2020-01-01', generatedAt: 1, segments: [], quietWindows: [], note: '',
    });
    expect((await (await api('/api/plan')).json()).plan).toBeNull();
    db.setPref('dayPlan', null);
    expect((await (await api('/api/plan')).json()).plan).toBeNull();
  });
});

describe('GET /api/tape', () => {
  it('returns aired items oldest→newest with voice refs, default 6h', async () => {
    const body = await (await api('/api/tape')).json();
    expect(body.ok).toBe(true);
    expect(body.items.map((it) => it.id)).toEqual(['two-h', 'vt-1h', 'current']);
    const [twoH, vt, current] = body.items;
    expect(Object.keys(twoH).sort())
      .toEqual(['airStart', 'duration', 'id', 'streamUrl', 'track', 'type', 'voice']);
    expect(twoH).toMatchObject({
      type: 'song',
      airStart: NOW - 2 * H,
      duration: 180000,
      track: { source: 'netease', id: 't-two-h', title: 'Song two-h', artist: 'Artist' },
      streamUrl: '/api/ncm/stream/t-two-h',
      voice: { text: '两小时前的口播', ttsUrl: '/tts/aa.mp3' },
    });
    expect(vt).toMatchObject({ type: 'voicetrack', track: null, streamUrl: null, voice: { text: '一小时前的台呼', ttsUrl: '/tts/bb.mp3' } });
    expect(current.voice).toBeNull(); // no spoken intro on the on-air item
  });

  it('honours hours=N and caps it at 12', async () => {
    const twelve = await (await api('/api/tape?hours=12')).json();
    expect(twelve.items.map((it) => it.id)).toEqual(['eight-h', 'two-h', 'vt-1h', 'current']);
    // hours beyond the cap change nothing…
    const huge = await (await api('/api/tape?hours=999')).json();
    expect(huge.items).toEqual(twelve.items);
    // …and the 13h item is gone for good: aired retention pruned it at boot.
    expect(huge.items.some((it) => it.id === 'thirteen-h')).toBe(false);
    // scheduled-but-unaired items never appear on the tape
    expect(huge.items.some((it) => it.id === 'next')).toBe(false);
  });
});

describe('GET /api/hotline', () => {
  it('shows the pending (unexpired) shoutout ledger, read-only', async () => {
    const body = await (await api('/api/hotline')).json();
    expect(body.ok).toBe(true);
    expect(body.pending).toEqual([
      { text: '点一首夜曲', tracks: ['周杰伦 — 夜曲'], ts: NOW - 60000 },
    ]);
    // read-only: the stored ledger (expired row included) was not rewritten
    expect(db.getPref(dj.SHOUTOUT_KEY)).toHaveLength(2);
  });
});

describe('programme snapshots carry listeners + stationStartedAt', () => {
  it('GET /api/programme', async () => {
    const body = await (await api('/api/programme')).json();
    expect(body.ok).toBe(true);
    expect(body.current?.id).toBe('current');
    expect(typeof body.offsetMs).toBe('number');
    expect(body.listeners).toBe(0); // nobody connected yet
    expect(body.stationStartedAt).toBe(NOW - 60000); // when 'current' went to air
  });

  it('WS join snapshot, and the listeners push on every change', async () => {
    const c1 = connect();
    await c1.opened;
    await c1.waitFor((m) => m.type === 'hello');
    const join1 = await c1.waitFor((m) => m.type === 'programme' && m.reason === 'join');
    expect(join1.current?.id).toBe('current');
    expect(join1.listeners).toBe(0); // c1 is connected but not yet listening
    expect(join1.stationStartedAt).toBe(NOW - 60000);

    // c1 starts playing → the count flips 0 → 1 and a push fires
    const up1 = c1.waitFor((m) => m.type === 'listeners');
    c1.heartbeat();
    expect((await up1).listeners).toBe(1);

    // a second device joins: its snapshot says 1, then its heartbeat pushes 2
    const c2 = connect();
    await c2.opened;
    const join2 = await c2.waitFor((m) => m.type === 'programme' && m.reason === 'join');
    expect(join2.listeners).toBe(1);
    const up2 = c1.waitFor((m) => m.type === 'listeners' && m.listeners === 2);
    c2.heartbeat();
    await up2;

    // the second device leaves → the survivors hear 1 again
    const down = c1.waitFor((m) => m.type === 'listeners' && m.listeners === 1);
    c2.ws.close();
    await down;

    // REST agrees with the pushes
    const body = await (await api('/api/programme')).json();
    expect(body.listeners).toBe(1);
  }, 15000);
});
