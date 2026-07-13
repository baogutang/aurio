// 台卡 (station profile card) — pure logic.
//
// Genre tags come from the auto taste profile (/api/profile). The profile
// generator (server/taste-profile.js) asks for 2–4 sentences of prose followed
// by ONE keyword-tag line「用 · 分隔」, so the parser scans from the bottom for
// a line that splits into several short tokens. Models drift, so it also
// accepts a labelled tag line (「标签：」/"Tags:") with looser separators.
// Anything that still reads like a sentence is rejected — no tags is an
// honest answer and the card degrades gracefully.

/** Strong separators the prompt asks for; safe to split on anywhere. */
const STRONG_SEP = /[·・•|/]+/;
/** Loose separators (Chinese enumeration/commas) — only trusted after a label. */
const LOOSE_SEP = /[·・•|/、，,;；]+/;
/** A leading「关键词标签：」/"Tags:" style label. */
const LABEL_RE = /^[（(【[]?\s*(?:关键词标签|风格标签|关键词|标签|tags?|keywords?)\s*[:：\]】)）]\s*/i;

const MAX_TAG_CHARS = 12;

function tagsFromLine(line: string): string[] {
  const labelled = LABEL_RE.test(line);
  const body = line.replace(LABEL_RE, '');
  // Without a label we only trust the separator the prompt prescribes —
  // splitting prose on ordinary commas invents tags that were never there.
  const sep = labelled ? LOOSE_SEP : STRONG_SEP;
  if (!labelled && !STRONG_SEP.test(body)) return [];
  const parts = body
    .split(sep)
    .map((s) => s.replace(/^[#＃\s]+/, '').trim())
    .filter(Boolean);
  if (parts.length < 2) return [];
  // Tags are short tokens; a sentence fragment (long, or carrying sentence
  // punctuation) disqualifies the whole line.
  if (!parts.every((p) => p.length <= MAX_TAG_CHARS && !/[。！？!?：:]/.test(p))) return [];
  return [...new Set(parts)];
}

/**
 * Best-effort style tags from the taste-profile text. Returns [] when the
 * profile is missing or no line parses as a tag line — the card hides the
 * section rather than inventing taste.
 */
export function deriveStyleTags(profileText: string | null | undefined, max = 8): string[] {
  if (!profileText) return [];
  const lines = profileText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const tags = tagsFromLine(lines[i]);
    if (tags.length) return tags.slice(0, max);
  }
  return [];
}
