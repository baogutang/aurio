type IconProps = { className?: string; size?: number };

/** Transport row: one stroke weight, fixed glyph boxes (see .transport-glyph in index.css). */
export const TRANSPORT_STROKE = 1.75;
export const TRANSPORT_GHOST_SIZE = 18;
export const TRANSPORT_PLAY_SIZE = 24;

const strokeProps = {
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: TRANSPORT_STROKE,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function IconMic({ className, size = 20 }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" x2="12" y1="19" y2="22" />
    </svg>
  );
}

export function IconChat({ className, size = 20 }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export function IconSettings({ className, size = 20 }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/** Nudge glyphs down — heart/skip art sits high in 24×24 viewBox. */
const GHOST_GROUP = 'translate(0 1.25)';

export function IconPrev({ className, size }: IconProps) {
  const dim = size ?? TRANSPORT_GHOST_SIZE;
  return (
    <svg className={className} width={dim} height={dim} viewBox={GHOST_VIEW} aria-hidden>
      <g transform={GHOST_GROUP}>
        <path d="M7 5.5v11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M10.5 11 17.5 6.2v9.6L10.5 11z" {...strokeProps} />
      </g>
    </svg>
  );
}

export function IconNext({ className, size }: IconProps) {
  const dim = size ?? TRANSPORT_GHOST_SIZE;
  return (
    <svg className={className} width={dim} height={dim} viewBox={GHOST_VIEW} aria-hidden>
      <g transform={GHOST_GROUP}>
        <path d="M17 5.5v11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M13.5 11 6.5 6.2v9.6L13.5 11z" {...strokeProps} />
      </g>
    </svg>
  );
}

export function IconPlay({ className, size }: IconProps) {
  const dim = size ?? TRANSPORT_PLAY_SIZE;
  return (
    <svg className={className} width={dim} height={dim} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M9.25 7v10l8.75-5-8.75-5z" />
    </svg>
  );
}

export function IconPause({ className, size }: IconProps) {
  const dim = size ?? TRANSPORT_PLAY_SIZE;
  return (
    <svg className={className} width={dim} height={dim} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="7" y="6.5" width="4" height="11" rx="1" />
      <rect x="13" y="6.5" width="4" height="11" rx="1" />
    </svg>
  );
}

const GHOST_VIEW = '0 0 24 24';

const HEART_PATH =
  'M19.5 12.572 12 20.25l-7.5-7.678A5.25 5.25 0 1 1 12 6.343a5.25 5.25 0 1 1 7.5 6.229Z';

const HEART_CRACK = 'M11.35 7.1 12.05 9.55 10.75 11.85 12.1 14.15 10.95 16.45';

export function IconHeart({ className, size, filled = false }: IconProps & { filled?: boolean }) {
  const dim = size ?? TRANSPORT_GHOST_SIZE;
  return (
    <svg
      className={className}
      width={dim}
      height={dim}
      viewBox={GHOST_VIEW}
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={TRANSPORT_STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <g transform={GHOST_GROUP}>
        <path d={HEART_PATH} />
      </g>
    </svg>
  );
}

/** Same heart outline + crack; always outline (pairs with filled/outline heart). */
export function IconDislike({ className, size }: IconProps) {
  const dim = size ?? TRANSPORT_GHOST_SIZE;
  return (
    <svg
      className={className}
      width={dim}
      height={dim}
      viewBox={GHOST_VIEW}
      fill="none"
      stroke="currentColor"
      strokeWidth={TRANSPORT_STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <g transform={GHOST_GROUP}>
        <path d={HEART_PATH} />
        <path d={HEART_CRACK} />
      </g>
    </svg>
  );
}

/** Sleep timer: a crescent — same single stroke weight as the transport row. */
export function IconMoon({ className, size }: IconProps) {
  const dim = size ?? TRANSPORT_GHOST_SIZE;
  return (
    <svg className={className} width={dim} height={dim} viewBox="0 0 24 24" aria-hidden>
      <path d="M20 13.5A8.5 8.5 0 0 1 10.5 4 8.5 8.5 0 1 0 20 13.5z" {...strokeProps} />
    </svg>
  );
}

export function IconClose({ className, size = 20 }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

export function IconSend({ className, size = 18 }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m22 2-7 20-4-9-9-4 20-7z" />
      <path d="M22 2 11 13" />
    </svg>
  );
}
