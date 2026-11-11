import { remapViewportRowRequest } from './transcriptViewportRowIdentity';
import type { SessionTranscriptViewportPosition } from './sessionTranscriptViewportPosition';
import { nextTranscriptReviewRestoreDecision } from './transcriptReviewRestore';
import { transcriptIndexedRevealAcknowledged } from './transcriptIndexedReveal';

export type TranscriptReviewRestoreRequest = {
  rowKey?: string | undefined;
  datasetKey: string;
  target: number;
  viewPosition: number;
  rowOffset?: number;
  writes: number;
  confirmations: number;
  settleUntil: number;
  fallbackUsed: boolean;
  session?: { anchor: SessionTranscriptViewportPosition; endAligned: boolean; geometryAt: number; authority: { deadline: number } };
  painted?: boolean;
  movedWithoutDrag?: boolean;
};

type MutableRef<T> = { current: T };
export type SessionRestoreIntent = { anchor: SessionTranscriptViewportPosition; endAligned: boolean };
type ReviewWriterAction = 'confirm-review' | 'correct-review' | 'exhaust-review' | 'fallback-review' | 'release-review' | 'review-complete';

export type TranscriptReviewRestoreVerification = {
  pending: MutableRef<TranscriptReviewRestoreRequest | null>;
  frame: MutableRef<number | null>;
  requestFrame: (callback: () => void) => number | null;
  ownsDataset: (datasetKey: string) => boolean;
  actualPosition: (target: number) => number | null;
  issueIndexedReveal: (target: number, viewPosition: number, nativeCorrection?: boolean, rowOffset?: number) => void;
  scheduleBlankRecovery: () => void;
  record: (action: ReviewWriterAction, request: TranscriptReviewRestoreRequest, actualPosition: number | null, force?: boolean) => void;
  historyLoading?: () => boolean;
  leaseEnded?: (reason: 'quiet' | 'deadline' | 'budget', request: TranscriptReviewRestoreRequest) => void;
  now?: () => number;
};

export const TRANSCRIPT_REVIEW_RESTORE_SETTLE_MS = 250;
export const SESSION_RESTORE_QUIET_MS = 3_000;
export const SESSION_RESTORE_MAX_MS = 10_000;
export const SESSION_RESTORE_MAX_WRITES = 8;
const REVIEW_FALLBACK_SETTLE_MS = 1_500;

/** Native mount/measurement events are not reader input before delivery settles. */
export function reviewRestoreAfterScroll(request: TranscriptReviewRestoreRequest | null, expectedOffset: number | undefined,
  offset: number, geometryChanged: boolean, now: number, writerOwned = false, previousOffset?: number) {
  if (!request) return null;
  const current = reviewRestoreAfterGeometry(request, geometryChanged, now)!;
  return { ...current, movedWithoutDrag: !!current.painted && now >= current.settleUntil && !geometryChanged
    && (!current.session || !writerOwned && previousOffset !== undefined && Math.abs(previousOffset - offset) > 0.5)
    && expectedOffset !== undefined && !transcriptIndexedRevealAcknowledged(expectedOffset, offset) };
}

export function reviewRestoreAfterGeometry(request: TranscriptReviewRestoreRequest | null, changed: boolean, now: number) {
  return request && changed && request.rowOffset !== undefined
    ? { ...request, confirmations: 0, painted: false, movedWithoutDrag: false, settleUntil: now + TRANSCRIPT_REVIEW_RESTORE_SETTLE_MS,
      ...(request.session ? { session: { ...request.session, geometryAt: now } } : {}) }
    : request;
}

export function reviewRestoreAfterViewability(request: TranscriptReviewRestoreRequest | null, indices: readonly number[], endTarget?: number) {
  if (!request) return null;
  const painted = request.session?.endAligned ? endTarget !== undefined && indices.includes(endTarget) : indices.includes(request.target);
  return { ...request, painted, ...(painted ? {} : { confirmations: 0 }) };
}

