import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../context/PreferencesContext';
import type { Track, LyricLine } from '../lib/types';

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
  const { t } = useI18n();
  const [lines, setLines] = useState<LyricLine[]>([]);
  const [synced, setSynced] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<(HTMLParagraphElement | null)[]>([]);
  const scrollRaf = useRef(0);
  const lastScrollActive = useRef(-1);

  useEffect(() => {
    rowRefs.current = [];
    lastScrollActive.current = -1;
    if (containerRef.current) containerRef.current.scrollTop = 0;
    if (!track?.id) {
      setLines([]);
      setSynced(false);
      setActive(-1);
      setLoading(false);
      return;
    }
    setLines([]);
    setSynced(false);
    setActive(-1);
    setLoading(true);
    let alive = true;
    api.lyrics({ source: track.source, id: track.id, title: track.title, artist: track.artist })
      .then((r) => {
        if (!alive) return;
        setLines(r.lines || []);
        setSynced(!!r.synced);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setLines([]);
        setSynced(false);
        setLoading(false);
      });
    return () => { alive = false; };
  }, [track?.source, track?.id, track?.title, track?.artist]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a || !synced || !lines.length) return;
    const onTime = () => setActive(activeIndex(lines, a.currentTime));
    onTime();
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('seeked', onTime);
    return () => {
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('seeked', onTime);
    };
  }, [audioRef, synced, lines]);

  useEffect(() => {
    if (active < 0) return;
    cancelAnimationFrame(scrollRaf.current);
    scrollRaf.current = requestAnimationFrame(() => {
      const row = rowRefs.current[active];
      const container = containerRef.current;
      if (!row || !container) return;
      const target = row.offsetTop - (container.clientHeight - row.offsetHeight) / 2;
      const jump = Math.abs(active - lastScrollActive.current) > 2;
      lastScrollActive.current = active;
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      container.scrollTo({
        top: Math.max(0, target),
        behavior: reduced || jump ? 'auto' : 'smooth',
      });
    });
    return () => cancelAnimationFrame(scrollRaf.current);
  }, [active]);

  if (loading) {
    return <p className="lyrics-empty text-center text-[12px] text-[var(--text-muted)] py-3">{t('lyricsLoading')}</p>;
  }

  if (!lines.length) {
    return <p className="lyrics-empty text-center text-[12px] text-[var(--text-muted)] py-3">{t('lyricsEmpty')}</p>;
  }

  return (
    <div ref={containerRef} className="lyrics-panel scroll-panel py-2 text-center">
      {synced && (
        <p className="font-mono text-[8px] uppercase tracking-[0.2em] text-[rgb(var(--hi-rgb))] mb-1 opacity-70">
          {t('lyricsSynced')}
        </p>
      )}
      {lines.map((l, i) => {
        const on = synced && i === active;
        return (
          <p
            key={`${l.time ?? 'x'}-${i}`}
            ref={(el) => { rowRefs.current[i] = el; }}
            className={`leading-relaxed transition-colors duration-200 ${
              on
                ? 'text-[15px] font-semibold text-[var(--text-primary)] py-1.5'
                : 'text-[12px] text-[var(--text-muted)] py-0.5'
            }`}
          >
            {l.text}
            {l.tr && <span className="block text-[11px] opacity-70 mt-0.5">{l.tr}</span>}
          </p>
        );
      })}
    </div>
  );
}
