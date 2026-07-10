// Post-generation judge for DJ lines. The ban list lives HERE, out of the
// generator prompt — naming a cliché in the prompt primes it (pink-elephant).
// Rule-based and deterministic; an LLM judge can layer on later. Crucially, the
// forbidden strings are NEVER fed back to the model: on a violation, dj.js
// regenerates with only the violated CATEGORY name, not the offending phrase.
//
// Banned phrases only catch the diseases we have already named. The disease that
// actually makes a host sound fake is structural: leaning on the same angle every
// single break ("《歌名》…上海还是闷…换点更清爽的", five times in a row). So the
// judge also tracks which ANGLE each aired line used and enforces separation on
// it — two breaks in a row on the weather is a motif, three is a tic.
import { db } from '../store.js';

// Default character budgets (counted in code points, so CJK counts as 1 each).
const SAY_MAX = 60;
const SEGUE_MAX = 45;

// Each rule maps a category code to the patterns that trip it. Order matters
// only for which detail we surface; a line can violate several categories.
const PHRASE_RULES = [
  {
    code: 'assistant_voice',
    patterns: [
      /根据你的需求/, /我将为你/, /以下是/, /希望你喜欢/, /为你精心挑选/, /接下来让我们/,
      // Acknowledgement openers: a host answers, an assistant confirms receipt.
      /^收到/, /^好的/, /^明白/, /^没问题/, /^这就/, /^遵命/,
    ],
  },
  {
    code: 'stilted',
    patterns: [/不急着开太满/, /不用太赶/, /接进来/, /慢慢走/, /味道接进来/, /先挑几首线索/, /有点回潮/],
  },
  {
    // The listener has no idea the host has a queue, a library or a source.
    // 「另挑」「重新排」 expose that a plan existed and was revised — same leak.
    code: 'meta_narration',
    patterns: [
      /理解(你的)?(意图|需求)/, /选曲/, /编排/, /找接法/, /挑选歌曲/, /安排(这段|这一段|节目)/,
      /队列/, /曲库/, /音源/, /缓存/, /插播/,
      /另挑/, /重新(挑|排|选)/, /换了几首/, /歌单/,
    ],
  },
  {
    code: 'tech_words',
    patterns: [/\bAI\b/, /人工智能/, /模型/, /大脑/, /系统/, /\bJSON\b/i, /格式/, /设置/],
  },
  {
    // Guessing the listener's life. A detector fact is STATED (「距上次收听
    // 23 天」); anything guessed — 忙完、手头、想必在… — is fabricated intimacy,
    // creepier than assistant voice because it impersonates knowing them.
    code: 'fabricated_listener',
    patterns: [
      /等你[^，。！？]{0,8}(忙|回来|回家|睡|醒|下班|吃完|做完)/,
      /你手头/, /你那边/, /忙完/, /想必/,
      /你(现在)?(肯定|应该|大概|多半|八成|一定还?)(在|是|还|正)/,
    ],
  },
  {
    // Verdicts on the song. A host points at a moment; a critic grades.
    code: 'critic_voice',
    patterns: [/就该(收|停|结束|完)/, /败笔/, /可惜了/, /一般般/, /这歌(不行|一般|不怎么样)/, /写(崩|砸)/],
  },
  {
    // Nobody speaks a semicolon. The broader balanced-prose disease (对仗、
    // 破折号长句) is a judgment call and lives in the LLM layer (judge-llm.js).
    code: 'written_prose',
    patterns: [/；/],
  },
];

// The angles a line can take. A break is interesting because it brings ONE
// concrete detail; reusing the same detail every time is what reads as canned.
//
// Chinese numerals count — "三点多" is a clock, "二十七度" is a temperature. But
// a bare "一点" is almost always the adverb ("收得松一点"), not one o'clock, so it
// only reads as a clock when a marker follows it.
const NUM = '[0-9零〇一二两三四五六七八九十百]';
const HOUR = '(?:\\d{1,2}|十一|十二|二十[一二三四]|[零〇二两三四五六七八九十])';
const CLOCK_MARK = '(?:半|整|钟|多|了|差|过|[零〇一二三四五六七八九十\\d]+分)';

const ANGLES = [
  { code: 'weather', re: new RegExp(`天气|气温|体感|闷|热|冷|凉|雨|风|晴|阴|湿|潮|云|雾|雪|霾|晒|阳光|${NUM}+\\s*度|度数`) },
  {
    code: 'clock',
    re: new RegExp(
      `凌晨|早上|上午|中午|下午|傍晚|晚上|半夜|深夜|这个点|点半|点整|点钟`
      + `|${HOUR}\\s*点`
      + `|一\\s*点\\s*${CLOCK_MARK}`,
    ),
  },
  { code: 'skip', re: /跳过|划掉|放下|不碰|先放|换点|换几首|换一首|别放|不喜欢/ },
  { code: 'title', re: /《[^》]*》/ },
  { code: 'memory', re: /上回|上次|还记得|一直|又是|第\s*\d+\s*(遍|次)|好久|多久|这周|上周|去年|当年/ },
  { code: 'music', re: /前奏|副歌|尾奏|这段|这句|唱|吉他|鼓|贝斯|键盘|现场|录音|专辑|翻唱|原版|\d{4}\s*年/ },
];

/** The set of angle codes a line leans on. */
export function anglesOf(text) {
  const t = (text || '').toString();
  return ANGLES.filter((a) => a.re.test(t)).map((a) => a.code);
}

