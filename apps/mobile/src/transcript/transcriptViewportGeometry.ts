type ScrollGeometry = {
  contentOffset: { y: number };
  contentSize: { height: number };
  layoutMeasurement: { height: number };
};

/** Geometry owned by one mounted transcript viewport, never a scroll writer. */
export class TranscriptViewportGeometry {
  offset = 0;
  contentHeight = 0;
  viewportHeight = 0;
  private layoutHeight: number | null = null;

  resetDataset() {
    this.offset = 0;
    this.contentHeight = 0;
    this.layoutHeight = null;
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
