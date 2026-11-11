import { useCallback, useEffect, useInsertionEffect, useRef } from 'react';
import { captureSessionReviewPixelSample } from './transcriptViewportPositionCapture';
import type { FlashListRef } from '@shopify/flash-list';
import type { SessionTranscriptViewportPosition } from './sessionTranscriptViewportPosition';
import type { TranscriptViewportDiagnosticFields } from './transcriptViewportDiagnostics';

export type PaintedSessionCapture = { kind: 'tail' } | {
  kind: 'anchor'; row: number; rowOffset: number; endGap: number; anchor?: Pick<SessionTranscriptViewportPosition, 'messageId' | 'lineInMessage'>;
};
export type TranscriptSessionViewportOptions = {
  onSessionRetire?: ((datasetKey: string, capture: PaintedSessionCapture | null) => void) | undefined;
  historyLoading?: boolean | undefined;
  entryIndex?: number | null | undefined;
  entryTail?: boolean | undefined;
  sessionAnchorForRow?: ((row: number) => Pick<SessionTranscriptViewportPosition, 'messageId' | 'lineInMessage'> | undefined) | undefined;
  resolveSessionAnchor?: ((anchor: SessionTranscriptViewportPosition) => number | null) | undefined;
};

/** One painted snapshot, not another cache or scroll owner. Publish before reset. */
export function useTranscriptSessionCapture<T>(datasetKey: string, options: TranscriptSessionViewportOptions | undefined,
  state: () => { owner: FlashListRef<T> | null; itemCount: number; tail: boolean; observed: boolean;
    metrics: { offset: number; contentHeight: number; viewportHeight: number } },
  record: (event: 'session-capture' | 'session-entry', fields: TranscriptViewportDiagnosticFields) => void) {
  const painted = useRef<{ capture: Extract<PaintedSessionCapture, { kind: 'anchor' }>; fields: TranscriptViewportDiagnosticFields } | null>(null);
  const committed = useRef({ datasetKey, options });
  useInsertionEffect(() => {
    const previous = committed.current;
    if (previous.datasetKey !== datasetKey) {
      const capture: PaintedSessionCapture | null = state().tail ? { kind: 'tail' } : painted.current?.capture ?? null;
      record('session-capture', { ...painted.current?.fields, tail: capture?.kind === 'tail' });
      previous.options?.onSessionRetire?.(previous.datasetKey, capture);
      painted.current = null;
    }
    committed.current = { datasetKey, options };
  });
  useEffect(() => { record('session-entry', { target: options?.entryIndex ?? 0, tail: options?.entryTail ?? true }); }, [datasetKey, options?.entryIndex, options?.entryTail]);
  const sample = useCallback((preferObserved = true) => {
    const { owner, itemCount, observed, metrics } = state();
    const accepted = captureSessionReviewPixelSample(owner, itemCount, metrics, preferObserved && observed);
    if (!accepted || metrics.viewportHeight <= 0) return;
    const { anchor, offset, work } = accepted;
    const endGap = Math.max(0, metrics.contentHeight - offset - metrics.viewportHeight);
    const identity = committed.current.options?.sessionAnchorForRow?.(anchor.row);
    painted.current = { capture: { kind: 'anchor', ...anchor, endGap, ...(identity ? { anchor: identity } : {}) },
      fields: { work, offset, contentHeight: metrics.contentHeight, viewportHeight: metrics.viewportHeight, target: anchor.row, rowOffset: anchor.rowOffset, endGap } };
  }, []);
  return { sample, committed };
}
