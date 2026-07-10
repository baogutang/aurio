import React from 'react';

export function cleanSayText(text: string): string {
  if (!text) return '';
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const body = fenced ? fenced[1].trim() : trimmed;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const obj = JSON.parse(body.slice(start, end + 1));
      if (typeof obj?.say === 'string' && obj.say.trim()) return obj.say.trim();
    } catch {
      // Keep the original text when it is not parseable JSON-ish content.
    }
  }
  const loose = body.match(/\\?"say\\?"\s*:\s*\\?"([\s\S]*?)\\?"\s*,\s*\\?"play\\?"/);
  if (loose?.[1]) return loose[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim();
  return text;
}

// Aurio patter may wrap keywords in *asterisks*; render those highlighted.
// `reveal` (0..1) paces a per-code-point reveal while the DJ voice plays —
// slicing happens inside the parsed segments so a half-revealed highlight
// never leaks its raw `*` markers. null/undefined renders the whole text.
export function renderSay(
  text: string,
  variant: 'card' | 'dark' = 'card',
  reveal?: number | null,
): React.ReactNode {
  text = cleanSayText(text);
  if (!text) return '…';
  const hiCls = variant === 'dark' ? 'say-highlight-dark' : 'say-highlight-card';
  const parts = text.split(/(\*[^*]+\*)/g).map((p) => {
    const hi = p.startsWith('*') && p.endsWith('*');
    return { hi, chars: Array.from(hi ? p.slice(1, -1) : p) };
  });

  let quota = Infinity;
  if (reveal != null) {
    const total = parts.reduce((n, p) => n + p.chars.length, 0);
    quota = Math.ceil(total * Math.min(1, Math.max(0, reveal)));
  }

  return parts.map((p, i) => {
    if (quota <= 0) return null;
    const shown = p.chars.length <= quota ? p.chars : p.chars.slice(0, quota);
    quota -= shown.length;
    const body = shown.join('');
    return p.hi
      ? <span key={i} className={hiCls}>{body}</span>
      : <React.Fragment key={i}>{body}</React.Fragment>;
  });
}
