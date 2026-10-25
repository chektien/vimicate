export type TranscriptIndexedLayout = {
  y: number;
  height: number;
};

/**
 * FlashList can move its native ScrollView before React receives `onScroll`,
 * but its JS-facing absolute-offset getter can also remain on the preceding
 * layout generation after that event arrives. Before an event is observed,
 * prefer the native getter. Afterward, the event mirror is the acknowledged
 * offset and must beat a stale-but-finite recycler value.
 */
export function authoritativeTranscriptScrollOffset(nativeOffset: number, observedOffset: number, observedCurrent = false) {
  if (observedCurrent && Number.isFinite(observedOffset)) return observedOffset;
  return Number.isFinite(nativeOffset) ? nativeOffset : observedOffset;
}

/** Prefer the mounted recycler's window over a not-yet-published React layout. */
export function authoritativeTranscriptViewportHeight(nativeHeight: number, observedHeight: number) {
  return Number.isFinite(nativeHeight) && nativeHeight > 0 ? nativeHeight : observedHeight;
}

/**
 * A project-switch capture is a synchronous query of the mounted recycler,
 * not an acknowledgement of a prior scroll event. Prefer FlashList's current
 * native offset so a delayed React onScroll mirror cannot move a visibly
 * correct selected row back to an older screen position.
 */
export function capturedTranscriptScrollOffset(nativeOffset: number, observedOffset: number) {
  return authoritativeTranscriptScrollOffset(nativeOffset, observedOffset, false);
}

export function transcriptIndexedRevealAcknowledged(expectedOffset: number, observedOffset: number, tolerance = 1) {
  return Number.isFinite(expectedOffset)
    && Number.isFinite(observedOffset)
    && Math.abs(expectedOffset - observedOffset) <= tolerance;
}

export function capturedTranscriptViewPosition(
  unsettledReveal: Readonly<{ target: number; viewPosition: number }> | null,
  target: number,
  measuredPosition: number | null,
) {
  // scrollToOffset reaches the native ScrollView before its onScroll event
  // necessarily updates either JS offset mirror. During that narrow window a
  // measured position is from the preceding layout generation. The issued
  // reveal stores its already-clamped resulting position and owns capture
  // until the matching scroll offset is observed.
  if (unsettledReveal?.target === target && Number.isFinite(unsettledReveal.viewPosition)) {
    return unsettledReveal.viewPosition;
  }
  return measuredPosition !== null && Number.isFinite(measuredPosition) ? measuredPosition : null;
}

/**
 * FlashList 2's scrollToIndex intentionally performs several corrective
 * native scrolls and keeps offset projection paused for roughly 200 ms, even
 * when `animated` is false. That is useful for an isolated long jump, but a
 * held j/k stream can otherwise start many overlapping correction sequences.
 *
 * The recycler already owns a layout for every admitted index. Derive the
 * same final offset directly so each navigation frame has one synchronous,
 * latest-value write and no older promise can finish after a newer cursor.
 */
export function transcriptIndexedRevealOffset(
  layout: TranscriptIndexedLayout,
  viewportHeight: number,
  contentHeight: number,
  firstItemOffset: number,
  viewPosition: number,
) {
  const position = Math.max(0, Math.min(1, viewPosition));
  const proposed = layout.y - (viewportHeight - layout.height) * position + firstItemOffset;
  const maximum = Math.max(0, contentHeight - viewportHeight);
  return Math.max(0, Math.min(maximum, proposed));
}

/** Capture an admitted row's current vertical position for session restoration. */
export function transcriptIndexedViewPosition(
  layout: TranscriptIndexedLayout,
  viewportHeight: number,
  offset: number,
  firstItemOffset: number,
) {
  const available = viewportHeight - layout.height;
  if (available <= 0) return 0.5;
  return Math.max(0, Math.min(1, (layout.y + firstItemOffset - offset) / available));
}

/** Capture the block cursor's physical center rather than a row-top fraction. */
export function transcriptIndexedCursorCenterY(
  layout: TranscriptIndexedLayout,
  offset: number,
  firstItemOffset: number,
) {
  return layout.y + firstItemOffset - offset + layout.height / 2;
}

/** Convert a captured cursor center to the target row's height-aware position. */
export function transcriptIndexedViewPositionForCursorCenter(
  layout: TranscriptIndexedLayout,
  viewportHeight: number,
  cursorCenterY: number,
) {
  const available = viewportHeight - layout.height;
  if (available <= 0) return 0.5;
  return Math.max(0, Math.min(1, (cursorCenterY - layout.height / 2) / available));
}

/** Capture the screen position that a queued, content-bounded reveal will produce. */
export function transcriptBoundedIndexedViewPosition(
  layout: TranscriptIndexedLayout,
  viewportHeight: number,
  contentHeight: number,
  firstItemOffset: number,
  viewPosition: number,
) {
  // An explicit leading-edge restore must reveal the source text above an
  // oversized question card. Ordinary oversized-row navigation still centers.
  if (viewPosition === 0 && layout.height >= viewportHeight) return 0;
  const offset = transcriptIndexedRevealOffset(layout, viewportHeight, contentHeight, firstItemOffset, viewPosition);
  return transcriptIndexedViewPosition(layout, viewportHeight, offset, firstItemOffset);
}