/**
 * Imperative verification policy for the hook's existing review refs. This
 * function does not own another timer or state copy: every frame and request
 * remains in the caller's single viewport lifetime.
 */
export function scheduleTranscriptReviewRestoreVerification(context: TranscriptReviewRestoreVerification) {
  const pending = context.pending.current;
  if (!pending || pending.writes < 1 && !pending.session || context.frame.current !== null) return;
  const verify = () => {
    context.frame.current = null;
    const request = context.pending.current;
    if (!request || !context.ownsDataset(request.datasetKey)) return;
    const now = context.now ? context.now() : performance.now();
    const actualPosition = context.actualPosition(request.target);
    const lease = request.session;
    // Every terminal exit relinquishes the request here. A completed restore
    // leaves placement to the reader, and any failed one hands the viewport to
    // the bounded blank owner because no later native callback is guaranteed.
    const finish = (outcome: 'quiet' | 'deadline' | 'budget') => {
      context.pending.current = null;
      if (lease) context.leaseEnded?.(outcome, request);
      if (outcome !== 'quiet') context.scheduleBlankRecovery();
    };
    if (lease) {
      if (now >= lease.authority.deadline) { context.record('release-review', request, actualPosition); finish('deadline'); return; }
      const matched = actualPosition !== null && Math.abs(actualPosition) <= 0.5;
      if (matched) {
        const confirmations = request.confirmations + 1;
        if (confirmations >= 2 && now >= lease.geometryAt + SESSION_RESTORE_QUIET_MS && !context.historyLoading?.()) {
          context.record('review-complete', request, actualPosition); finish('quiet'); return;
        }
        context.pending.current = { ...request, confirmations };
      } else if (now >= request.settleUntil) {
        if (request.writes >= SESSION_RESTORE_MAX_WRITES) { context.record('exhaust-review', request, actualPosition); finish('budget'); return; }
        context.pending.current = { ...request, writes: request.writes + 1, confirmations: 0,
          settleUntil: now + TRANSCRIPT_REVIEW_RESTORE_SETTLE_MS };
        context.issueIndexedReveal(request.target, 0, !request.painted && !request.fallbackUsed, request.rowOffset);
        context.pending.current = { ...context.pending.current!, fallbackUsed: request.fallbackUsed || !request.painted };
        context.record('correct-review', request, actualPosition);
      }
      context.frame.current = context.requestFrame(verify);
      return;
    }
    const decision = nextTranscriptReviewRestoreDecision(request, actualPosition, request.viewPosition, request.rowOffset === undefined ? undefined : 0.5, undefined, now);
    const beginNativeFallback = () => {
      context.pending.current = { ...request, fallbackUsed: true, settleUntil: now + REVIEW_FALLBACK_SETTLE_MS };
      context.record('fallback-review', request, actualPosition);
      if (request.rowOffset === undefined) context.issueIndexedReveal(request.target, request.viewPosition, true);
      else context.issueIndexedReveal(request.target, request.viewPosition, true, request.rowOffset);
      context.frame.current = context.requestFrame(verify);
    };
    if (decision.action === 'wait') {
      if (now < request.settleUntil) context.frame.current = context.requestFrame(verify);
      else if (!request.fallbackUsed) beginNativeFallback();
      else { context.record('release-review', request, actualPosition); finish('deadline'); }
      return;
    }
    if (decision.action === 'complete') { context.record('review-complete', request, actualPosition); finish('quiet'); return; }
    if (decision.action === 'exhaust') {
      if (!request.fallbackUsed) { beginNativeFallback(); return; }
      context.record('exhaust-review', request, actualPosition); finish('budget'); return;
    }
    context.pending.current = { ...request, ...decision.state };
    if (decision.action === 'confirm') {
      context.record('confirm-review', request, actualPosition, false);
      context.frame.current = context.requestFrame(verify);
      return;
    }
    context.record('correct-review', request, actualPosition);
    context.pending.current = { ...request, ...decision.state, settleUntil: now + TRANSCRIPT_REVIEW_RESTORE_SETTLE_MS };
    if (request.rowOffset === undefined) context.issueIndexedReveal(request.target, request.viewPosition);
    else context.issueIndexedReveal(request.target, request.viewPosition, false, request.rowOffset);
    context.frame.current = context.requestFrame(verify);
  };
  context.frame.current = context.requestFrame(verify);
}