// Strip whitespace, punctuation and symbols so repetition compares meaning, not
// formatting. Unicode-aware so it handles both CJK and ASCII punctuation.
function normalize(text) {
  return (text || '').toString().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function codePoints(text) {
  return Array.from(text || '');
}

function bigrams(norm) {
  const cp = codePoints(norm);
  const out = new Set();
  for (let i = 0; i < cp.length - 1; i++) out.add(cp[i] + cp[i + 1]);
  return out;
}

/** Sørensen–Dice over character bigrams. Catches near-duplicates, not paraphrase. */
function dice(a, b) {
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const g of A) if (B.has(g)) shared++;
  return (2 * shared) / (A.size + B.size);
}

const LEDGER_KEY = 'saidLedger';
const LEDGER_MAX = 40;      // reject an exact duplicate of any of the last ~40
const OPENING_WINDOW = 20;  // reject a shared opening 6-gram with the last ~20
const OPENING_N = 6;
const SIMILAR_WINDOW = 8;   // reject a near-duplicate of any of the last 8
const SIMILAR_THRESHOLD = 0.5;
const ANGLE_STREAK = 2;     // an angle may not run three aired lines in a row

// Entries are { n: normalizedText, a: angleCodes[] }. Legacy entries were bare
// strings; recompute their angles on read (punctuation is stripped but the words
// survive) so an upgrade does not silently start with an empty angle history.
function ledger() {
  const raw = db.getPref(LEDGER_KEY, []);
  if (!Array.isArray(raw)) return [];
  return raw
    .map((e) => (typeof e === 'string' ? { n: e, a: anglesOf(e) } : e))
    .filter((e) => e && e.n);
}

function opening(norm) {
  return codePoints(norm).slice(0, OPENING_N).join('');
}

/** Angles used by the last `n` aired lines, flattened and deduped. */
export function recentAngles(n = ANGLE_STREAK) {
  const recent = ledger().slice(-n);
  return [...new Set(recent.flatMap((e) => e.a || []))];
}

/** Test seam: clear the ledger between cases. */
export function _resetLedger() {
  db.setPref(LEDGER_KEY, []);
}

// Record a line that actually aired so we don't say it again. Stores the
// normalized form and its angles; caps at the last LEDGER_MAX entries.
export function rememberSaid(text) {
  const norm = normalize(text);
  if (!norm) return;
  const list = ledger();
  list.push({ n: norm, a: anglesOf(text) });
  if (list.length > LEDGER_MAX) list.splice(0, list.length - LEDGER_MAX);
  db.setPref(LEDGER_KEY, list);
}

// Returns 'exact' if the line duplicates a recent one, 'shared-opening' if it
// starts with the same 6-gram, 'similar' if it is a near-duplicate, or ''.
export function isRepeat(text) {
  const norm = normalize(text);
  if (!norm) return '';
  const list = ledger();
  if (list.some((e) => e.n === norm)) return 'exact';

  const head = opening(norm);
  if (codePoints(head).length >= OPENING_N) {
    const recent = list.slice(-OPENING_WINDOW);
    if (recent.some((e) => opening(e.n) === head)) return 'shared-opening';
  }

  const near = list.slice(-SIMILAR_WINDOW);
  if (near.some((e) => dice(norm, e.n) >= SIMILAR_THRESHOLD)) return 'similar';

  return '';
}

// Music schedulers enforce artist separation: the same artist may not play twice
// within N positions. The same discipline applied to ANGLES is what stops a host
// reaching for the weather every single break. Two in a row is a motif; three is
// a tic. A line with no recognizable angle is fine — it is probably just short.
export function isSameAngle(text) {
  const mine = anglesOf(text);
  if (!mine.length) return false;
  const last = ledger().slice(-ANGLE_STREAK);
  if (last.length < ANGLE_STREAK) return false;
  return mine.some((a) => last.every((e) => (e.a || []).includes(a)));
}

// judgeSay(text, opts) -> { ok, violations: [{ code, detail }] }
//   opts.segue      — apply the shorter segue budget
//   opts.maxLen     — override the character budget outright
//   opts.sayMax     — a show's tighter say budget (used when !opts.segue)
//   opts.segueMax   — a show's tighter segue budget (used when opts.segue)
//   opts.skipRepeat — don't check the said-before ledger or the angle ledger
// sayMax/segueMax let a programme (server/shows.js — 深夜航班 wants shorter
// lines) tighten the defaults without the call site knowing which budget
// applies; maxLen still wins when given.
export function judgeSay(text, opts = {}) {
  const violations = [];
  const trimmed = (text || '').toString().trim();
  if (!trimmed) return { ok: true, violations }; // silence is a valid output

  for (const rule of PHRASE_RULES) {
    const hit = rule.patterns.find((p) => p.test(trimmed));
    if (hit) violations.push({ code: rule.code, detail: hit.source });
  }

  const max = opts.maxLen
    || (opts.segue ? (opts.segueMax || SEGUE_MAX) : (opts.sayMax || SAY_MAX));
  const len = codePoints(trimmed).length;
  if (len > max) violations.push({ code: 'too_long', detail: `${len}/${max}` });

  if (!opts.skipRepeat) {
    const rep = isRepeat(trimmed);
    if (rep) violations.push({ code: 'repetition', detail: rep });
    if (isSameAngle(trimmed)) {
      violations.push({ code: 'same_angle', detail: anglesOf(trimmed).join('+') });
    }
  }

  return { ok: violations.length === 0, violations };
}
