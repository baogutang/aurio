import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Isolate the store's on-disk writes into a temp dir so the ledger doesn't touch
// the project's real state.json.
let tmpDir;
let judgeSay;
let rememberSaid;
let isRepeat;
let anglesOf;
let _resetLedger;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurio-dj-eval-'));
  process.env.AURIO_DATA_DIR = tmpDir;
  const url = pathToFileURL(path.resolve('server/agent/judge.js')).href;
  ({ judgeSay, rememberSaid, isRepeat, anglesOf, _resetLedger } = await import(`${url}?t=${Date.now()}`));
});

afterAll(() => {
  delete process.env.AURIO_DATA_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const bible = JSON.parse(fs.readFileSync(path.resolve('prompts/voice-bible.zh.json'), 'utf8'));

describe('voice bible exemplars pass the judge', () => {
  for (const ex of bible.links) {
    it(`link "${ex.id}" passes`, () => {
      const res = judgeSay(ex.say);
      expect(res.violations, JSON.stringify(res.violations)).toEqual([]);
      expect(res.ok).toBe(true);
    });
  }

  it('has at least one silent exemplar', () => {
    expect(bible.links.some((l) => l.say === '' && l.beat === 'silence')).toBe(true);
  });
});

describe('contrastive negatives fail with the expected code', () => {
  for (const neg of bible.negatives) {
    it(`"${neg.code}" negative is caught`, () => {
      const res = judgeSay(neg.bad);
      expect(res.ok).toBe(false);
      expect(res.violations.map((v) => v.code)).toContain(neg.code);
    });
  }
});

describe('category checks', () => {
  it('flags assistant voice', () => {
    expect(judgeSay('以下是为你精心挑选的歌单').violations.map((v) => v.code)).toContain('assistant_voice');
  });
  it('flags meta narration', () => {
    expect(judgeSay('我先理解你的意图再给你选曲').violations.map((v) => v.code)).toContain('meta_narration');
  });
  it('flags tech words', () => {
    expect(judgeSay('让我用模型帮你算一下').violations.map((v) => v.code)).toContain('tech_words');
  });
  it('flags guessing the listener\'s life (fabricated intimacy)', () => {
    // The real aired line from the first listening test, verbatim.
    const codes = judgeSay('再过两首就到你这儿——等你手头那阵忙完，富士山下就来。').violations.map((v) => v.code);
    expect(codes).toContain('fabricated_listener');
    expect(judgeSay('你现在肯定在加班吧，这首给你。').violations.map((v) => v.code)).toContain('fabricated_listener');
  });
  it('flags critic verdicts and queue-revision leaks', () => {
    // The second aired failure: a verdict on the song plus queue mechanics.
    const codes = judgeSay('这首唱到「霓虹在雨里慢慢化开」那句就该收了，后面几首我另挑了。').violations.map((v) => v.code);
    expect(codes).toContain('critic_voice');
    expect(codes).toContain('meta_narration');
  });
  it('flags spoken semicolons as written prose', () => {
    expect(judgeSay('外面在下雨；歌接着放。').violations.map((v) => v.code)).toContain('written_prose');
  });
  it('lets a real line through', () => {
    expect(judgeSay('一点十七，这个点还醒着的，都差不多。').ok).toBe(true);
  });
  it('lets a proper hotline confirmation through', () => {
    expect(judgeSay('《假想曲》排上了，前面还有两首，别走开。', { skipRepeat: true }).ok).toBe(true);
  });
});

// P5（决策记录 2026-07-13）：默认口播预算 60→160（2–4 句一个故事弧）、
// 垫话 45→60。计数语义不变：按 code point 数，CJK 每字算 1。
describe('CJK length counting', () => {
  it('counts CJK chars by code point, not UTF-16 units', () => {
    expect(judgeSay('字'.repeat(160)).ok).toBe(true);
    const over = judgeSay('字'.repeat(161));
    expect(over.ok).toBe(false);
    expect(over.violations.map((v) => v.code)).toContain('too_long');
  });
  it('applies the tighter segue budget', () => {
    expect(judgeSay('字'.repeat(60), { segue: true }).ok).toBe(true);
    expect(judgeSay('字'.repeat(61), { segue: true }).violations.map((v) => v.code)).toContain('too_long');
  });
  it('does not miscount a surrogate-pair emoji as two chars', () => {
    // 159 CJK + one astral emoji = 160 code points, exactly at budget.
    expect(judgeSay('字'.repeat(159) + '\u{1F600}').ok).toBe(true);
  });
});

describe('said-before ledger', () => {
  it('rejects an exact repeat', () => {
    const line = '晚上好，这是今天第一首。';
    expect(isRepeat(line)).toBe('');
    rememberSaid(line);
    expect(isRepeat(line)).toBe('exact');
    // Same content, different punctuation/spacing still counts as exact.
    expect(isRepeat('晚上好 这是今天第一首')).toBe('exact');
  });

  it('rejects a shared opening 6-gram', () => {
    rememberSaid('凌晨三点了我放最后一首。');
    // Same opening six characters, different tail → shared-opening.
    expect(isRepeat('凌晨三点了我们慢慢收尾。')).toBe('shared-opening');
    // Different opening → fresh.
    expect(isRepeat('外面下雨了，窗户关了没。')).toBe('');
  });

  it('surfaces repetition through judgeSay', () => {
    rememberSaid('这首歌陪你到天亮。');
    const res = judgeSay('这首歌陪你到天亮。');
    expect(res.ok).toBe(false);
    expect(res.violations.map((v) => v.code)).toContain('repetition');
  });
});

// ---------------------------------------------------------------------------
// Regression: the lines a real listener screenshotted on 2026-07-03 / 07-09 and
// called 「根本不是人话」. Every one of them passed the phrase-only judge. The
// failure was never a banned phrase — it was the same angle, break after break.
// ---------------------------------------------------------------------------
describe('angle separation (the 2026-07 screenshot)', () => {
  beforeEach(() => _resetLedger());

  const AIRED = [
    '三点多上海热得发闷，先来几首清爽点的。',
    '《降雨机率》先不碰了，上海这会儿闷热，后面换得干一点。',
    '《经过》就先放下了，三点半的上海太闷，换几首更干净、有点风的。',
    '《My Jinji》先划掉，外面热成这样，别再晃了，换点更利落的。',
    '八点差两分，上海还是闷的，刚才那些黏的先放下。',
    '八点整，歌停在周杰伦这首，上海二十七度还是闷。',
  ];

  it('lets two weather breaks through, then stops the third', () => {
    const verdicts = AIRED.map((line) => {
      const r = judgeSay(line);
      if (r.ok) rememberSaid(line);
      return r.ok;
    });
    expect(verdicts.slice(0, 2)).toEqual([true, true]);
    expect(verdicts.slice(2)).toEqual([false, false, false, false]);
  });

  it('names same_angle, not a phrase rule', () => {
    rememberSaid(AIRED[0]);
    rememberSaid(AIRED[1]);
    const r = judgeSay(AIRED[2]);
    expect(r.ok).toBe(false);
    expect(r.violations.map((v) => v.code)).toContain('same_angle');
  });

  it('reads Chinese numerals as clocks and temperatures', () => {
    expect(anglesOf('三点多上海热得发闷')).toEqual(expect.arrayContaining(['clock', 'weather']));
    expect(anglesOf('上海二十七度还是闷')).toContain('weather');
    expect(anglesOf('十一点半了')).toContain('clock');
  });

  it('lets a fresh angle through after two weather breaks', () => {
    rememberSaid(AIRED[0]);
    rememberSaid(AIRED[1]);
    expect(judgeSay('这首 2003 年的，副歌那句吉他你听。').ok).toBe(true);
    expect(judgeSay('你这周第四遍放它了，我不拦。').ok).toBe(true);
  });

  it('rejects acknowledgement openers as assistant voice', () => {
    for (const line of ['收到，刚跳过《椿》，后面换点不黏的。', '好的，这就换。', '明白，换一首。']) {
      const r = judgeSay(line, { skipRepeat: true });
      expect(r.ok).toBe(false);
      expect(r.violations.map((v) => v.code)).toContain('assistant_voice');
    }
  });

  it('never rejects silence', () => {
    rememberSaid(AIRED[0]);
    rememberSaid(AIRED[1]);
    expect(judgeSay('').ok).toBe(true);
  });
});

// 「一点」 is almost always the adverb ("收得松一点"), not one o'clock. A false
// clock reading poisons the angle ledger and makes the judge reject good lines.
describe('clock detection does not fire on 「一点」the adverb', () => {
  it.each([
    '后面我给你收得松一点。',
    '后面留一点空给《苏州河》。',
    '有点闷。',
  ])('%s is not a clock', (line) => {
    expect(anglesOf(line)).not.toContain('clock');
  });

  it.each([
    '三点多上海热得发闷',
    '八点整，歌停在这首。',
    '八点差两分。',
    '十一点半了。',
    '一点十七，这个点还醒着的。',
    '凌晨了，放最后一首。',
  ])('%s is a clock', (line) => {
    expect(anglesOf(line)).toContain('clock');
  });
});

// The listener does not know the host has a queue, a library, or a "source".
describe('internal vocabulary is meta-narration', () => {
  it.each(['队列还没开头，周杰伦先放前面。', '曲库里没这首。', '换个音源试试。'])('%s is rejected', (line) => {
    const r = judgeSay(line, { skipRepeat: true });
    expect(r.ok).toBe(false);
    expect(r.violations.map((v) => v.code)).toContain('meta_narration');
  });
});
