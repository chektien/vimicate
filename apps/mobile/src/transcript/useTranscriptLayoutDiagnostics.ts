import { useCallback, useLayoutEffect, useMemo, type RefObject } from 'react';
import type { FlashListRef } from '@shopify/flash-list';
import { recordViewportDiagnostic } from '../../modules/vimicate-diagnostics';
import { createTranscriptLayoutBurstDiagnostics } from './transcriptLayoutBurstDiagnostics';
import { createTranscriptViewportDiagnostics } from './transcriptViewportDiagnostics';

export function useTranscriptLayoutDiagnostics<T>(
  datasetKey: string, topology: object, presentation: object, list: RefObject<FlashListRef<T> | null>,
) {
  const observer = useMemo(() => {
    const diagnostics = createTranscriptViewportDiagnostics(datasetKey, recordViewportDiagnostic);
    return createTranscriptLayoutBurstDiagnostics((fields) => diagnostics.record('layout-burst', fields, true));
  }, [datasetKey]);
  useLayoutEffect(() => observer.activate(), [observer]);
  // Count only committed parent publications. A suspended render cannot
  // contaminate the counters or reactivate a retired dataset's callback.
  useLayoutEffect(() => { observer.sourceCommit(topology, presentation); });
  return useCallback(() => observer.layoutCommit(() => {
    const native = list.current;
    if (!native) return {};
    const window = native.getWindowSize();
    const visible = native.computeVisibleIndices();
    return {
      viewportWidth: window.width, viewportHeight: window.height,
      contentHeight: native.getChildContainerDimensions().height,
      offset: native.getAbsoluteLastScrollOffset(), firstItemOffset: native.getFirstItemOffset(),
      first: visible.startIndex, last: visible.endIndex,
    };
  }), [list, observer]);
}
