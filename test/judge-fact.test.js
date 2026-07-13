import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// fabricated_fact（决策记录 2026-07-13：掌故只讲可验证的）— every 4-digit year
// and every 《…》 title in a spoken line must appear in the material text the
// prompt actually carried. Enforced ONLY when opts.material is provided, so
// every legacy judgeSay caller keeps its old semantics.
let tmpDir;
let judgeSay;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurio-judge-fact-'));
  process.env.AURIO_DATA_DIR = tmpDir;
  const url = pathToFileURL(path.resolve('server/agent/judge.js')).href;
  ({ judgeSay } = await import(`${url}?t=${Date.now()}`));
});

afterAll(() => {
  delete process.env.AURIO_DATA_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Invented material card: now-playing metadata + story facts, the same text
// dj.js hands the judge.
const MATERIAL = [
  '正在播放: 虚构乐队《虚构之夜》（2019，专辑《假想集》，民谣）',
  '  这首歌的歌手/专辑可讲的掌故（括号里是出处片段）:',
  '  - 虚构乐队 2015 年成立于青岛（出处：2015年成立于青岛）',
  '  - 《假想集》发行于 2019 年（出处：发行时间 2019）',
].join('\n');

const codes = (r) => r.violations.map((v) => v.code);

describe('fabricated_fact matrix', () => {
  it('a year present in the material passes', () => {
    const r = judgeSay('这张是 2019 年冬天录的，你听那口气。', { material: MATERIAL, skipRepeat: true });
    expect(codes(r)).not.toContain('fabricated_fact');
  });

  it('a year absent from the material is rejected', () => {
    const r = judgeSay('这首是 1971 年录的，那年他们刚出道。', { material: MATERIAL, skipRepeat: true });
    expect(r.ok).toBe(false);
    expect(r.violations).toContainEqual({ code: 'fabricated_fact', detail: '年份 1971' });
  });

  it('the current track title in 《…》 passes (it is in the material line)', () => {
    const r = judgeSay('《虚构之夜》就到这儿。', { material: MATERIAL, skipRepeat: true });
    expect(codes(r)).not.toContain('fabricated_fact');
  });

  it('an unknown 《album》 is rejected', () => {
    const r = judgeSay('这首收在《不存在的精选》里。', { material: MATERIAL, skipRepeat: true });
    expect(r.ok).toBe(false);
    expect(r.violations).toContainEqual({ code: 'fabricated_fact', detail: '《不存在的精选》' });
  });

  it('without material the check is skipped entirely', () => {
    expect(codes(judgeSay('这首是 1971 年录的，收在《不存在的精选》里。', { skipRepeat: true })))
      .not.toContain('fabricated_fact');
    expect(codes(judgeSay('这首是 1971 年录的。', { material: '', skipRepeat: true })))
      .not.toContain('fabricated_fact');
    expect(codes(judgeSay('这首是 1971 年录的。', { material: '   ', skipRepeat: true })))
      .not.toContain('fabricated_fact');
  });

  it('applies to segues through the same option', () => {
    const bad = judgeSay('接一首《不存在的精选》里的。', { segue: true, skipRepeat: true, material: MATERIAL });
    expect(codes(bad)).toContain('fabricated_fact');
    const good = judgeSay('接着《假想集》往下走。', { segue: true, skipRepeat: true, material: MATERIAL });
    expect(codes(good)).not.toContain('fabricated_fact');
  });

  it('every offending year/title is reported, not just the first', () => {
    const r = judgeSay('1971 年的《不存在的精选》，1988 年再版。', { material: MATERIAL, skipRepeat: true });
    const details = r.violations.filter((v) => v.code === 'fabricated_fact').map((v) => v.detail);
    expect(details).toEqual(expect.arrayContaining(['年份 1971', '年份 1988', '《不存在的精选》']));
  });

  it('latin titles match whitespace-blind', () => {
    const mat = '正在播放: Nobody《Fake  Album Name》（2001）';
    const r = judgeSay('这张《Fake Album Name》你听听。', { material: mat, skipRepeat: true });
    expect(codes(r)).not.toContain('fabricated_fact');
  });

  it('a year inside a spoken 《title》 counts as that title, not a loose year', () => {
    const mat = '正在播放: 某人《1997 手记》（1997）';
    const r = judgeSay('《1997 手记》这张，你听。', { material: mat, skipRepeat: true });
    expect(codes(r)).not.toContain('fabricated_fact');
  });

  it('deliberate gap: Chinese-numeral years escape the 4-digit check', () => {
    const r = judgeSay('这首是一九七一年录的。', { material: MATERIAL, skipRepeat: true });
    expect(codes(r)).not.toContain('fabricated_fact');
  });

  it('a longer digit run is not misread as a year', () => {
    const r = judgeSay('编号 202501 的现场版本。', { material: MATERIAL, skipRepeat: true });
    expect(codes(r)).not.toContain('fabricated_fact');
  });
});
