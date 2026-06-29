// QQ Music built-in adapter.
//
// The old implementation required a user-hosted QQMusicApi instance. Keep that
// as a fallback, but default to QQ's public web endpoints so search/lyrics work
// out of the box and playback uses the same vkey flow as go-music-dl/music-lib.
import { config } from '../config.js';

const USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 9_1 like Mac OS X) AppleWebKit/601.1.46 (KHTML, like Gecko) Version/9.0 Mobile/13B143 Safari/601.1';
const SEARCH_REFERER = 'http://m.y.qq.com';
const DOWNLOAD_REFERER = 'http://y.qq.com';
const LYRIC_REFERER = 'https://y.qq.com/portal/player.html';

function randomChinaIP() {
  const blocks = [
    [36, 56],
    [60, 13],
    [101, 226],
    [112, 64],
    [183, 192],
    [223, 104],
  ];
  const [a, b] = blocks[Math.floor(Math.random() * blocks.length)];
  return `${a}.${b}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`;
}

function headers(referer, extra = {}) {
  const ip = randomChinaIP();
  const h = {
    'User-Agent': USER_AGENT,
    Referer: referer,
    'X-Forwarded-For': ip,
    'Client-IP': ip,
    ...extra,
  };
  if (config.qq.cookie) h.Cookie = config.qq.cookie;
  return h;
}

function parseMaybeCallback(text) {
  const t = text.trim();
  const m = t.match(/^[\w$]+\((.*)\)$/s);
  return JSON.parse(m ? m[1] : t);
}

