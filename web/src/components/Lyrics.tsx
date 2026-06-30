import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import type { Track, LyricLine } from '../lib/types';

// active line = last line whose time <= currentTime (binary search; lines sorted)
function activeIndex(lines: LyricLine[], t: number): number {
  let lo = 0, hi = lines.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((lines[mid].time ?? 0) <= t) { ans = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return ans;
}

export default function Lyrics({ track, audioRef }: {
  track: Track | null;
  audioRef: React.RefObject<HTMLAudioElement>;
}) {
  const [lines, setLines] = useState<LyricLine[]>([]);
  const [synced, setSynced] = useState(false);
  const [active, setActive] = useState(-1);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<(HTMLParagraphElement | null)[]>([]);

  // Fetch lyrics whenever the track changes.
  useEffect(() => {
    if (!track?.id) { setLines([]); setSynced(false); setActive(-1); return; }
    let alive = true;
    api.lyrics({ source: track.source, id: track.id, title: track.title, artist: track.artist })
      .then((r) => { if (!alive) return; setLines(r.lines || []); setSynced(!!r.synced); setActive(-1); })
      .catch(() => { if (alive) { setLines([]); setSynced(false); } });
    return () => { alive = false; };
  }, [track?.source, track?.id]);

  // Track playback time → highlight current line.
  useEffect(() => {
    const a = audioRef.current;
    if (!a || !synced || !lines.length) return;
    const onTime = () => setActive(activeIndex(lines, a.currentTime));
    a.addEventListener('timeupdate', onTime);
    return () => a.removeEventListener('timeupdate', onTime);
  }, [audioRef, synced, lines]);

  // Auto-scroll inside the lyric panel only. scrollIntoView can move the app
  // shell itself, which makes the player layout jump while music is playing.
  useEffect(() => {
    const row = rowRefs.current[active];
    const container = containerRef.current;
    if (!row || !container) return;
    const target = row.offsetTop - (container.clientHeight - row.clientHeight) / 2;
    container.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
  }, [active]);

  if (!lines.length) {
    return <p className="lyrics-empty text-center text-[12px] text-[var(--text-muted)] py-3">暂无歌词</p>;
  }

  return (
    <div ref={containerRef} className="lyrics-panel scroll-panel py-2 text-center">
      {lines.map((l, i) => {
        const on = synced && i === active;
        return (
          <p
            key={i}
            ref={(el) => { rowRefs.current[i] = el; }}
            className={`leading-relaxed transition-all duration-300 ${
              on
                ? 'text-[14px] font-semibold text-[var(--text-primary)]'
                : 'text-[12px] text-[var(--text-muted)]'
            } ${synced ? 'py-1' : 'py-0.5'}`}
          >
            {l.text}
            {l.tr && <span className="block text-[11px] opacity-70 mt-0.5">{l.tr}</span>}
          </p>
        );
      })}
    </div>
  );
}
