import { captureTranscriptSessionPixelAnchor, transcriptSessionPixelRestoreOffset } from './transcriptSessionPixelAnchor';
import { transcriptReviewTargetVisible } from './transcriptReviewRestore';
import { transcriptTargetOutsidePaintedViewport } from './transcriptViewportPolicy';
import type { FlashListRef } from '@shopify/flash-list';
import { authoritativeTranscriptScrollOffset, authoritativeTranscriptViewportHeight, capturedTranscriptScrollOffset, capturedTranscriptViewPosition, transcriptIndexedRevealOffset, transcriptIndexedCursorCenterY, transcriptIndexedViewPosition, transcriptIndexedViewPositionForCursorCenter } from './transcriptIndexedReveal';
type Request = { datasetKey: string; target: number; viewPosition: number };

/** Native paint can move before FlashList publishes the corresponding index range. */
export function viewportTargetOutsidePaintedViewport<T>(owner: FlashListRef<T> | null, target: number,
  metrics: { offset: number; viewportHeight: number }, observedScroll: boolean) {
  if (!owner) return false;
  const offset = mountedTranscriptNativeScrollOffset(owner)
    ?? authoritativeTranscriptScrollOffset(owner.getAbsoluteLastScrollOffset(), metrics.offset, observedScroll);
  return transcriptTargetOutsidePaintedViewport(owner.getLayout(target), offset,
    owner.getWindowSize().height || metrics.viewportHeight, owner.getFirstItemOffset());
}

type PositionCapture<T> = {
  owner: FlashListRef<T> | null; target: number | null; targetRow: number | undefined; preferObservedScroll: boolean;
  metrics: { offset: number; viewportHeight: number; contentHeight: number }; observedScroll: boolean; datasetKey: string;
  unsettled: Request | null; pending: Request | null;
};

type MountedNativeScrollElement = Readonly<{
  isConnected?: boolean;
  scrollTop?: number;
}>;

type NativeScrollViewRef = Readonly<{
  getNativeScrollRef?: () => MountedNativeScrollElement | null;
}>;

/** Read the connected native ScrollView's painted offset when RN exposes it. */
export function mountedTranscriptNativeScrollOffset<T>(owner: Pick<FlashListRef<T>, 'getNativeScrollRef'> | null) {
  try {
    const scrollView = owner?.getNativeScrollRef() as unknown as NativeScrollViewRef | null | undefined;
    const host = scrollView?.getNativeScrollRef?.();
    const offset = host?.scrollTop;
    return host?.isConnected === true && typeof offset === 'number' && Number.isFinite(offset) && offset >= 0
      ? offset
      : null;
  } catch {
    return null;
  }
}

/** An issued native write owns the offset until its scroll sample is acknowledged. */
export function currentTranscriptScrollOffset<T>(owner: FlashListRef<T>, metrics: { offset: number },
  observedScroll: boolean, issuedOffset?: number) {
  return mountedTranscriptNativeScrollOffset(owner) ?? issuedOffset
    ?? authoritativeTranscriptScrollOffset(owner.getAbsoluteLastScrollOffset(), metrics.offset, observedScroll);
}

/** Sample the existing viewport owner; no independent state or writer. */
export function captureViewportRowPosition<T>({ owner, target, targetRow, preferObservedScroll, metrics, observedScroll, datasetKey, unsettled, pending }: PositionCapture<T>) {
    if (target === null) return null;
    const layout = owner?.getLayout(target);
    const viewportHeight = owner
      ? authoritativeTranscriptViewportHeight(owner.getWindowSize().height, metrics.viewportHeight)
      : metrics.viewportHeight;
    const mountedOffset = mountedTranscriptNativeScrollOffset(owner);
    const offset = owner && (mountedOffset ?? (preferObservedScroll
      ? authoritativeTranscriptScrollOffset(owner.getAbsoluteLastScrollOffset(), metrics.offset, observedScroll)
      : capturedTranscriptScrollOffset(owner.getAbsoluteLastScrollOffset(), metrics.offset)));
    const firstItemOffset = owner?.getFirstItemOffset() ?? 0;
    const targetLayout = targetRow === undefined ? null : owner?.getLayout(targetRow);
    const measuredPosition = owner && layout && viewportHeight && offset !== null
      ? targetLayout
        ? transcriptIndexedViewPositionForCursorCenter(targetLayout, viewportHeight, transcriptIndexedCursorCenterY(layout, offset, firstItemOffset))
        : transcriptIndexedViewPosition(layout, viewportHeight, offset, firstItemOffset)
      : null;
    // Only an unacknowledged write may outrank measured placement. Once its
    // scroll event arrives, a later native scroll or resize owns capture, even
    // if UIKit omitted begin-drag and the selected row is still visible.
    const issuedReveal = unsettled?.target === target && unsettled.datasetKey === datasetKey
      ? unsettled
      : null;
    const queuedReveal = !issuedReveal && owner && layout && viewportHeight && pending?.target === target
      ? (() => {
        const offset = transcriptIndexedRevealOffset(layout, viewportHeight,
          Math.max(metrics.contentHeight, owner.getChildContainerDimensions().height),
          owner.getFirstItemOffset(), pending!.viewPosition);
        return { target, viewPosition: transcriptIndexedViewPosition(layout, viewportHeight, offset, owner.getFirstItemOffset()) };
      })()
      : pending;
    return capturedTranscriptViewPosition(issuedReveal ?? queuedReveal, target, measuredPosition);
}

