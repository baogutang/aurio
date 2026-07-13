import { describe, it, expect } from 'vitest';
import { deriveStyleTags } from './stationCard';

// The profile generator asks for 2–4 sentences of prose plus one trailing
// keyword line「用 · 分隔」(server/taste-profile.js).
const CANONICAL = [
  '你偏爱九十年代的粤语流行与器乐后摇，深夜常听纯音乐。',
  '整体口味安静、旋律优先，对电子舞曲兴趣不大。',
  '',
  '粤语流行 · 后摇 · 纯音乐 · 城市民谣 · 深夜电台',
].join('\n');

describe('deriveStyleTags', () => {
  it('parses the trailing ·-separated keyword line', () => {
    expect(deriveStyleTags(CANONICAL)).toEqual([
      '粤语流行', '后摇', '纯音乐', '城市民谣', '深夜电台',
    ]);
  });

  it('strips a 「关键词标签：」 label and accepts 、-separators after it', () => {
    const text = '喜欢老歌。\n关键词标签：民谣、爵士、City Pop';
    expect(deriveStyleTags(text)).toEqual(['民谣', '爵士', 'City Pop']);
  });

  it('accepts an English "Tags:" label', () => {
    const text = 'Mostly instrumental listening.\nTags: post-rock, ambient, jazz';
    expect(deriveStyleTags(text)).toEqual(['post-rock', 'ambient', 'jazz']);
  });

  it('does not invent tags from comma-separated prose', () => {
    const text = '我喜欢民谣，也喜欢摇滚，还有一点电子。\n平时通勤听得多，周末听整张专辑。';
    expect(deriveStyleTags(text)).toEqual([]);
  });

  it('rejects a ·-line whose tokens read like sentences', () => {
    const text = '概括如下 · 你在深夜听歌时偏爱器乐并且经常整张专辑循环播放！';
    expect(deriveStyleTags(text)).toEqual([]);
  });

  it('caps at max and dedupes while keeping order', () => {
    const text = 'x\na · b · a · c · d · e · f · g · h · i';
    expect(deriveStyleTags(text, 4)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('degrades to [] for a missing or empty profile', () => {
    expect(deriveStyleTags(null)).toEqual([]);
    expect(deriveStyleTags(undefined)).toEqual([]);
    expect(deriveStyleTags('')).toEqual([]);
  });

  it('picks the LAST tag line when several lines qualify', () => {
    const text = '摇滚 · 朋克\n后来的画像\n民谣 · 爵士';
    expect(deriveStyleTags(text)).toEqual(['民谣', '爵士']);
  });
});
