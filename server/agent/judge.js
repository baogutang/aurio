// Post-generation judge for DJ lines. The ban list lives HERE, out of the
// generator prompt — naming a cliché in the prompt primes it (pink-elephant).
// Rule-based and deterministic; an LLM judge can layer on later. Crucially, the
// forbidden strings are NEVER fed back to the model: on a violation, dj.js
// regenerates with only the violated CATEGORY name, not the offending phrase.
import { db } from '../store.js';

// Default character budgets (counted in code points, so CJK counts as 1 each).
const SAY_MAX = 60;
const SEGUE_MAX = 45;

// Each rule maps a category code to the patterns that trip it. Order matters
// only for which detail we surface; a line can violate several categories.
const PHRASE_RULES = [
  {
    code: 'assistant_voice',
    patterns: [/根据你的需求/, /我将为你/, /以下是/, /希望你喜欢/, /为你精心挑选/, /接下来让我们/],
  },
  {
    code: 'stilted',
    patterns: [/不急着开太满/, /不用太赶/, /接进来/, /慢慢走/, /味道接进来/, /先挑几首线索/, /有点回潮/],
  },
  {
    code: 'meta_narration',
    patterns: [/理解(你的)?(意图|需求)/, /选曲/, /编排/, /找接法/, /挑选歌曲/, /安排(这段|这一段|节目)/],
  },
  {
    code: 'tech_words',
    patterns: [/\bAI\b/, /人工智能/, /模型/, /大脑/, /系统/, /\bJSON\b/i, /格式/, /设置/],
  },
];

// Strip whitespace, punctuation and symbols so repetition compares meaning, not
// formatting. Unicode-aware so it handles both CJK and ASCII punctuation.
function normalize(text) {
  return (text || '').toString().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function codePoints(text) {
  return Array.from(text || '');
}

const LEDGER_KEY = 'saidLedger';
const LEDGER_MAX = 40;      // reject an exact duplicate of any of the last ~40
const OPENING_WINDOW = 20;  // reject a shared opening 6-gram with the last ~20
const OPENING_N = 6;

function ledger() {
  const raw = db.getPref(LEDGER_KEY, []);
  return Array.isArray(raw) ? raw : [];
}

function opening(norm) {
  return codePoints(norm).slice(0, OPENING_N).join('');
}

// Record a line that actually aired so we don't say it again. Stores the
// normalized form only; caps at the last LEDGER_MAX entries.
export function rememberSaid(text) {
  const norm = normalize(text);
  if (!norm) return;
  const list = ledger();
  list.push(norm);
  if (list.length > LEDGER_MAX) list.splice(0, list.length - LEDGER_MAX);
  db.setPref(LEDGER_KEY, list);
}

// Returns 'exact' if the line duplicates a recent one, 'shared-opening' if it
// starts with the same 6-gram as a recent one, or '' if it's fresh.
export function isRepeat(text) {
  const norm = normalize(text);
  if (!norm) return '';
  const list = ledger();
  if (list.includes(norm)) return 'exact';
  const head = opening(norm);
  if (codePoints(head).length >= OPENING_N) {
    const recent = list.slice(-OPENING_WINDOW);
    if (recent.some((prev) => opening(prev) === head)) return 'shared-opening';
  }
  return '';
}

// judgeSay(text, opts) -> { ok, violations: [{ code, detail }] }
//   opts.segue     — apply the shorter segue budget
//   opts.maxLen    — override the character budget
//   opts.skipRepeat — don't check the said-before ledger
export function judgeSay(text, opts = {}) {
  const violations = [];
  const trimmed = (text || '').toString().trim();
  if (!trimmed) return { ok: true, violations }; // silence is a valid output

  for (const rule of PHRASE_RULES) {
    const hit = rule.patterns.find((p) => p.test(trimmed));
    if (hit) violations.push({ code: rule.code, detail: hit.source });
  }

  const max = opts.maxLen || (opts.segue ? SEGUE_MAX : SAY_MAX);
  const len = codePoints(trimmed).length;
  if (len > max) violations.push({ code: 'too_long', detail: `${len}/${max}` });

  if (!opts.skipRepeat) {
    const rep = isRepeat(trimmed);
    if (rep) violations.push({ code: 'repetition', detail: rep });
  }

  return { ok: violations.length === 0, violations };
}
