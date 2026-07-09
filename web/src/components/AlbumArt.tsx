import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { coverUrl } from '../lib/cover';
import { spring } from '../lib/motion';
import { extractSwatch, type RGB } from '../lib/swatch';
import type { Track } from '../lib/types';

interface Props {
  track: Track | null;
  size?: number;
  onSwatch?: (rgb: RGB | null) => void;
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The one place album art is ever shown. The art is served same-origin by
 * GET /api/cover/:source/:id (see lib/cover.ts), which may 404 for a track with
 * no cover — onError swaps to the fallback and never retries, since the <img>
 * is keyed by URL so a new track starts a clean load.
 *
 * No art / failed load falls back to a dot-matrix tile carrying the track's
 * first glyph in the brand mono face — the same dot surface as the spectrum and
 * the clock, so an empty cover still reads as part of the same instrument (and,
 * unlike a bitmap font, it renders CJK titles as-is).
 */
export default function AlbumArt({ track, size = 64, onSwatch }: Props) {
  const url = coverUrl(track);
  const [errored, setErrored] = useState(false);
  // Guards onSwatch against out-of-order loads: a stale <img> mid-unload must
  // not overwrite the colour of the track that is actually showing.
  const latestRef = useRef<string | null>(url);
  latestRef.current = url;

  useEffect(() => {
    setErrored(false);
    if (!url) onSwatch?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const initial = (track?.title?.trim()?.[0] ?? '♪').toUpperCase();
  const showArt = Boolean(url) && !errored;
  const contentKey = showArt ? (url as string) : `fallback:${initial}`;
  const reduce = prefersReducedMotion();
  const transition = reduce ? { duration: 0 } : spring.gentle;

  const handleLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    if (url !== latestRef.current) return;
    onSwatch?.(extractSwatch(e.currentTarget));
  };
  const handleError = () => {
    if (url !== latestRef.current) return;
    setErrored(true);
    onSwatch?.(null);
  };

  return (
    <div
      className="relative overflow-hidden"
      style={{ width: size, height: size, borderRadius: 14 }}
    >
      <AnimatePresence initial={false}>
        <motion.div
          key={contentKey}
          className="absolute inset-0"
          initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 1.04 }}
          animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={transition}
        >
          {showArt ? (
            <img
              src={url as string}
              alt=""
              onLoad={handleLoad}
              onError={handleError}
              draggable={false}
              className="h-full w-full object-cover"
            />
          ) : (
            <div
              className="panel-dot flex h-full w-full items-center justify-center"
              style={{ borderRadius: 14 }}
              aria-hidden
            >
              <span
                className="font-matrix leading-none"
                style={{ fontSize: size * 0.42, color: 'rgb(var(--accent-rgb))' }}
              >
                {initial}
              </span>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
