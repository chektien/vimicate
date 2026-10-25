import { useCallback, type RefObject } from 'react';
import type { FlashListRef } from '@shopify/flash-list';
import type { TranscriptViewportGeometry } from './transcriptViewportGeometry';
import { mountedTranscriptNativeScrollOffset } from './transcriptViewportPositionCapture';
import { authoritativeTranscriptScrollOffset } from './transcriptIndexedReveal';
import { boundedTranscriptRow } from './transcriptViewportPolicy';

type Region = { y: number; height: number };
type NavigationCancel = (reason: 'navigation') => unknown;

/** Sub-cell controls use the viewport's existing indexed writer, never a second scroller. */
export function useTranscriptRegionReveal<T>({
  list, metrics, observedScroll, current, pendingDatasetReset, pendingIndexedReveal,
  olderHistoryAnchor, cancelRevisionReveal, cancelPostLayoutFrame, cancelTailWriter,
  cancelIndexedWriter, setTailFollow, issueIndexedReveal,
}: {
  list: RefObject<FlashListRef<T> | null>;
  metrics: RefObject<TranscriptViewportGeometry>;
  observedScroll: RefObject<boolean>;
  current: RefObject<{ itemCount: number }>;
  pendingDatasetReset: RefObject<boolean>;
  pendingIndexedReveal: RefObject<{ region?: Region } | null>;
  olderHistoryAnchor: { cancel: () => void };
  cancelRevisionReveal: NavigationCancel;
  cancelPostLayoutFrame: NavigationCancel;
  cancelTailWriter: NavigationCancel;
  cancelIndexedWriter: NavigationCancel;
  setTailFollow: (follow: boolean, reason: 'navigation') => void;
  issueIndexedReveal: (target: number, position: number, correction: boolean, region: Region) => void;
}) {
  const captureRegionPosition = useCallback((target: number) => {
    const owner = list.current;
    const layout = owner?.getLayout(target);
    if (!owner || !layout) return null;
    const offset = mountedTranscriptNativeScrollOffset(owner)
      ?? authoritativeTranscriptScrollOffset(owner.getAbsoluteLastScrollOffset(), metrics.current.offset, observedScroll.current);
    return { y: offset - layout.y - owner.getFirstItemOffset(), height: owner.getWindowSize().height || metrics.current.viewportHeight };
  }, [list, metrics, observedScroll]);
  const revealRegion = useCallback((target: number, region: Region) => {
    if (!Number.isFinite(region.y) || !Number.isFinite(region.height) || region.height <= 0
      || boundedTranscriptRow(target, current.current.itemCount) !== target) return;
    olderHistoryAnchor.cancel();
    cancelRevisionReveal('navigation');
    cancelPostLayoutFrame('navigation');
    cancelTailWriter('navigation');
    setTailFollow(false, 'navigation');
    pendingDatasetReset.current = false;
    const owner = list.current;
    const height = owner?.getWindowSize().height || metrics.current.viewportHeight;
    const layout = owner?.getLayout(target);
    if (owner && layout && height > 0) {
      const offset = mountedTranscriptNativeScrollOffset(owner)
        ?? authoritativeTranscriptScrollOffset(owner.getAbsoluteLastScrollOffset(), metrics.current.offset, observedScroll.current);
      const top = layout.y + owner.getFirstItemOffset() + region.y;
      if (top >= offset && top + region.height <= offset + height) {
        // A newer control reveal supersedes queued row/region navigation too.
        // Do not move a control that is already readable.
        cancelIndexedWriter('navigation');
        return;
      }
    }
    issueIndexedReveal(target, region.height >= height ? 0 : 0.5, false, region);
  }, [current, olderHistoryAnchor, cancelRevisionReveal, cancelPostLayoutFrame, cancelTailWriter,
    setTailFollow, pendingDatasetReset, list, metrics, observedScroll, pendingIndexedReveal, cancelIndexedWriter, issueIndexedReveal]);
  const cancelRegionReveal = useCallback(() => {
    if (pendingIndexedReveal.current?.region) cancelIndexedWriter('navigation');
  }, [pendingIndexedReveal, cancelIndexedWriter]);
  return { captureRegionPosition, revealRegion, cancelRegionReveal };
}
