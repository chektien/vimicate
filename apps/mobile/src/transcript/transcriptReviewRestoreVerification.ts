import { nextTranscriptReviewRestoreDecision } from './transcriptReviewRestore';

export type TranscriptReviewRestoreRequest = {
  rowKey?: string | undefined;
  datasetKey: string;
  target: number;
  viewPosition: number;
  writes: number;
  confirmations: number;
  settleUntil: number;
  fallbackUsed: boolean;
};

type MutableRef<T> = { current: T };
type ReviewWriterAction = 'confirm-review' | 'correct-review' | 'exhaust-review' | 'fallback-review' | 'release-review' | 'review-complete';

export type TranscriptReviewRestoreVerification = {
  pending: MutableRef<TranscriptReviewRestoreRequest | null>;
  frame: MutableRef<number | null>;
  requestFrame: (callback: () => void) => number | null;
  ownsDataset: (datasetKey: string) => boolean;
  actualPosition: (target: number) => number | null;
  issueIndexedReveal: (target: number, viewPosition: number, nativeCorrection?: boolean) => void;
  scheduleBlankRecovery: () => void;
  record: (action: ReviewWriterAction, request: TranscriptReviewRestoreRequest, actualPosition: number | null, force?: boolean) => void;
  now?: () => number;
};

export const TRANSCRIPT_REVIEW_RESTORE_SETTLE_MS = 250;
const REVIEW_FALLBACK_SETTLE_MS = 1_500;

/**
 * Imperative verification policy for the hook's existing review refs. This
 * function does not own another timer or state copy: every frame and request
 * remains in the caller's single viewport lifetime.
 */
export function scheduleTranscriptReviewRestoreVerification(context: TranscriptReviewRestoreVerification) {
  const pending = context.pending.current;
  if (!pending || pending.writes < 1 || context.frame.current !== null) return;
  const verify = () => {
    context.frame.current = null;
    const request = context.pending.current;
    if (!request || !context.ownsDataset(request.datasetKey)) return;
    const now = context.now ? context.now() : performance.now();
    const actualPosition = context.actualPosition(request.target);
    const decision = nextTranscriptReviewRestoreDecision(request, actualPosition, request.viewPosition, undefined, undefined, now);
    const beginNativeFallback = () => {
      context.pending.current = { ...request, fallbackUsed: true, settleUntil: now + REVIEW_FALLBACK_SETTLE_MS };
      context.record('fallback-review', request, actualPosition);
      context.issueIndexedReveal(request.target, request.viewPosition, true);
      context.frame.current = context.requestFrame(verify);
    };
    if (decision.action === 'wait') {
      if (now < request.settleUntil) context.frame.current = context.requestFrame(verify);
      else if (!request.fallbackUsed) beginNativeFallback();
      else {
        context.pending.current = null;
        context.record('release-review', request, actualPosition);
        context.scheduleBlankRecovery();
      }
      return;
    }
    if (decision.action === 'complete') {
      context.pending.current = null;
      context.record('review-complete', request, actualPosition);
      return;
    }
    if (decision.action === 'exhaust') {
      if (!request.fallbackUsed) { beginNativeFallback(); return; }
      context.pending.current = null;
      context.record('exhaust-review', request, actualPosition);
      context.scheduleBlankRecovery();
      return;
    }
    context.pending.current = { ...request, ...decision.state };
    if (decision.action === 'confirm') {
      context.record('confirm-review', request, actualPosition, false);
      context.frame.current = context.requestFrame(verify);
      return;
    }
    context.record('correct-review', request, actualPosition);
    context.pending.current = { ...request, ...decision.state, settleUntil: now + TRANSCRIPT_REVIEW_RESTORE_SETTLE_MS };
    context.issueIndexedReveal(request.target, request.viewPosition);
    context.frame.current = context.requestFrame(verify);
  };
  context.frame.current = context.requestFrame(verify);
}
