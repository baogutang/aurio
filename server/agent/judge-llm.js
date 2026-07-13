// The second judge layer, from RADIO_AUDIT idea 05. The rule judge (judge.js)
// catches diseases we have already NAMED; this layer answers the one question
// that cannot be enumerated: does the line sound like something a human host
// would say off the cuff? One post-generation call, category-only feedback
// through the same regeneration path as the rule judge, and it FAILS OPEN —
// judging infrastructure must never block airtime.
//
// Cost gate: dj.js only invokes it for scheduled/spoken kinds (never chat —
// the listener is waiting — and never refill). With the talk budget capping
// spoken breaks at 1–4 per hour, one extra call per break is affordable.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../config.js';
import { extractJson } from '../brain/parse.js';

export const HUMAN_JUDGE_CODES = new Set([
  'fabricated_listener', 'critic_voice', 'meta_narration',
  'assistant_voice', 'written_prose', 'unnatural',
]);

export function llmJudgeEnabled() {
  return process.env.AURIO_LLM_JUDGE !== 'off';
}

// Calibration negatives come from the voice bible, where real failures are
// archived with their category. They are shown ONLY to the judge — never to
// the generator — so quoting them here cannot prime the host.
let negativesCache = null;
function negatives() {
  if (negativesCache) return negativesCache;
  try {
    const raw = fs.readFileSync(path.join(ROOT, 'prompts', 'voice-bible.zh.json'), 'utf8');
    negativesCache = (JSON.parse(raw).negatives || []).slice(0, 6);
  } catch {
    negativesCache = [];
  }
  return negativesCache;
}

export function buildJudgePrompt(say, segue) {
  const lines = [];
  if (say) lines.push(`口播：「${say}」`);
  if (segue) lines.push(`垫话：「${segue}」`);
  const examples = negatives()
    .map((n) => `- 「${n.bad}」 → ${n.code}（${n.why}）`)
    .join('\n');
  return [
    '你是电台播出前的质检员。这位主播的常态是讲音乐小故事：一次开口 2–4 句，一个完整的故事弧。判断下面的口播像不像一个真人音乐电台主播随口讲出来的话——篇幅长不是问题，念稿感才是。',
    '',
    '不合格的类别：',
    '- fabricated_listener：猜测听众正在做什么（在忙、快回来了、想必…），而不是陈述真知道的事',
    '- critic_voice：给歌下判决、打分（该收了、败笔、一般般…）',
    '- meta_narration：暴露选曲、换歌、排队等后台机制',
    '- assistant_voice：客服、助手、外卖配送腔',
    '- written_prose：书面语句式——工整对仗、破折号串起的长句、念稿感（几句口语讲完一个故事不算；每句都像说出来的就合格）',
    '- unnatural：其他任何不像随口说话的地方',
    '',
    examples ? `不合格的例子：\n${examples}\n` : '',
    lines.join('\n'),
    '',
    '只输出一个原始 JSON，不要解释：合格输出 {"pass": true}；不合格输出 {"pass": false, "problems": ["类别", ...]}。拿不准就算合格。',
  ].filter((s) => s !== '').join('\n');
}

/**
 * judgeLikeHuman({ say, segue }, think) -> { pass, problems: [] }
 * `think` is injected (the same brain the generator uses) so tests can stub it.
 */
export async function judgeLikeHuman({ say = '', segue = '' } = {}, think) {
  if (!llmJudgeEnabled()) return { pass: true, problems: [] };
  if (!(say || '').trim() && !(segue || '').trim()) return { pass: true, problems: [] };
  try {
    const raw = await think(buildJudgePrompt(say, segue));
    const parsed = extractJson(typeof raw === 'string' ? raw : JSON.stringify(raw ?? ''));
    if (!parsed || typeof parsed.pass !== 'boolean') return { pass: true, problems: [] };
    if (parsed.pass) return { pass: true, problems: [] };
    const problems = (Array.isArray(parsed.problems) ? parsed.problems : [])
      .filter((p) => HUMAN_JUDGE_CODES.has(p));
    // A fail with no recognizable category is judge noise, not a verdict.
    if (!problems.length) return { pass: true, problems: [] };
    return { pass: false, problems };
  } catch {
    return { pass: true, problems: [] };
  }
}

/** Test seam. */
export function _resetNegativesCache() {
  negativesCache = null;
}
