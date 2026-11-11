import type { TranscriptIndexedLayout } from './transcriptIndexedReveal';

type LayoutOwner = { getLayout: (index: number) => TranscriptIndexedLayout | undefined; getFirstItemOffset: () => number };

/** Pick the painted leading row, not a potentially stale viewability range. */
export function captureTranscriptSessionPixelAnchor(owner: LayoutOwner | null, itemCount: number, offset: number) {
  if (!owner || itemCount <= 0 || !Number.isFinite(offset)) return null;
  try {
    const firstItemOffset = owner.getFirstItemOffset();
    let low = 0; let high = itemCount - 1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2); const layout = owner.getLayout(middle);
      if (!layout || !Number.isFinite(layout.y + layout.height)) return null;
      if (layout.y + layout.height + firstItemOffset <= offset) low = middle + 1;
      else high = middle;
    }
    const layout = owner.getLayout(low);
    return layout && Number.isFinite(layout.y + firstItemOffset) && layout.height > 0
      ? { row: low, rowOffset: offset - layout.y - firstItemOffset } : null;
  } catch { return null; }
}

export function boundedSessionRowOffset(layout: TranscriptIndexedLayout | undefined, rowOffset: number) {
  return layout ? Math.min(rowOffset, Math.max(0, layout.height - 1)) : rowOffset;
}

/** Restore the same source point, bounded by the current cell and document. */
export function transcriptSessionPixelRestoreOffset(layout: TranscriptIndexedLayout, rowOffset: number,
  viewportHeight: number, contentHeight: number, firstItemOffset: number) {
  const local = boundedSessionRowOffset(layout, rowOffset);
  return Math.max(0, Math.min(Math.max(0, contentHeight - viewportHeight), layout.y + firstItemOffset + local));
}
