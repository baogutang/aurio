// The LLM judge layer: category-gated verdicts, and fail-open everywhere —
// judging infrastructure must never block airtime.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { judgeLikeHuman, buildJudgePrompt, llmJudgeEnabled, _resetNegativesCache } from '../server/agent/judge-llm.js';

const SAY = '这首歌收在很轻的一句上。';

describe('llmJudgeEnabled', () => {
  afterEach(() => { delete process.env.AURIO_LLM_JUDGE; });

  it('defaults on, and off only for the literal "off"', () => {
    delete process.env.AURIO_LLM_JUDGE;
    expect(llmJudgeEnabled()).toBe(true);
    process.env.AURIO_LLM_JUDGE = 'on';
    expect(llmJudgeEnabled()).toBe(true);
    process.env.AURIO_LLM_JUDGE = 'off';
    expect(llmJudgeEnabled()).toBe(false);
  });
});

describe('buildJudgePrompt', () => {
  beforeEach(() => _resetNegativesCache());

  it('names the categories, quotes the line, and calibrates with bible negatives', () => {
    const p = buildJudgePrompt(SAY, '垫一句。');
    expect(p).toContain(SAY);
    expect(p).toContain('垫一句。');
    for (const code of ['fabricated_listener', 'critic_voice', 'meta_narration', 'written_prose', 'unnatural']) {
      expect(p).toContain(code);
    }
    // Negatives from the bible reach the judge (and only the judge).
    expect(p).toContain('不合格的例子');
    expect(p).toContain('"pass"');
  });
});

describe('judgeLikeHuman', () => {
  beforeEach(() => { delete process.env.AURIO_LLM_JUDGE; });
  afterEach(() => { delete process.env.AURIO_LLM_JUDGE; });

  it('passes a clean verdict through', async () => {
    const think = vi.fn().mockResolvedValue('{"pass": true}');
    expect(await judgeLikeHuman({ say: SAY }, think)).toEqual({ pass: true, problems: [] });
    expect(think).toHaveBeenCalledTimes(1);
  });

  it('returns recognized problem categories on a fail', async () => {
    const think = vi.fn().mockResolvedValue('{"pass": false, "problems": ["fabricated_listener", "critic_voice"]}');
    const v = await judgeLikeHuman({ say: SAY }, think);
    expect(v.pass).toBe(false);
    expect(v.problems).toEqual(['fabricated_listener', 'critic_voice']);
  });

  it('treats a fail with only unknown categories as judge noise, not a verdict', async () => {
    const think = vi.fn().mockResolvedValue('{"pass": false, "problems": ["too_spicy"]}');
    expect((await judgeLikeHuman({ say: SAY }, think)).pass).toBe(true);
  });

  it('fails open on prose, garbage, and thrown errors', async () => {
    for (const reply of ['这句挺好的，通过。', '{"verdict": 1}', '']) {
      const think = vi.fn().mockResolvedValue(reply);
      expect((await judgeLikeHuman({ say: SAY }, think)).pass).toBe(true);
    }
    const boom = vi.fn().mockRejectedValue(new Error('brain down'));
    expect((await judgeLikeHuman({ say: SAY }, boom)).pass).toBe(true);
  });

  it('extracts the verdict when the model wraps JSON in prose', async () => {
    const think = vi.fn().mockResolvedValue('结论如下：{"pass": false, "problems": ["unnatural"]} 以上。');
    const v = await judgeLikeHuman({ say: SAY }, think);
    expect(v).toEqual({ pass: false, problems: ['unnatural'] });
  });

  it('never calls the brain when disabled or when there is nothing to judge', async () => {
    const think = vi.fn();
    process.env.AURIO_LLM_JUDGE = 'off';
    expect((await judgeLikeHuman({ say: SAY }, think)).pass).toBe(true);
    delete process.env.AURIO_LLM_JUDGE;
    expect((await judgeLikeHuman({ say: '', segue: ' ' }, think)).pass).toBe(true);
    expect(think).not.toHaveBeenCalled();
  });
});
