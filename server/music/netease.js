// 网易云音乐：内置 NeteaseCloudMusicApi 直连（无需外部实例）。
// 搜索开箱即用；扫码登录(cookie)后可播放更多 + 每日推荐。
//
// 关键：网易云对“设备环境”有风控。裸调接口会被判定为异常设备而拦截
// （表现为扫码时提示“检测到设备环境异常，本次操作已拦截”）。修复做两件事：
//   1) 首次使用前调用 register_anonimous 注册一个匿名设备，拿到合法的匿名 token
//      （否则 MUSIC_A 为空 → 设备未注册）；该调用同时会设置 global.deviceId。
//   2) 每个请求都带上一个稳定的中国大陆 realIP（写入 X-Real-IP / X-Forwarded-For），
//      避免境外 / 机房出口 IP 触发风控。realIP 持久化到设置，保持稳定。
import { config } from '../config.js';
import { saveSettings } from '../settings.js';
import pkg from 'NeteaseCloudMusicApi';
import util from 'NeteaseCloudMusicApi/util/index.js';

const ncm = pkg.default ?? pkg;

let initPromise = null; // 保证匿名注册只跑一次
let anonCookie = '';    // register_anonimous 返回的匿名 cookie（含合法 MUSIC_A）
let realIP = '';        // 稳定的中国大陆 IP

// 懒初始化：定 realIP + 注册匿名设备。容错：失败也不阻断（至少带上 realIP）。
// 不强制自定义 deviceId —— 让 register_anonimous 自己生成并写入 global.deviceId，
// 这样设备号与它返回的匿名 token 天然一致，避免“设备/令牌不匹配”再次触发风控。
function ensureInit() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    realIP = config.netease.realIP || util.generateRandomChineseIP();
    if (realIP !== config.netease.realIP) {
      try { saveSettings({ NETEASE_REAL_IP: realIP }); } catch { /* best-effort */ }
    }
    try {
      const b = await ncm.register_anonimous({ realIP, timestamp: Date.now() });
      anonCookie = b?.body?.cookie || '';
    } catch (e) {
      console.error('[netease] register_anonimous:', e.message);
    }
  })();
  return initPromise;
}

async function call(fn, params = {}) {
  await ensureInit();
  // 已登录用用户 cookie(MUSIC_U)；否则用匿名 cookie(MUSIC_A)。两者都带 realIP。
  const cookie = config.netease.cookie || anonCookie || '';
  const res = await ncm[fn]({ ...params, cookie, realIP, timestamp: Date.now() });
  return res.body;
}

function mapSong(s) {
  return {
    source: 'netease',
    id: String(s.id),
    title: s.name,
    artist: (s.ar || s.artists || []).map((a) => a.name).join(' / '),
    album: s.al?.name || s.album?.name || '',
    duration: Math.round((s.dt || s.duration || 0) / 1000),
  };
}

export const netease = {
  enabled: () => true,                       // 内置，搜索始终可用
  loggedIn: () => !!config.netease.cookie,

  async search(query, limit = 10) {
    try {
      const body = await call('cloudsearch', { keywords: query, limit });
      return (body?.result?.songs || []).map(mapSong);
    } catch (e) { console.error('[netease] search:', e.message); return []; }
  },

  // 解析可播放 URL（登录后可拿到更多歌曲 / 更高音质）。版权受限的返回 null。
  async streamUrl(id) {
    try {
      const body = await call('song_url_v1', { id, level: 'exhigh' });
      return body?.data?.[0]?.url || null;
    } catch { return null; }
  },

  async lyrics(id) {
    try { const body = await call('lyric', { id }); return body?.lrc?.lyric || ''; }
    catch { return ''; }
  },

  // Main LRC + translation LRC, for the synced lyrics view.
  async lyricsRich(id) {
    try {
      const body = await call('lyric', { id });
      return { lrc: body?.lrc?.lyric || '', tlyric: body?.tlyric?.lyric || '' };
    } catch { return { lrc: '', tlyric: '' }; }
  },

  async dailyRecommend() {
    if (!config.netease.cookie) return [];
    try {
      const body = await call('recommend_songs', {});
      return (body?.data?.dailySongs || []).map(mapSong);
    } catch (e) { console.error('[netease] recommend:', e.message); return []; }
  },
};

// 扫码登录流程：同样要带 realIP + 匿名 cookie（统一设备上下文），否则扫码即被风控拦截。
export const ncmLogin = {
  async qrKey() {
    await ensureInit();
    const b = await ncm.login_qr_key({ cookie: anonCookie, realIP, timestamp: Date.now() });
    return b.body?.data?.unikey;
  },
  async qrCreate(key) {
    await ensureInit();
    const b = await ncm.login_qr_create({ key, qrimg: true, cookie: anonCookie, realIP, timestamp: Date.now() });
    return b.body?.data?.qrimg;
  },
  async qrCheck(key) {
    await ensureInit();
    const b = await ncm.login_qr_check({ key, cookie: anonCookie, realIP, timestamp: Date.now() });
    return b.body;
  },
  async profile(cookie) {
    await ensureInit();
    try { const b = await ncm.login_status({ cookie, realIP, timestamp: Date.now() }); return b.body?.data?.profile || b.body?.profile || null; }
    catch { return null; }
  },
};
