export type VisibleTranscriptRange = { first: number; last: number } | null;
export type TranscriptViewportPostLayoutWork = {
  datasetKey: string;
  recover: boolean;
};

export function transcriptVisibleRangeForRevision<T>(
  previousRevision: T,
  nextRevision: T,
  visible: VisibleTranscriptRange,
) {
  // Viewability indexes describe the preceding render. A prepend can keep
  // the same cells on screen while shifting every one of their indexes; until
  // FlashList publishes the new range, treating the old range as current can
  // suppress the explicit gg/k reveal for a newly admitted oldest row.
  return previousRevision === nextRevision ? visible : null;
}

// The recycler owns in-place key/geometry anchoring in the native layout
// commit. App-owned delayed reveals are for explicit navigation and session
// returns, not pagination: correcting several frames later visibly snaps.
// Tail following stays with the existing explicit app owner.
export const transcriptVisibleContentAnchor = Object.freeze({
  animateAutoScrollToBottom: false,
});

export function shouldScrollTranscriptTarget(target: number, visible: VisibleTranscriptRange, force = false) {
  if (force || !visible) return true;
  // A wrapped/tall source row can be the only mounted item intersecting the
  // viewport. It is already a valid reveal target; repeatedly recentering that
  // same item for held h/l starts competing scroll work without changing what
  // is visible.
  if (visible.first === visible.last && target === visible.first) return false;
  const inset = Math.min(3, Math.max(1, Math.floor((visible.last - visible.first) / 3)));
  const safeFirst = visible.first + inset;
  const safeLast = visible.last - inset;
  return target < safeFirst || target > safeLast;
}

export function transcriptTargetOutsidePaintedViewport(
  layout: { y: number; height: number } | null | undefined,
  offset: number,
  viewportHeight: number,
  firstItemOffset = 0,
) {
  if (!layout || !Number.isFinite(offset) || viewportHeight <= 0 || layout.height >= viewportHeight) return false;
  const top = layout.y + firstItemOffset;
  return top < offset - 1 || top + layout.height > offset + viewportHeight + 1;
}

export function transcriptViewportIsOffContent(offset: number, contentHeight: number, viewportHeight: number) {
  if (contentHeight <= 0 || viewportHeight <= 0) return false;
  // Past the end, or so far above the start that the whole viewport misses the
  // content. A top rubber-band stays within one viewport of the start; the
  // recycler has been seen reporting offsets near -1,000,000 after an entry
  // publication, which leaves the pane blank until an indexed reveal.
  return offset > Math.max(0, contentHeight - viewportHeight) + 32 || offset + viewportHeight < -32;
}

/** The row a newly keyed recycler paints first: the tail, or the restored cursor. */
export function transcriptEntryIndex(itemCount: number, followTail: boolean, cursorIndex: number) {
  if (itemCount <= 0) return undefined;
  return followTail ? itemCount - 1 : Math.min(Math.max(0, cursorIndex), itemCount - 1);
}

export function shouldRecoverTranscriptViewport(userScrollActive: boolean, offset: number, contentHeight: number, viewportHeight: number) {
  return !userScrollActive && transcriptViewportIsOffContent(offset, contentHeight, viewportHeight);
}

export function shouldRecoverTranscriptBlankViewport(
  userScrollActive: boolean,
  pendingDatasetReset: boolean,
  viewportWorkPending: boolean,
  itemCount: number,
  hasMountedVisibleCells: boolean,
  contentHeight: number,
  viewportHeight: number,
) {
  // A recycler can retain a numerically valid offset while mounting no cells.
  // That is distinct from off-content geometry and otherwise leaves a
  // populated transcript completely blank. Only a settled, laid-out,
  // nonempty dataset may self-heal; mount, touch/momentum and another viewport
  // writer remain authoritative until they finish.
  return !userScrollActive
    && !pendingDatasetReset
    && !viewportWorkPending
    && itemCount > 0
    && !hasMountedVisibleCells
    && contentHeight > 0
    && viewportHeight > 0;
}

export function shouldRestoreTranscriptTailRange(
  followTail: boolean,
  userScrollActive: boolean,
  itemCount: number,
  visible: VisibleTranscriptRange,
) {
  // A populated range is not proof that a tail-following recycler is healthy.
  // FlashList can retain a stale middle range after a canonical publication,
  // leaving the rest of the viewport blank while still reporting mounted
  // cells. The existing coalesced tail writer owns this correction.
  return followTail
    && !userScrollActive
    && itemCount > 0
    && visible !== null
    && visible.last < itemCount - 1;
}

export function boundedTranscriptRow(row: number, itemCount: number) {
  if (itemCount <= 0) return null;
  return Math.max(0, Math.min(itemCount - 1, row));
}

export function shouldScheduleTranscriptViewportFrame(pendingFrame: number | null) {
  // Continuous key/stream events may coalesce into the already queued writer,
  // but must never cancel and postpone that writer indefinitely.
  return pendingFrame === null;
}

export function transcriptTailScrollOffset(contentHeight: number, viewportHeight: number) {
  // A tail write is only authoritative once both native dimensions exist.
  // FlashList's scrollToEnd first calls scrollToIndex when the changing final
  // row is not mounted; that recycler-admission path can race live publication
  // and repeatedly modify its layout tree. The app already owns the measured
  // content geometry, so use the exact native offset instead.
  if (contentHeight <= 0 || viewportHeight <= 0) return null;
  const offset = contentHeight - viewportHeight;
  return offset > 0 ? offset : null;
}

export function transcriptTailWriterOwnsScrollSample(expectedOffset: number | null, actualOffset: number, tolerance: number) {
  // iOS may omit the programmatic writer's native callback entirely. Its
  // ownership cannot then consume an arbitrarily distant later reader scroll;
  // only a sample that plausibly acknowledges the requested offset belongs to
  // that writer. Ownership is still retired after the first sample either way.
  return expectedOffset !== null && Math.abs(expectedOffset - actualOffset) <= tolerance;
}

export function shouldRunTranscriptViewportWriter(writerDatasetKey: string, currentDatasetKey: string) {
  return writerDatasetKey === currentDatasetKey;
}

export function nextTranscriptViewportPostLayoutWork(
  current: TranscriptViewportPostLayoutWork | null,
  datasetKey: string,
  recover: boolean,
): TranscriptViewportPostLayoutWork {
  if (!current || current.datasetKey !== datasetKey) return { datasetKey, recover };
  return {
    datasetKey,
    recover: current.recover || recover,
  };
}

export function shouldRunTranscriptViewportPostLayoutWork(
  work: TranscriptViewportPostLayoutWork | null,
  currentDatasetKey: string,
): work is TranscriptViewportPostLayoutWork {
  return !!work && shouldRunTranscriptViewportWriter(work.datasetKey, currentDatasetKey);
}
