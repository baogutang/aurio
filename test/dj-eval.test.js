import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurio-dj-eval-'));
  process.env.AURIO_DATA_DIR = tmpDir;
  const url = pathToFileURL(path.resolve('server/agent/judge.js')).href;
  ({ judgeSay, rememberSaid, isRepeat } = await import(`${url}?t=${Date.now()}`));
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
  it('lets a real line through', () => {
    expect(judgeSay('一点十七，这个点还醒着的，都差不多。').ok).toBe(true);
  });
});

describe('CJK length counting', () => {
  it('counts CJK chars by code point, not UTF-16 units', () => {
    expect(judgeSay('字'.repeat(60)).ok).toBe(true);
    const over = judgeSay('字'.repeat(61));
    expect(over.ok).toBe(false);
    expect(over.violations.map((v) => v.code)).toContain('too_long');
  });
  it('applies the tighter segue budget', () => {
    expect(judgeSay('字'.repeat(45), { segue: true }).ok).toBe(true);
    expect(judgeSay('字'.repeat(46), { segue: true }).violations.map((v) => v.code)).toContain('too_long');
  });
  it('does not miscount a surrogate-pair emoji as two chars', () => {
    // 59 CJK + one astral emoji = 60 code points, under budget.
    expect(judgeSay('字'.repeat(59) + '\u{1F600}').ok).toBe(true);
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
