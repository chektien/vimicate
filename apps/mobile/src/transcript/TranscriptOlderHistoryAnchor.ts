import type { FlashListRef } from '@shopify/flash-list';
import { boundedSessionRowOffset, transcriptSessionPixelRestoreOffset } from './transcriptSessionPixelAnchor';

/** Request-scoped key/position receipt. The viewport hook owns its lifetime. */
export class TranscriptOlderHistoryAnchor<T> {
  private pullCandidate: { datasetKey: string; rowKey: string; rowOffset: number; expiresAt: number } | null = null;
  private pending: { datasetKey: string; rowKey: string; rowOffset: number;
    active: boolean; expiresAt: number; writes: number;
    lastWrite: { offset: number; actual: number } | undefined } | null = null;
  constructor(private readonly captureInput: () => { datasetKey: string; rowKeys: readonly string[] | undefined;
    anchor: () => { row: number; rowOffset: number } | null; holdReview: () => void },
    private readonly correctionInput: () => { datasetKey: string; gestureActive: boolean; rowKeys: readonly string[] | undefined;
      owner: FlashListRef<T> | null; viewportHeight: number; contentHeight: number;
      offset: (owner: FlashListRef<T>) => number; record: (target: number, offset: number) => void }) {}

  capture(datasetKey: string, rowKey: string, rowOffset: number) {
    this.pending = { datasetKey, rowKey, rowOffset, active: false, expiresAt: 0, writes: 0, lastWrite: undefined };
  }

  private measuredAnchor() {
    const input = this.captureInput();
    const anchor = input.anchor();
    const rowKey = anchor && input.rowKeys?.[anchor.row];
    return anchor && rowKey ? { datasetKey: input.datasetKey, rowKey, rowOffset: anchor.rowOffset } : null;
  }

  beginDrag() {
    this.pending = null;
    const anchor = this.measuredAnchor();
    this.pullCandidate = anchor ? { ...anchor, expiresAt: performance.now() + 5_000 } : null;
  }

  endDrag() { this.pullCandidate = null; }

  captureFromViewport = () => {
    const input = this.captureInput();
    const anchor = this.pullCandidate?.datasetKey === input.datasetKey
      && performance.now() <= this.pullCandidate.expiresAt
      ? this.pullCandidate : this.measuredAnchor();
    if (!anchor) return;
    input.holdReview();
    this.capture(anchor.datasetKey, anchor.rowKey, anchor.rowOffset);
  };

  revision(datasetKey: string, rowKeys?: readonly string[]) {
    const anchor = this.pending;
    if (anchor?.datasetKey !== datasetKey) return;
    this.pending = rowKeys?.includes(anchor.rowKey)
      ? { ...anchor, active: true, expiresAt: performance.now() + 1_200, writes: 0, lastWrite: undefined }
      : null;
  }

  retireUnchanged = () => {
    if (this.pending && !this.pending.active) this.pending = null;
  };

  cancel() { this.pending = null; this.pullCandidate = null; }

  ownsCorrection(datasetKey: string) {
    const anchor = this.pending;
    return !!anchor?.active && anchor.datasetKey === datasetKey && performance.now() <= anchor.expiresAt;
  }

  correct = () => {
    const input = this.correctionInput();
    const anchor = this.pending;
    if (!anchor?.active || input.gestureActive) return;
    if (anchor.datasetKey !== input.datasetKey || performance.now() > anchor.expiresAt) {
      this.pending = null; return;
    }
    const target = input.rowKeys?.indexOf(anchor.rowKey) ?? -1;
    const owner = input.owner;
    if (!owner || target < 0) { this.pending = null; return; }
    const layout = owner.getLayout(target);
    const actual = input.offset(owner);
    const height = owner.getWindowSize().height || input.viewportHeight;
    if (!layout || height <= 0 || !Number.isFinite(actual)) return;
    const desired = layout.y + owner.getFirstItemOffset() + boundedSessionRowOffset(layout, anchor.rowOffset);
    if (Math.abs(actual - desired) <= 2) return;
    if (anchor.writes >= 6) { this.pending = null; return; }
    const contentHeight = Math.max(input.contentHeight, owner.getChildContainerDimensions().height);
    const firstItemOffset = owner.getFirstItemOffset();
    // FlashList may publish the new row layouts before its native content
    // height. A clamped write during that interval cannot retain this key and
    // can feed a second native MVCP correction back into onScroll repeatedly.
    if (desired > Math.max(0, contentHeight - height) + 2) return;
    const offset = transcriptSessionPixelRestoreOffset(layout, anchor.rowOffset, height, contentHeight, firstItemOffset);
    if (anchor.lastWrite && Math.abs(anchor.lastWrite.offset - offset) <= 1
      && Math.abs(anchor.lastWrite.actual - actual) <= 2) return;
    anchor.writes += 1;
    anchor.lastWrite = { offset, actual };
    input.record(target, offset);
    owner.scrollToOffset({ offset, animated: false, skipFirstItemOffset: true });
  };
}
