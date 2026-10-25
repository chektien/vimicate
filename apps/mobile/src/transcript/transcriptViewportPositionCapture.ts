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