async function getJson(url, referer) {
  const res = await fetch(url, {
    headers: headers(referer),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`qq GET HTTP ${res.status}`);
  return parseMaybeCallback(await res.text());
}

async function postJson(url, data, referer) {
  const res = await fetch(url, {
    method: 'POST',
    headers: headers(referer, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`qq POST HTTP ${res.status}`);
  return parseMaybeCallback(await res.text());
}

async function hostedCall(path, params = {}) {
  if (!config.qq.apiUrl) throw new Error('QQ_API_URL is empty');
  const u = new URL(config.qq.apiUrl + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, v);
  }
  if (config.qq.cookie) u.searchParams.set('cookie', config.qq.cookie);
  const res = await fetch(u, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`qq hosted ${path} HTTP ${res.status}`);
  return res.json();
}

function singerNames(singers) {
  return (Array.isArray(singers) ? singers : [])
    .map((a) => a.name || a.title)
    .filter(Boolean)
    .join(' / ');
}

function payPlay(raw = {}) {
  return Number(raw.pay?.payplay ?? raw.pay?.payPlay ?? raw.pay?.pay_play ?? 0);
}

function isSearchPlayable(raw = {}) {
  // Logged-in users may have entitlement through their Cookie; anonymous search
  // should avoid songs QQ marks as pay-to-play.
  return !!config.qq.cookie || payPlay(raw) !== 1;
}

function mapSong(raw = {}) {
  const albumMid = raw.albummid || raw.albumMid || raw.album?.mid || raw.album?.pmid || '';
  const songMid = raw.songmid || raw.mid || raw.songMid || '';
  const songId = raw.songid ?? raw.songId ?? raw.id ?? '';
  const title = raw.songname || raw.name || raw.title || '';
  const album = raw.albumname || raw.album?.name || raw.album?.title || '';
  const artist = raw.singerName || singerNames(raw.singer || raw.singers || raw.artists);
  return {
    source: 'qqmusic',
    id: String(songMid || songId || ''),
    title,
    artist,
    album,
    duration: Number(raw.interval || raw.duration || 0),
    coverArt: albumMid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg` : raw.cover || '',
    songId: songId ? String(songId) : undefined,
    albumMid: albumMid || undefined,
  };
}

function validTrack(t) {
  return t.id && t.id !== '0' && t.title;
}

async function searchDirect(query, limit = 10) {
  const u = new URL('https://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp');
  u.searchParams.set('w', query);
  u.searchParams.set('format', 'json');
  u.searchParams.set('p', '1');
  u.searchParams.set('n', String(limit));
  const body = await getJson(u, SEARCH_REFERER);
  const list = body?.data?.song?.list || [];
  return list
    .filter(isSearchPlayable)
    .map(mapSong)
    .filter(validTrack);
}

async function searchHosted(query, limit = 10) {
  const body = await hostedCall('/search', { key: query, pageNo: 1, pageSize: limit, t: 0 });
  const list = body?.data?.list || body?.data?.song?.list || body?.data?.songs || [];
  return list.map(mapSong).filter(validTrack);
}

async function detailById(songId) {
  const u = new URL('https://c.y.qq.com/v8/fcg-bin/fcg_play_single_song.fcg');
  u.searchParams.set('songid', String(songId));
  u.searchParams.set('format', 'json');
  const body = await getJson(u, SEARCH_REFERER);
  const item = body?.data?.[0];
  return item && isSearchPlayable(item) ? mapSong({ ...item, songid: item.id }) : null;
}

async function streamUrlDirect(id) {
  let songMid = String(id || '').trim();
  if (!songMid) return null;

  if (/^\d+$/.test(songMid)) {
    const detail = await detailById(songMid);
    songMid = detail?.id || '';
  }
  if (!songMid || songMid === '0') return null;

  const prefixes = config.qq.cookie
    ? ['AI00', 'Q001', 'Q000', 'F000', 'O801', 'M800', 'M500']
    : ['M800', 'M500'];
  const exts = config.qq.cookie
    ? ['flac', 'flac', 'flac', 'flac', 'ogg', 'mp3', 'mp3']
    : ['mp3', 'mp3'];
  const filenames = prefixes.map((prefix, i) => `${prefix}${songMid}${songMid}.${exts[i]}`);
  const guid = String(Math.floor(Math.random() * 9000000000) + 1000000000);

  const body = await postJson('https://u.y.qq.com/cgi-bin/musicu.fcg', {
    comm: {
      cv: 4747474,
      ct: 24,
      format: 'json',
      inCharset: 'utf-8',
      outCharset: 'utf-8',
      notice: 0,
      platform: 'yqq.json',
      needNewCode: 1,
      uin: 0,
    },
    req_1: {
      module: 'music.vkey.GetVkey',
      method: 'UrlGetVkey',
      param: {
        guid,
        songmid: filenames.map(() => songMid),
        songtype: filenames.map(() => 0),
        uin: '0',
        loginflag: 1,
        platform: '20',
        filename: filenames,
      },
    },
  }, DOWNLOAD_REFERER);

  const info = body?.req_1?.data?.midurlinfo || [];
  for (const filename of filenames) {
    const hit = info.find((x) => x?.filename === filename && x?.purl);
    if (!hit) continue;
    return /^https?:\/\//i.test(hit.purl)
      ? hit.purl
      : `https://ws.stream.qqmusic.qq.com/${hit.purl}`;
  }
  return null;
}

async function streamUrlHosted(id) {
  const body = await hostedCall('/song/url', { id });
  const d = body?.data;
  if (typeof d === 'string') return d || null;
  if (d && typeof d === 'object') return d[id] || Object.values(d)[0] || null;
  return null;
}

async function lyricsDirect(id) {
  const u = new URL('https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg');
  const rawId = String(id || '').trim();
  if (/^\d+$/.test(rawId)) u.searchParams.set('songid', rawId);
  else u.searchParams.set('songmid', rawId);
  for (const [k, v] of Object.entries({
    nobase64: '1',
    g_tk: '5381',
    loginUin: '0',
    hostUin: '0',
    format: 'json',
    inCharset: 'utf8',
    outCharset: 'utf-8',
    notice: '0',
    platform: 'yqq.json',
    needNewCode: '0',
  })) u.searchParams.set(k, v);
  const body = await getJson(u, LYRIC_REFERER);
  return body?.lyric || '';
}

async function lyricsHosted(id) {
  const body = await hostedCall('/lyric', { songmid: id });
  return body?.data?.lyric || '';
}

async function recommendDirect(count = 20) {
  const body = await postJson('https://u.y.qq.com/cgi-bin/musicu.fcg', {
    comm: { ct: 24, cv: 0 },
    topList: {
      module: 'musicToplist.ToplistInfoServer',
      method: 'GetDetail',
      param: { topId: 26, offset: 0, num: Math.min(Math.max(count * 10, 50), 100), period: '' },
    },
  }, DOWNLOAD_REFERER);

  const out = [];
  const list = body?.topList?.data?.data?.song || [];
  for (const item of list) {
    if (out.length >= count) break;
    const songId = item.songId || item.songid;
    let track = null;
    if (item.songMid || item.songmid) {
      track = mapSong({
        songmid: item.songMid || item.songmid,
        songid: songId,
        songname: item.title,
        singerName: item.singerName,
        albumMid: item.albumMid,
        cover: item.cover,
      });
    } else if (songId) {
      try { track = await detailById(songId); }
      catch { track = null; }
    }
    if (track && validTrack(track)) out.push(track);
  }
  return out;
}

async function recommendHosted(count = 20) {
  const body = await hostedCall('/getTopLists', {});
  const list = body?.data?.[0]?.songList || body?.data?.list || [];
  return list.map(mapSong).filter(validTrack).slice(0, count);
}

export const qqmusic = {
  enabled: () => true,

  async search(query, limit = 10) {
    try { return await searchDirect(query, limit); }
    catch (e) {
      if (!config.qq.apiUrl) {
        console.error('[qq] search:', e.message);
        return [];
      }
      try { return await searchHosted(query, limit); }
      catch (err) { console.error('[qq] search:', err.message); return []; }
    }
  },

  async streamUrl(id) {
    try {
      const direct = await streamUrlDirect(id);
      if (direct) return direct;
    } catch (e) {
      console.error('[qq] stream direct:', e.message);
    }
    if (!config.qq.apiUrl) return null;
    try { return await streamUrlHosted(id); }
    catch { return null; }
  },

  async lyrics(id) {
    try { return await lyricsDirect(id); }
    catch (e) {
      if (!config.qq.apiUrl) {
        console.error('[qq] lyric:', e.message);
        return '';
      }
      try { return await lyricsHosted(id); }
      catch { return ''; }
    }
  },

  async recommend(count = 20) {
    try {
      const rec = await recommendDirect(count);
      if (rec.length) return rec;
    } catch (e) {
      console.error('[qq] recommend direct:', e.message);
    }
    if (!config.qq.apiUrl) return [];
    try { return await recommendHosted(count); }
    catch { return []; }
  },
};
