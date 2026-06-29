import { Reorder, useDragControls } from 'framer-motion';
import type { Track } from '../lib/types';

// One draggable row. Drag is bound to the handle only (dragListener={false}),
// so clicking the title jumps to it and the × removes it without false drags.
function Row({ track, absIndex, onPick, onRemove }: {
  track: Track;
  absIndex: number;
  onPick: (index: number) => void;
  onRemove: (index: number) => void;
}) {
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={track}
      dragListener={false}
      dragControls={controls}
      className="flex items-center gap-1.5 px-1 py-1 rounded-md select-none"
      style={{ background: 'rgba(127,127,127,0.08)' }}
      whileDrag={{ scale: 1.04, background: 'rgba(127,127,127,0.16)' }}
    >
      <button
        type="button"
        onPointerDown={(e) => controls.start(e)}
        className="touch-none cursor-grab text-[var(--text-muted)] px-0.5 leading-none"
        aria-label="拖动排序"
      >
        ⠿
      </button>
      <button
        type="button"
        onClick={() => onPick(absIndex)}
        className="flex-1 min-w-0 flex items-baseline gap-2 text-left"
      >
        <span className="truncate text-[13px] text-[var(--text-secondary)] flex-1">{track.title}</span>
        <span className="truncate text-[11px] text-[var(--text-muted)] max-w-[40%] shrink-0">{track.artist}</span>
      </button>
      <button
        type="button"
        onClick={() => onRemove(absIndex)}
        className="text-[var(--text-muted)] hover:text-[rgb(var(--accent-rgb))] px-1 leading-none text-[15px]"
        aria-label="删除"
      >
        ×
      </button>
    </Reorder.Item>
  );
}

export default function UpNext({ items, baseIndex, onPick, onRemove, onReorder, onClear }: {
  items: Track[];          // upcoming tracks (after the current one)
  baseIndex: number;       // absolute index of items[0] in the full queue
  onPick: (index: number) => void;
  onRemove: (index: number) => void;
  onReorder: (next: Track[]) => void;
  onClear: () => void;
}) {
  if (!items.length) return null;
  return (
    <div className="mt-4 pt-3 border-t" style={{ borderColor: 'var(--glass-border)' }}>
      <div className="flex items-center justify-between mb-1.5">
        <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-[var(--text-muted)]">待播 · {items.length}</p>
        <button
          type="button"
          onClick={onClear}
          className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--text-muted)] hover:text-[rgb(var(--accent-rgb))]"
        >
          清空
        </button>
      </div>
      <Reorder.Group
        axis="y"
        values={items}
        onReorder={onReorder}
        className="max-h-[170px] overflow-y-auto scroll-panel space-y-1"
      >
        {items.map((track, i) => (
          <Row
            key={track.uid ?? `${track.source}-${track.id}-${i}`}
            track={track}
            absIndex={baseIndex + i}
            onPick={onPick}
            onRemove={onRemove}
          />
        ))}
      </Reorder.Group>
    </div>
  );
}
