import type { SessionTranscriptViewportPosition } from './sessionTranscriptViewportPosition';
type ScrollGeometry = {
  contentOffset: { y: number };
  contentSize: { height: number };
  layoutMeasurement: { height: number };
};

/** Geometry owned by one mounted transcript viewport, never a scroll writer. */
export class TranscriptViewportGeometry {
  reviewRecovery: { target: number; rowKey?: string | undefined; anchor: SessionTranscriptViewportPosition } | null = null;
  offset = 0;
  contentHeight = 0;
  viewportHeight = 0;
  private layoutHeight: number | null = null;

  resetDataset() {
    this.reviewRecovery = null;
    this.offset = 0;
    this.contentHeight = 0;
    this.layoutHeight = null;
  }

  holdReviewRecovery(request: { target: number; rowKey?: string | undefined }, anchor: SessionTranscriptViewportPosition | undefined) {
    this.reviewRecovery = anchor ? { ...request, anchor } : null;
  }
  recoveryRow(fallback: number) { return this.reviewRecovery?.target ?? fallback; }

  observeRecovery(owned: boolean, geometryChanged: boolean, previousOffset: number | undefined) {
    // Keep the source for missing native landings, not after a later reader move.
    if (!owned && !geometryChanged && previousOffset !== undefined && Math.abs(this.offset - previousOffset) > 0.5
      && this.offset >= 0 && this.offset <= Math.max(0, this.contentHeight - this.viewportHeight)) this.reviewRecovery = null;
  }

  remapReviewRecovery(keys: readonly string[] | undefined, resolve: ((anchor: SessionTranscriptViewportPosition) => number | null) | undefined) {
    const held = this.reviewRecovery; if (!held) return;
    const indexed = held.rowKey ? keys?.indexOf(held.rowKey) : undefined;
    const target = indexed !== undefined && indexed >= 0 ? indexed : resolve?.(held.anchor);
    this.reviewRecovery = target !== undefined && target !== null && target >= 0 ? { ...held, target, rowKey: keys?.[target] } : null;
  }

  resize(height: number) {
    if (!Number.isFinite(height) || height <= 0) return false;
    this.layoutHeight = height;
    this.viewportHeight = height;
    return true;
  }

  acceptScroll({ contentOffset, contentSize, layoutMeasurement }: ScrollGeometry) {
    // A queued pre-keyboard event must not replace a newer layout's window.
    // Before the first layout, scroll geometry can still bootstrap the owner.
    if (this.layoutHeight !== null && Math.abs(layoutMeasurement.height - this.layoutHeight) > 0.5) return false;
    this.offset = contentOffset.y;
    this.contentHeight = contentSize.height;
    this.viewportHeight = layoutMeasurement.height;
    return true;
  }
}
