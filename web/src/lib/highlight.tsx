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
export function renderSay(text: string, variant: 'card' | 'dark' = 'card'): React.ReactNode {
  text = cleanSayText(text);
  if (!text) return '…';
  const hiCls = variant === 'dark' ? 'say-highlight-dark' : 'say-highlight-card';
  return text.split(/(\*[^*]+\*)/g).map((p, i) =>
    p.startsWith('*') && p.endsWith('*')
      ? <span key={i} className={hiCls}>{p.slice(1, -1)}</span>
      : <React.Fragment key={i}>{p}</React.Fragment>
  );
}