/** Measured confirmation for the existing review verifier; no new state/writer. */
export function measuredViewportRowPosition<T>(owner: FlashListRef<T> | null, target: number,
  visible: { first: number; last: number } | null, metrics: { offset: number; viewportHeight: number }, observedScroll: boolean, requestedPosition?: number) {
  const layout = transcriptReviewTargetVisible(target, visible) ? owner?.getLayout(target) : null;
  const viewportHeight = owner?.getWindowSize().height || metrics.viewportHeight;
  if (!owner || !layout || viewportHeight <= 0) return null;
  const offset = mountedTranscriptNativeScrollOffset(owner)
    ?? authoritativeTranscriptScrollOffset(owner.getAbsoluteLastScrollOffset(), metrics.offset, observedScroll);
  // Explicit source-top restores verify the leading edge, not an undefined
  // fraction of the negative spare height of an oversized card.
  if (requestedPosition === 0 && layout.height >= viewportHeight) return (layout.y + owner.getFirstItemOffset() - offset) / viewportHeight;
  return transcriptIndexedViewPosition(layout, viewportHeight, offset, owner.getFirstItemOffset());
}

/** Session-return verification compares the actual source-point displacement. */
export function measuredSessionPixelRestoreError<T>(owner: FlashListRef<T> | null, target: number, rowOffset: number,
  metrics: { offset: number; viewportHeight: number; contentHeight: number }, observedScroll: boolean, painted = true, endAligned = false) {
  const layout = owner?.getLayout(target);
  const height = owner?.getWindowSize().height || metrics.viewportHeight;
  if (!owner || !endAligned && !layout || height <= 0) return null;
  const actual = mountedTranscriptNativeScrollOffset(owner)
    ?? authoritativeTranscriptScrollOffset(owner.getAbsoluteLastScrollOffset(), metrics.offset, observedScroll);
  const expected = endAligned ? Math.max(0, Math.max(metrics.contentHeight, owner.getChildContainerDimensions().height) - height) : transcriptSessionPixelRestoreOffset(layout!, rowOffset, height,
    Math.max(metrics.contentHeight, owner.getChildContainerDimensions().height), owner.getFirstItemOffset());
  const error = actual - expected;
  // Estimates may guide a correction, but matching them without painted cells
  // cannot release the source-point intent to lossy whole-row blank recovery.
  return !painted && Math.abs(error) <= 0.5 ? null : error;
}

/** Offset, anchor and diagnostic provenance come from the same accepted read. */
export function captureSessionReviewPixelSample<T>(owner: FlashListRef<T> | null, itemCount: number,
  metrics: { offset: number }, observedScroll: boolean) {
  const nativeOffset = mountedTranscriptNativeScrollOffset(owner);
  const recyclerOffset = nativeOffset === null && owner ? owner.getAbsoluteLastScrollOffset() : NaN;
  const offset = nativeOffset ?? (owner ? authoritativeTranscriptScrollOffset(recyclerOffset, metrics.offset, observedScroll) : metrics.offset);
  const work = nativeOffset !== null ? 'native-offset'
    : observedScroll && Number.isFinite(metrics.offset) || !Number.isFinite(recyclerOffset) ? 'observed-offset' : 'recycler-offset';
  const anchor = captureTranscriptSessionPixelAnchor(owner, itemCount, offset);
  return anchor ? { anchor, offset, work } : null;
}

/** Keep existing anchor-only callers on the same capture policy. */
export function captureSessionReviewPixelAnchor<T>(owner: FlashListRef<T> | null, itemCount: number,
  metrics: { offset: number }, observedScroll: boolean) {
  return captureSessionReviewPixelSample(owner, itemCount, metrics, observedScroll)?.anchor ?? null;
}
