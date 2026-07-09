// Navidrome via the Subsonic / OpenSubsonic API.
// Auth: token = md5(password + salt), sent per request (no password on the wire).
import crypto from 'node:crypto';
import { config } from '../config.js';

const CLIENT = 'aurio';
const API_VERSION = '1.16.1';

function authParams() {
  const salt = crypto.randomBytes(8).toString('hex');
  const token = crypto.createHash('md5').update(config.navidrome.pass + salt).digest('hex');
  return { u: config.navidrome.user, t: token, s: salt, v: API_VERSION, c: CLIENT, f: 'json' };
}

function buildUrl(endpoint, params = {}) {
  const u = new URL(`${config.navidrome.url}/rest/${endpoint}`);
  for (const [k, v] of Object.entries({ ...authParams(), ...params })) {
    if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, v);
  }
  return u;
}

async function call(endpoint, params = {}) {
  const res = await fetch(buildUrl(endpoint, params), { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`navidrome ${endpoint} HTTP ${res.status}`);
  const json = await res.json();
  const sub = json['subsonic-response'];
  if (!sub || sub.status !== 'ok') {
    throw new Error(`navidrome ${endpoint}: ${sub?.error?.message || 'unknown error'}`);
  }
  return sub;
}

function normalize(song) {
  return {
    source: 'navidrome',
    id: song.id,
    title: song.title,
    artist: song.artist,
    album: song.album,
    duration: song.duration,
    coverArt: song.coverArt,
    year: song.year,
    genre: song.genre,
    bpm: song.bpm,
    replayGain: song.replayGain, // OpenSubsonic: { trackGain, trackPeak }
  };
}

export const navidrome = {
  enabled: () => config.navidrome.enabled,

  async ping() {
    await call('ping');
    return true;
  },

  // Test arbitrary credentials (for the in-app setup flow). Returns {ok, detail}.
  async testConnection({ url, user, pass }) {
    if (!url || !user) return { ok: false, detail: '缺少地址或用户名' };
    try {
      const base = url.replace(/\/+$/, '');
      const salt = crypto.randomBytes(8).toString('hex');
      const token = crypto.createHash('md5').update((pass || '') + salt).digest('hex');
      const u = new URL(`${base}/rest/ping`);
      const params = { u: user, t: token, s: salt, v: API_VERSION, c: CLIENT, f: 'json' };
      for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
      const res = await fetch(u, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) return { ok: false, detail: `服务器返回 HTTP ${res.status}` };
      const sub = (await res.json())['subsonic-response'];
      if (sub?.status === 'ok') return { ok: true, detail: '连接成功' };
      return { ok: false, detail: sub?.error?.message || '认证失败' };
    } catch (e) {
      const msg = e.name === 'TimeoutError' ? '连接超时'
        : /fetch failed|ENOTFOUND|ECONNREFUSED|EAI_AGAIN/i.test(e.message) ? '无法连接到该地址（检查地址、端口或网络）'
        : e.message;
      return { ok: false, detail: msg };
    }
  },

  async search(query, limit = 10) {
    const sub = await call('search3', { query, songCount: limit, albumCount: 0, artistCount: 0 });
    const songs = sub.searchResult3?.song || [];
    return songs.map(normalize);
  },

  async random(count = 20) {
    const sub = await call('getRandomSongs', { size: count });
    return (sub.randomSongs?.song || []).map(normalize);
  },

  // ---- 用于品味画像的曲库统计 ----
  async genres() {
    const sub = await call('getGenres');
    return sub.genres?.genre || []; // [{ value, songCount, albumCount }]
  },
  async allArtists() {
    const sub = await call('getArtists');
    return (sub.artists?.index || []).flatMap((i) => i.artist || []); // [{ name, albumCount }]
  },
  async starred() {
    const sub = await call('getStarred2');
    return sub.starred2 || {}; // { artist[], album[], song[] }
  },
  async albumsBy(type, size = 20) {
    const sub = await call('getAlbumList2', { type, size });
    return (sub.albumList2?.album || []);
  },

  async getSong(id) {
    const sub = await call('getSong', { id });
    return sub.song ? normalize(sub.song) : null;
  },

  async lyrics(artist, title) {
    try {
      const sub = await call('getLyrics', { artist, title });
      return sub.lyrics?.value || '';
    } catch { return ''; }
  },

  // Direct stream URL (with auth baked in) — used by the local proxy. Ask
  // Navidrome for an MP3 stream so browser playback is reliable even when the
  // NAS file is ALAC/APE/DSD or another format Chromium cannot decode directly.
  streamUrl(id, options = {}) {
    return buildUrl('stream', { id, format: 'mp3', maxBitRate: 320, ...options }).toString();
  },

  coverUrl(id, size = 300) {
    return buildUrl('getCoverArt', { id, size }).toString();
  },

  async scrobble(id, submission = true) {
    try { await call('scrobble', { id, submission }); } catch (e) {
      console.error('[navidrome] scrobble failed:', e.message);
    }
  },
};