/** Retain resolvable semantic identity when presentation keys are canonicalized. */
export function remapSessionReviewRestore(request: TranscriptReviewRestoreRequest | null, datasetKey: string,
  keys: readonly string[] | undefined, resolve: ((anchor: SessionTranscriptViewportPosition) => number | null) | undefined,
  now: number) {
  let next = remapViewportRowRequest(request, datasetKey, keys);
  if (!next && request?.session && request.datasetKey === datasetKey) {
    const target = resolve?.(request.session.anchor);
    if (target !== null && target !== undefined && keys?.[target]) next = { ...request, target, rowKey: keys[target] };
  }
  return reviewRestoreAfterGeometry(next, true, now);
}

export type RevisionRevealRequest = Pick<TranscriptReviewRestoreRequest, 'datasetKey' | 'target' | 'rowKey' | 'viewPosition' | 'rowOffset'>;
type RevisionContext = {
  pending: MutableRef<RevisionRevealRequest | null>;
  review: MutableRef<TranscriptReviewRestoreRequest | null>;
  frame: MutableRef<number | null>;
  requestFrame: (callback: () => void) => number | null;
  cancelFrame: (frame: number) => void;
  ownsDataset: (datasetKey: string) => boolean;
  issue: (request: RevisionRevealRequest) => void;
  verify: () => void;
  record: (action: 'queue-revision-reveal' | 'run-revision-reveal', request: RevisionRevealRequest) => void;
};

/** Admission shares the same request and frame slots as later verification. */
export function scheduleTranscriptRevisionReveal(context: RevisionContext, restart: boolean) {
  if (!context.pending.current) return;
  if (restart && !context.review.current?.session && context.frame.current !== null) {
    context.cancelFrame(context.frame.current); context.frame.current = null;
  }
  if (context.frame.current !== null) return;
  context.record('queue-revision-reveal', context.pending.current);
  context.frame.current = context.requestFrame(() => {
    context.frame.current = context.requestFrame(() => {
      context.frame.current = null;
      const request = context.pending.current; context.pending.current = null;
      if (!request || !context.ownsDataset(request.datasetKey)) return;
      const restore = context.review.current;
      if (restore?.session && performance.now() >= restore.session.authority.deadline) { context.verify(); return; }
      if (restore && restore.datasetKey === request.datasetKey && restore.target === request.target) {
        context.review.current = { ...restore, writes: restore.writes + 1, confirmations: 0,
          settleUntil: performance.now() + TRANSCRIPT_REVIEW_RESTORE_SETTLE_MS };
      }
      context.record('run-revision-reveal', request); context.issue(request); context.verify();
    });
  });
}

export function createTranscriptReviewRestore(request: RevisionRevealRequest, session: SessionRestoreIntent | undefined,
  visible: { first: number; last: number } | null, itemCount: number, now = performance.now()): TranscriptReviewRestoreRequest {
  const painted = session?.endAligned ? visible?.last === itemCount - 1 : !!visible && request.target >= visible.first && request.target <= visible.last;
  return { ...request, writes: 0, confirmations: 0, settleUntil: Number.POSITIVE_INFINITY, fallbackUsed: false, painted,
    ...(session ? { session: { ...session, geometryAt: now, authority: { deadline: now + SESSION_RESTORE_MAX_MS } } } : {}) };
}

export function transcriptReviewRevisionRequest(datasetKey: string, rowKey: string | undefined,
  target: number, position: number, rowOffset: number | undefined): RevisionRevealRequest {
  const pixel = rowOffset !== undefined && Number.isFinite(rowOffset) ? { rowOffset } : {};
  return { datasetKey, rowKey, target, viewPosition: pixel.rowOffset !== undefined ? 0 : Math.max(0, Math.min(1, position)), ...pixel };
}
