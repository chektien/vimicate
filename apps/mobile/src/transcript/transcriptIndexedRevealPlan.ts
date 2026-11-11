import type { FlashListRef } from '@shopify/flash-list';
import { transcriptBoundedIndexedViewPosition, transcriptIndexedRevealOffset, transcriptIndexedViewPosition } from './transcriptIndexedReveal';
import { boundedSessionRowOffset, transcriptSessionPixelRestoreOffset } from './transcriptSessionPixelAnchor';

export type TranscriptIndexedRequest = Request & { datasetKey: string; rowKey?: string | undefined; sessionAuthority?: { deadline: number } | undefined };
type Request = { target: number; viewPosition: number; nativeCorrection: boolean; region?: { y: number; height: number }; rowOffset?: number; endAligned?: boolean };

/** A queued session write must still own the live lease at native execution. */
export function transcriptIndexedSessionOwnsWrite(request: TranscriptIndexedRequest, active: { deadline: number } | undefined, now = performance.now()) {
  return !request.sessionAuthority || request.sessionAuthority === active && now < request.sessionAuthority.deadline;
}

/** Stateless geometry for the existing frame-owned indexed writer. */
export function transcriptIndexedRevealPlan<T>(owner: FlashListRef<T>, request: Request,
  metrics: { viewportHeight: number; contentHeight: number }) {
  if (request.endAligned) {
    const height = owner.getWindowSize().height || metrics.viewportHeight;
    return { offset: Math.max(0, Math.max(metrics.contentHeight, owner.getChildContainerDimensions().height) - height), viewPosition: 1 };
  }
  const cell = request.nativeCorrection ? null : owner.getLayout(request.target);
  const layout = cell && request.region ? { y: cell.y + request.region.y, height: request.region.height } : cell;
  if (!layout) return { fallback: { index: request.target, animated: false, viewPosition: request.viewPosition,
    ...(request.rowOffset !== undefined ? { viewOffset: boundedSessionRowOffset(owner.getLayout(request.target), request.rowOffset) } : {}) } };
  const height = owner.getWindowSize().height || metrics.viewportHeight;
  const content = Math.max(metrics.contentHeight, owner.getChildContainerDimensions().height);
  const first = owner.getFirstItemOffset();
  const offset = request.rowOffset !== undefined ? transcriptSessionPixelRestoreOffset(layout, request.rowOffset, height, content, first)
    : transcriptIndexedRevealOffset(layout, height, content, first, request.viewPosition);
  return { offset, viewPosition: transcriptIndexedViewPosition(layout, height, offset, first) };
}

/** Resolve the requested placement before the single indexed frame is queued. */
export function transcriptIndexedRequestPosition<T>(owner: FlashListRef<T> | null, request: Request, hasRowKey: boolean,
  metrics: { viewportHeight: number; contentHeight: number }) {
  const cell = hasRowKey && !request.nativeCorrection ? owner?.getLayout(request.target) : null;
  const layout = cell && request.region ? { y: cell.y + request.region.y, height: request.region.height } : cell;
  const height = owner?.getWindowSize().height || metrics.viewportHeight;
  return request.rowOffset !== undefined ? 0 : owner && layout && !(request.region && layout.height >= height)
    ? transcriptBoundedIndexedViewPosition(layout, height, Math.max(metrics.contentHeight, owner.getChildContainerDimensions().height),
      owner.getFirstItemOffset(), request.viewPosition) : request.viewPosition;
}
