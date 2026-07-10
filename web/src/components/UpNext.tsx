import type { Track } from '../lib/types';

// Read-only view of the station's upcoming programme (P3 cutover): the
// timeline is server-authoritative, so there is nothing to drag, remove or
// clear here — you influence the future through the hotline (chat) and the
// steer chips, like a real station.
export default function UpNext({ items }: { items: Track[] }) {
  if (!items.length) return null;
  return (
    <div className="upnext mt-3 pt-3 border-t" style={{ borderColor: 'var(--glass-border)' }}>
      <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-[var(--text-muted)] mb-1.5">
        待播 · {items.length}
      </p>
      <div className="upnext-list scroll-panel space-y-1">
        {items.map((track, i) => (
          <div
            key={`${track.source}-${track.id}-${i}`}
            className="upnext-row flex items-baseline gap-2 px-1.5 py-1 rounded-md select-none"
            style={{ background: 'rgba(127,127,127,0.08)' }}
          >
            <span className="truncate text-[13px] text-[var(--text-secondary)] flex-1">{track.title}</span>
            <span className="truncate text-[11px] text-[var(--text-muted)] max-w-[40%] shrink-0">{track.artist}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
