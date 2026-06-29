// LRC parsing helpers. Turns raw lyric text into time-stamped lines the player
// can highlight against audio.currentTime. Handles multi-stamp lines
// (`[t1][t2]text`), `.xx`/`.xxx` fractions, metadata tags, and a parallel
// translation track that gets merged onto matching lines as `tr`.

const TIME = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

// → [{ time: <seconds, number>, text }]  (sorted, metadata/empty stamps dropped)
export function parseLrc(text) {
  if (!text) return [];
  const out = [];
  for (const raw of String(text).split(/\r?\n/)) {
    TIME.lastIndex = 0;
    const stamps = [];
    let m;
    let lastEnd = 0;
    while ((m = TIME.exec(raw))) {
      const frac = m[3] ? Number(`0.${m[3]}`) : 0;
      stamps.push(Number(m[1]) * 60 + Number(m[2]) + frac);
      lastEnd = TIME.lastIndex;
    }
    if (!stamps.length) continue; // no timestamp → metadata or plain line
    const txt = raw.slice(lastEnd).trim();
    if (!txt) continue; // empty body (e.g. trailing [by:] tags)
    for (const t of stamps) out.push({ time: Number(t.toFixed(2)), text: txt });
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}

// Plain (un-timed) lyrics → one line per non-empty text line, time = null.
export function plainLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((t) => ({ time: null, text: t }));
}

// Merge a translation LRC onto main lines by matching timestamp (±0 ms).
export function mergeTranslation(lines, trText) {
  const tr = parseLrc(trText);
  if (!tr.length) return lines;
  const key = (t) => Math.round(t * 1000);
  const map = new Map(tr.map((l) => [key(l.time), l.text]));
  return lines.map((l) => {
    const t = l.time != null ? map.get(key(l.time)) : undefined;
    return t ? { ...l, tr: t } : l;
  });
}
