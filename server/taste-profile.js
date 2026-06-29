// 初始品味画像：扫描音乐源（Navidrome 曲库 + 网易云登录后），统计偏好，
// 交给 Claude 总结成一段自然语言「品味画像」，存到 data/taste-profile.md，
// 并被 context.js 自动并入每次推荐的上下文。进度通过 onProgress 回调上报
// （前端用 WebSocket 显示进度条）。
import fs from 'node:fs';
import path from 'node:path';
import { DATA_ROOT } from './config.js';
import { navidrome } from './music/navidrome.js';
import { netease } from './music/netease.js';
import { db } from './store.js';
import { ask } from './brain/index.js';

const FILE = path.join(DATA_ROOT, 'data', 'taste-profile.md');

function ensureDir() {
  const d = path.dirname(FILE);
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

function buildPrompt(stats) {
  const L = [];
  L.push('你是音乐品味分析师。下面是用户音乐库与收听数据，请据此总结这位用户的「音乐品味画像」，用于指导一个 AI 电台 DJ 选歌。');
  L.push('要求：直接输出画像，不要寒暄；先 2–4 句自然中文概括（偏好的风格 / 语言 / 年代 / 情绪与场景），再附一行关键词标签（用 · 分隔）。');
  L.push('');
  if (stats.artistsTop?.length) L.push('常驻艺人（按专辑数）：' + stats.artistsTop.map((a) => `${a.name}(${a.albums})`).join('、'));
  if (stats.genresTop?.length) L.push('流派分布（按歌曲数）：' + stats.genresTop.map((g) => `${g.name}(${g.songs})`).join('、'));
  if (stats.starred) L.push(`收藏：艺人 ${stats.starred.artists} · 专辑 ${stats.starred.albums} · 单曲 ${stats.starred.songs}` + (stats.starred.sampleSongs?.length ? '；例如 ' + stats.starred.sampleSongs.join('、') : ''));
  if (stats.topPlays?.length) L.push('最常播放：' + stats.topPlays.map((t) => `${t.name}(${t.count})`).join('、'));
  if (stats.recentPlays?.length) L.push('最近播放：' + stats.recentPlays.join('、'));
  if (stats.ncm) L.push('网易云：' + stats.ncm);
  return L.join('\n');
}

function renderMd(profileText, stats) {
  return `---
generatedAt: ${new Date().toISOString()}
sources: ${(stats.sources || []).join(', ') || 'none'}
---

# 自动品味画像

${profileText.trim()}

<!-- 统计摘要（供参考）
常驻艺人: ${(stats.artistsTop || []).slice(0, 12).map((a) => a.name).join('、')}
流派: ${(stats.genresTop || []).slice(0, 10).map((g) => g.name).join('、')}
-->
`;
}

// onProgress({ stage, pct, done?, error?, empty?, profile? })
export async function buildProfile(onProgress = () => {}) {
  const stats = { sources: [], artistsTop: [], genresTop: [], starred: null, topPlays: [], recentPlays: [] };
  onProgress({ stage: '开始扫描音乐库…', pct: 5 });

  if (navidrome.enabled()) {
    stats.sources.push('Navidrome');
    onProgress({ stage: '读取流派分布…', pct: 15 });
    try {
      const g = await navidrome.genres();
      stats.genresTop = g.map((x) => ({ name: x.value, songs: x.songCount || 0 }))
        .filter((x) => x.name && !x.name.includes('$') && x.name.toLowerCase() !== 'unknown')
        .sort((a, b) => b.songs - a.songs).slice(0, 12);
    } catch (e) { console.error('[profile] genres', e.message); }
    onProgress({ stage: '读取艺人列表…', pct: 40 });
    try {
      const a = await navidrome.allArtists();
      stats.artistsTop = a.map((x) => ({ name: x.name, albums: x.albumCount || 0 })).sort((p, q) => q.albums - p.albums).slice(0, 20);
      stats.totalArtists = a.length;
    } catch (e) { console.error('[profile] artists', e.message); }
    onProgress({ stage: '读取收藏…', pct: 55 });
    try {
      const s = await navidrome.starred();
      stats.starred = {
        artists: (s.artist || []).length, albums: (s.album || []).length, songs: (s.song || []).length,
        sampleSongs: (s.song || []).slice(0, 15).map((x) => `${x.artist} - ${x.title}`),
      };
    } catch (e) { console.error('[profile] starred', e.message); }
  }

  if (netease.loggedIn()) {
    stats.sources.push('网易云');
    onProgress({ stage: '读取网易云每日推荐…', pct: 62 });
    try {
      const rec = await netease.dailyRecommend();
      if (rec.length) stats.ncm = '每日推荐示例 ' + rec.slice(0, 10).map((s) => `${s.artist} - ${s.title}`).join('、');
    } catch (e) { console.error('[profile] ncm', e.message); }
  }

  stats.topPlays = db.topPlays(15);
  stats.recentPlays = db.recentPlays(20).map((p) => `${p.artist} - ${p.title}`);

  onProgress({ stage: '汇总统计…', pct: 70 });
  const hasData = stats.artistsTop.length || stats.genresTop.length || stats.topPlays.length;
  if (!hasData) {
    onProgress({ stage: '没有可用数据（先连接音乐源）', pct: 100, done: true, empty: true, profile: '' });
    return { profile: '', stats, empty: true };
  }

  onProgress({ stage: 'AI 正在生成品味画像…', pct: 80 });
  let profileText = '';
  try {
    profileText = (await ask(buildPrompt(stats))).trim();
  } catch (e) {
    onProgress({ stage: '生成失败：' + e.message, pct: 100, error: e.message });
    return { profile: '', stats, error: e.message };
  }

  if (profileText) {
    ensureDir();
    fs.writeFileSync(FILE, renderMd(profileText, stats));
  }
  onProgress({ stage: '完成', pct: 100, done: true, profile: profileText });
  return { profile: profileText, stats };
}

export function getProfile() {
  try {
    if (!fs.existsSync(FILE)) return { exists: false, profile: '' };
    const raw = fs.readFileSync(FILE, 'utf8');
    const m = raw.match(/generatedAt:\s*(.+)/);
    const body = raw.replace(/^---[\s\S]*?---\n/, '').replace(/<!--[\s\S]*?-->/g, '').replace(/^#.*$/m, '').trim();
    return { exists: true, generatedAt: m?.[1]?.trim() || '', profile: body };
  } catch { return { exists: false, profile: '' }; }
}

// 供 context.js 读取（纯画像文本）
export function profileText() {
  const p = getProfile();
  return p.exists ? p.profile : '';
}
