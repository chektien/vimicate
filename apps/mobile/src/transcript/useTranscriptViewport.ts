import { useTranscriptSessionCapture, type TranscriptSessionViewportOptions } from './useTranscriptSessionCapture';
import { transcriptIndexedSessionOwnsWrite, transcriptIndexedRequestPosition, transcriptIndexedRevealPlan, type TranscriptIndexedRequest } from './transcriptIndexedRevealPlan';
import { useTranscriptRegionReveal } from './useTranscriptRegionReveal';
import { TranscriptViewportGeometry } from './transcriptViewportGeometry';
import { TranscriptScrollGesture } from './transcriptScrollGesture';
import { captureViewportRowPosition, measuredViewportRowPosition, measuredSessionPixelRestoreError, captureSessionReviewPixelAnchor, viewportTargetOutsidePaintedViewport } from './transcriptViewportPositionCapture';
import { remapViewportRowRequest, sameViewportRowKeys } from './transcriptViewportRowIdentity';
import { useCallback, useEffect, useInsertionEffect, useRef } from 'react';
import type { FlashListProps, FlashListRef } from '@shopify/flash-list';
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { launchGuardedBackgroundTask } from '../async/guardedBackgroundTask';
import { recordViewportDiagnostic } from '../../modules/vimicate-diagnostics';
import { boundedTranscriptRow, nextTranscriptViewportPostLayoutWork, shouldRecoverTranscriptViewport, shouldRestoreTranscriptTailRange, shouldRunTranscriptViewportPostLayoutWork, shouldRunTranscriptViewportWriter, shouldScheduleTranscriptViewportFrame, shouldScrollTranscriptTarget, transcriptTailScrollOffset, transcriptTailWriterOwnsScrollSample, transcriptViewportIsOffContent, transcriptVisibleRangeForRevision, type TranscriptViewportPostLayoutWork, type VisibleTranscriptRange } from './transcriptViewportPolicy';
import { shouldCancelTranscriptTailWriter, shouldScrollTranscriptTailReveal, transcriptScrollMovedIntoReview, transcriptTailFollowAfterScroll, transcriptTailFollowForReveal, transcriptTailFollowOnDragBegin, type TranscriptRevealOwnership } from './transcriptTailFollowPolicy';
import { createTranscriptViewportDiagnostics, transcriptViewportDiagnosticFields } from './transcriptViewportDiagnostics';
import { transcriptIndexedRevealAcknowledged } from './transcriptIndexedReveal';
import { transcriptReviewRevisionRequest, createTranscriptReviewRestore, scheduleTranscriptRevisionReveal, remapSessionReviewRestore, reviewRestoreAfterGeometry, reviewRestoreAfterScroll, reviewRestoreAfterViewability, scheduleTranscriptReviewRestoreVerification, type TranscriptReviewRestoreRequest, type SessionRestoreIntent, type RevisionRevealRequest } from './transcriptReviewRestoreVerification';
import { TranscriptBlankRecoveryScheduler } from './transcriptBlankRecoveryScheduler';
import { useViewportFrameScheduler } from './useViewportFrameScheduler';
import { useTranscriptNativeCallbacks } from './useTranscriptNativeCallbacks';
import { captureTranscriptReviewAnchor } from './transcriptReviewAnchorCapture';
import { TranscriptOlderHistoryAnchor } from './TranscriptOlderHistoryAnchor';
import { nextTranscriptMountedCellProof } from './transcriptMountedCellProof';

const BOTTOM_TOLERANCE = 32;

export function useTranscriptViewport<T>(datasetKey: string, revision: object, itemCount: number, recoveryRow: number, sourceCursorRow: number, onReviewIntent?: (sessionKey: string) => void, rowKeys?: readonly string[], onUserReachedEnd?: () => void, sessionOptions?: TranscriptSessionViewportOptions) {
  const frames = useViewportFrameScheduler(() => {
    // Only following intent reasserts latest on resume; review never expires.
    gesture.retire(); userEndReceipt.current = null;
    lastScrollSample.current = null;
    if (followTail.current) scrollToEnd();
  });
  const list = useRef<FlashListRef<T>>(null);
  // Tail following is user intent, not a geometry sample. During streaming,
  // content grows before the list can settle at its new end; treating that
  // transient distance as review intent made the pane freeze and jump.
  const followTail = useRef(true);
  const gesture = useRef(new TranscriptScrollGesture()).current;
  const datasetKeyRef = useRef(datasetKey);
  const revisionRef = useRef(revision);
  const reviewIntent = useRef(onReviewIntent);
  const userReachedEnd = useRef(onUserReachedEnd);
  const userEndReceipt = useRef<{ revision: object; callback: (() => void) | undefined; contentHeight: number; viewportHeight: number } | null>(null);
  const pendingDatasetReset = useRef(true);
  const unsettledTailOffset = useRef<number | null>(null);
  const tailScrollFrame = useRef<number | null>(null);
  const indexedScrollFrame = useRef<number | null>(null);
  const revisionRevealFrame = useRef<number | null>(null);
  const reviewRestoreFrame = useRef<number | null>(null);
  const postLayoutFrame = useRef<number | null>(null);
  const blankRecovery = useRef(new TranscriptBlankRecoveryScheduler(frames.request, frames.cancel)).current;
  const scheduleBlankRecoveryRef = useRef<() => void>(() => undefined);
  const pendingPostLayoutWork = useRef<TranscriptViewportPostLayoutWork | null>(null);
  const pendingIndexedReveal = useRef<TranscriptIndexedRequest | null>(null);
  const unsettledIndexedReveal = useRef<{ datasetKey: string; target: number; viewPosition: number; offset: number } | null>(null);
  const acknowledgedIndexedReveal = useRef<{ datasetKey: string; offset: number } | null>(null);
  const pendingRevisionReveal = useRef<RevisionRevealRequest | null>(null);
  const pendingReviewRestore = useRef<TranscriptReviewRestoreRequest | null>(null);
  const olderHistoryAnchor = useRef(new TranscriptOlderHistoryAnchor<T>(
    () => ({ datasetKey: datasetKeyRef.current, owner: list.current, itemCount: current.current.itemCount, cursor: current.current.recoveryRow,
      rowKeys: committedRowKeys.current, position: (row) => viewPositionForRow(row, true), holdReview: () => holdReviewAnchor('navigation') }),
    () => ({ datasetKey: datasetKeyRef.current, gestureActive: gesture.active, rowKeys: committedRowKeys.current, owner: list.current,
      viewportHeight: metrics.current.viewportHeight, contentHeight: metrics.current.contentHeight,
      position: (target) => viewPositionForRow(target, true), record: (target, offset) => diagnostics.current.record('writer', {
        ...diagnosticFields(), target, offset, action: 'older-anchor', reason: 'content' }, true) }),
  )).current;
  const visible = useRef<VisibleTranscriptRange>(null);
  const mountedCellProof = useRef<{ revision: object; contentHeight: number; viewportHeight: number } | null>(null);
  // A revision-invalidated index range and an actually blank recycler are
  // different facts. Keep the last native mounted-cell proof until
  // onViewableItemsChanged explicitly withdraws it or the dataset changes.
  const observedScroll = useRef(false);
  const visibleRevision = useRef(revision);
  const lastScrollSample = useRef<{ offset: number; contentHeight: number; viewportHeight: number } | null>(null);
  const metrics = useRef(new TranscriptViewportGeometry()); const current = useRef({ itemCount, recoveryRow, sourceCursorRow });
  const committedRowKeys = useRef(rowKeys);
  const diagnostics = useRef(createTranscriptViewportDiagnostics(datasetKey, recordViewportDiagnostic));
  const sessionCapture = useTranscriptSessionCapture(datasetKey, sessionOptions,
    () => ({ owner: list.current, itemCount: current.current.itemCount, tail: followTail.current, observed: observedScroll.current, metrics: metrics.current }),
    (event, fields) => diagnostics.current.record(event, fields, true));
  // Commit before child layout callbacks, without leaking an abandoned render
  // into the still-visible list's imperative/native input owner.
  useInsertionEffect(() => {
    if (!sameViewportRowKeys(committedRowKeys.current, rowKeys)) {
      olderHistoryAnchor.revision(datasetKey, rowKeys);
      metrics.current.remapReviewRecovery(rowKeys, sessionOptions?.resolveSessionAnchor);
      pendingIndexedReveal.current = remapViewportRowRequest(pendingIndexedReveal.current, datasetKey, rowKeys);
      if (!pendingReviewRestore.current?.session) pendingRevisionReveal.current = remapViewportRowRequest(pendingRevisionReveal.current, datasetKey, rowKeys);
      const restore = pendingReviewRestore.current;
      pendingReviewRestore.current = remapSessionReviewRestore(restore, datasetKey, rowKeys, sessionOptions?.resolveSessionAnchor, performance.now());
      if (restore?.session && !pendingReviewRestore.current) diagnostics.current.record('session-lease-end', { work: 'anchor-missing' }, true);
      if (pendingRevisionReveal.current && restore?.session) pendingRevisionReveal.current = pendingReviewRestore.current;
      unsettledIndexedReveal.current = null; acknowledgedIndexedReveal.current = null;
    }
    committedRowKeys.current = rowKeys;
    datasetKeyRef.current = datasetKey; revisionRef.current = revision;
    reviewIntent.current = onReviewIntent; userReachedEnd.current = onUserReachedEnd;
    current.current = { itemCount, recoveryRow, sourceCursorRow };
    visible.current = transcriptVisibleRangeForRevision(visibleRevision.current, revision, visible.current);
    visibleRevision.current = revision;
  });

  const diagnosticFields = useCallback(() => transcriptViewportDiagnosticFields(current.current, visible.current, metrics.current, followTail.current, gesture.active), []);

  const setTailFollow = useCallback((next: boolean, reason: 'drag' | 'fold' | 'geometry' | 'navigation' | 'recovery' = 'geometry') => {
    if (followTail.current === next) return;
    followTail.current = next;
    diagnostics.current.record('mode', { ...diagnosticFields(), tail: next, reason }, true);
  }, [diagnosticFields]);

  const cancelTailWriter = useCallback((reason: 'dataset' | 'drag' | 'fold' | 'navigation') => {
    unsettledTailOffset.current = null;
    if (tailScrollFrame.current === null) return;
    frames.cancel(tailScrollFrame.current);
    tailScrollFrame.current = null;
    diagnostics.current.record('writer', { ...diagnosticFields(), action: 'cancel-tail', reason }, true);
  }, [diagnosticFields]);

  const cancelIndexedWriter = useCallback((reason: 'dataset' | 'drag' | 'fold' | 'navigation' | 'tail') => {
    pendingIndexedReveal.current = null;
    unsettledIndexedReveal.current = null;
    acknowledgedIndexedReveal.current = null;
    if (indexedScrollFrame.current === null) return;
    frames.cancel(indexedScrollFrame.current);
    indexedScrollFrame.current = null;
    diagnostics.current.record('writer', { ...diagnosticFields(), action: 'cancel-indexed', reason }, true);
  }, [diagnosticFields]);

  const cancelRevisionReveal = useCallback((reason: 'dataset' | 'drag' | 'fold' | 'navigation', clearRecovery = true) => {
    if (clearRecovery) metrics.current.reviewRecovery = null;
    const hadPendingReveal = pendingRevisionReveal.current !== null || pendingReviewRestore.current !== null;
    pendingRevisionReveal.current = null;
    if (pendingReviewRestore.current?.session) diagnostics.current.record('session-lease-end', { ...diagnosticFields(), reason }, true);
    pendingReviewRestore.current = null;
    frames.cancelSlot(revisionRevealFrame);
    frames.cancelSlot(reviewRestoreFrame);
    if (hadPendingReveal) diagnostics.current.record('writer', { ...diagnosticFields(), action: 'cancel-revision-reveal', reason }, true);
    return hadPendingReveal;
  }, [diagnosticFields]);

  const cancelPostLayoutFrame = useCallback((reason: 'dataset' | 'drag' | 'fold' | 'navigation') => {
    const hadPendingWork = pendingPostLayoutWork.current !== null;
    pendingPostLayoutWork.current = null;
    frames.cancelSlot(postLayoutFrame);
    if (hadPendingWork) diagnostics.current.record('writer', { ...diagnosticFields(), action: 'cancel-post-layout', reason }, true);
  }, [diagnosticFields]);

  const holdReviewAnchor = useCallback((reason: 'fold' | 'navigation' = 'fold') => {
    olderHistoryAnchor.cancel();
    setTailFollow(false, reason);
    pendingDatasetReset.current = false;
    if (reason === 'navigation') reviewIntent.current?.(datasetKeyRef.current);
    // An explicit row selection or fold is a new reader intent. Retire a
    // stale tail writer that may have been queued by the prior content size;
    // unlike streaming publication, this does not repeatedly postpone work.
    cancelTailWriter(reason);
    cancelIndexedWriter(reason);
    cancelRevisionReveal(reason);
    cancelPostLayoutFrame(reason);
    diagnostics.current.record(reason === 'fold' ? 'fold-hold' : 'review-hold', { ...diagnosticFields(), reason }, true);
  }, [cancelIndexedWriter, cancelPostLayoutFrame, cancelRevisionReveal, cancelTailWriter, diagnosticFields, setTailFollow]);

  const scrollToEnd = useCallback(() => {
    if (transcriptTailScrollOffset(metrics.current.contentHeight, metrics.current.viewportHeight) === null) {
      diagnostics.current.record('writer', { ...diagnosticFields(), action: 'noop', reason: 'content' });
      return;
    }
    if (!shouldScheduleTranscriptViewportFrame(tailScrollFrame.current)) {
      diagnostics.current.record('writer', { ...diagnosticFields(), action: 'noop', reason: 'content' });
      return;
    }
    diagnostics.current.record('writer', { ...diagnosticFields(), action: 'queue-tail', reason: 'content' });
    const writerDatasetKey = datasetKeyRef.current;
    tailScrollFrame.current = frames.request(() => {
      tailScrollFrame.current = null;
      if (!shouldRunTranscriptViewportWriter(writerDatasetKey, datasetKeyRef.current)) {
        diagnostics.current.record('writer', { ...diagnosticFields(), action: 'drop-tail', reason: 'dataset' }, true);
        return;
      }
      if (!followTail.current || gesture.active) return;
      diagnostics.current.record('writer', { ...diagnosticFields(), action: 'run-tail', reason: 'content' });
      const owner = list.current; const offset = transcriptTailScrollOffset(metrics.current.contentHeight, metrics.current.viewportHeight);
      if (!owner || offset === null) return;
      unsettledTailOffset.current = offset;
      // Bypass FlashList's async scrollToEnd -> scrollToIndex admission path;
      // this callback already owns the exact committed native tail offset.
      launchGuardedBackgroundTask(
        () => owner.scrollToOffset({ offset, animated: false, skipFirstItemOffset: true }),
        () => diagnostics.current.record('writer', { ...diagnosticFields(), action: 'tail-failed', reason: 'recovery' }, true),
      );
    });
  }, [diagnosticFields]);

  const issueIndexedReveal = useCallback((target: number, viewPosition: number, nativeCorrection = false, region?: { y: number; height: number }, rowOffset?: number) => {
    // Coalesce input through the single indexed writer. Latest cursor wins.
    acknowledgedIndexedReveal.current = null;
    const rowKey = committedRowKeys.current?.[target];
    const position = transcriptIndexedRequestPosition(list.current, { target, viewPosition, nativeCorrection,
      ...(region ? { region } : {}), ...(rowOffset !== undefined ? { rowOffset } : {}) }, !!rowKey, metrics.current);
    pendingIndexedReveal.current = { datasetKey: datasetKeyRef.current, rowKey, target, viewPosition: position, nativeCorrection, sessionAuthority: pendingReviewRestore.current?.session?.authority, ...(pendingReviewRestore.current?.session?.endAligned ? { endAligned: true } : {}), ...(region ? { region } : {}), ...(rowOffset !== undefined ? { rowOffset } : {}) };
    if (indexedScrollFrame.current !== null) return;
    indexedScrollFrame.current = frames.request(() => {
      indexedScrollFrame.current = null;
      const request = pendingIndexedReveal.current;
      pendingIndexedReveal.current = null;
      const owner = list.current;
      if (!request || !owner) return;
      if (!shouldRunTranscriptViewportWriter(request.datasetKey, datasetKeyRef.current)) {
        diagnostics.current.record('writer', { ...diagnosticFields(), target: request.target, action: 'drop-indexed', reason: 'dataset' }, true);
        return;
      }
      if (!transcriptIndexedSessionOwnsWrite(request, pendingReviewRestore.current?.session?.authority)) return;
      const plan = transcriptIndexedRevealPlan(owner, request, metrics.current);
      if (plan.offset !== undefined) {
        unsettledIndexedReveal.current = { datasetKey: request.datasetKey, target: request.target, offset: plan.offset, viewPosition: plan.viewPosition };
        diagnostics.current.record('writer', { ...diagnosticFields(), target: request.target, offset: plan.offset, action: 'indexed-offset', reason: 'navigation' });
        owner.scrollToOffset({ offset: plan.offset, animated: false, skipFirstItemOffset: true });
        return;
      }
      diagnostics.current.record('writer', { ...diagnosticFields(), target: request.target, action: 'indexed-fallback', reason: 'recovery' }, true);
      launchGuardedBackgroundTask(() => owner.scrollToIndex(plan.fallback),
        () => diagnostics.current.record('writer', { ...diagnosticFields(), target: request.target, action: 'indexed-failed', reason: 'recovery' }, true));
    });
  }, [diagnosticFields]);

  const scheduleReviewRestoreVerification = useCallback(() => scheduleTranscriptReviewRestoreVerification({
    historyLoading: () => !!sessionCapture.committed.current.options?.historyLoading,
    leaseEnded: reason => { cancelIndexedWriter('navigation'); pendingRevisionReveal.current = null; frames.cancelSlot(revisionRevealFrame); diagnostics.current.record('session-lease-end', { ...diagnosticFields(), work: reason }, true); },
    pending: pendingReviewRestore, frame: reviewRestoreFrame, requestFrame: frames.request,
    ownsDataset: (owner) => shouldRunTranscriptViewportWriter(owner, datasetKeyRef.current),
    actualPosition: (target) => pendingReviewRestore.current?.rowOffset !== undefined
      ? measuredSessionPixelRestoreError(list.current, target, pendingReviewRestore.current.rowOffset, metrics.current, observedScroll.current, !!pendingReviewRestore.current.painted, !!pendingReviewRestore.current.session?.endAligned)
      : measuredViewportRowPosition(list.current, target, visible.current, metrics.current, observedScroll.current, pendingReviewRestore.current?.viewPosition),
    issueIndexedReveal: (target, position, correction, rowOffset) => issueIndexedReveal(target, position, correction, undefined, rowOffset), scheduleBlankRecovery: () => scheduleBlankRecoveryRef.current(),
    record: (action, request, actualPosition, force = true) => diagnostics.current.record('writer', {
      ...diagnosticFields(), target: request.target, positionPermille: request.viewPosition * 1_000,
      actualPermille: actualPosition === null ? undefined : actualPosition * 1_000, action, reason: 'recovery',
    }, force),
  }), [cancelIndexedWriter, diagnosticFields, issueIndexedReveal]);

  const scheduleRevisionReveal = useCallback((restart = false) => scheduleTranscriptRevisionReveal({
    pending: pendingRevisionReveal, review: pendingReviewRestore, frame: revisionRevealFrame,
    requestFrame: frames.request, cancelFrame: frames.cancel,
    ownsDataset: key => shouldRunTranscriptViewportWriter(key, datasetKeyRef.current),
    issue: request => issueIndexedReveal(request.target, request.viewPosition, false, undefined, request.rowOffset),
    verify: scheduleReviewRestoreVerification,
    record: (action, request) => diagnostics.current.record('writer', { ...diagnosticFields(), target: request.target,
      positionPermille: request.viewPosition * 1_000, action, reason: 'content' }, action === 'run-revision-reveal'),
  }, restart), [diagnosticFields, issueIndexedReveal, scheduleReviewRestoreVerification]);

  const revealAfterRevision = useCallback((requestedRow: number, viewPosition = 0.22, rowOffset?: number, session?: SessionRestoreIntent) => {
    const target = boundedTranscriptRow(requestedRow, current.current.itemCount); if (target === null) return;
    cancelTailWriter('navigation');
    cancelIndexedWriter('fold');
    cancelPostLayoutFrame('navigation');
    setTailFollow(false, 'recovery');
    pendingDatasetReset.current = false;
    pendingRevisionReveal.current = transcriptReviewRevisionRequest(datasetKeyRef.current, committedRowKeys.current?.[target], target, viewPosition, rowOffset);
    metrics.current.holdReviewRecovery(pendingRevisionReveal.current, session?.anchor);
    pendingReviewRestore.current = createTranscriptReviewRestore(pendingRevisionReveal.current, session,
      visible.current, current.current.itemCount);
    scheduleRevisionReveal(true);
  }, [cancelIndexedWriter, cancelPostLayoutFrame, cancelTailWriter, scheduleRevisionReveal, setTailFollow]);

  const viewPositionForRow = useCallback((requestedRow: number, preferObservedScroll = false, targetRow?: number) => {
    return captureViewportRowPosition({ owner: list.current, target: boundedTranscriptRow(requestedRow, current.current.itemCount),
      targetRow, preferObservedScroll, metrics: metrics.current, observedScroll: observedScroll.current, datasetKey: datasetKeyRef.current,
      unsettled: unsettledIndexedReveal.current, pending: pendingIndexedReveal.current });
  }, []);

  const reveal = useCallback((requestedRow: number, force = false, ownership: TranscriptRevealOwnership = 'review', previousRequestedRow?: number) => {
    olderHistoryAnchor.cancel();
    const target = boundedTranscriptRow(requestedRow, current.current.itemCount); if (target === null) return;
    const previousTarget = previousRequestedRow === undefined ? null : boundedTranscriptRow(previousRequestedRow, current.current.itemCount);
    // Ordinary Vim motion owns both the new document row and the previous
    // cursor's exact screen position. Capture that position before scheduling
    // a recycler write; a generic 22%/78% edge recenter makes the block cursor
    // jump across the pane as soon as j/k crosses the scroll band.
    // Recovery may observe an empty viewability interval while native anchoring
    // already holds this row correctly. 'preserve' must not recenter it at 45%.
    const preservedCursorPosition = ownership === 'preserve' ? viewPositionForRow(target, true)
      : !force && ownership === 'review' && previousTarget !== null ? viewPositionForRow(previousTarget, true, target) : null;
    const replacedRevisionReveal = cancelRevisionReveal('navigation', ownership !== 'preserve');
    cancelPostLayoutFrame('navigation');
    if (ownership === 'tail') {
      // Jump-to-latest/G/submit is newer intent than the active drag or fling.
      // Retire that gesture before the tail frame checks scroll ownership;
      // its late end/momentum callbacks must not cancel the explicit jump.
      gesture.retire();
      userEndReceipt.current = null; lastScrollSample.current = null;
    }
    const nextTailFollow = transcriptTailFollowForReveal(followTail.current, ownership);
    setTailFollow(nextTailFollow, 'navigation');
    if (shouldCancelTranscriptTailWriter(ownership, tailScrollFrame.current)) cancelTailWriter('navigation');
    diagnostics.current.record('reveal', { ...diagnosticFields(), requested: requestedRow, target, tail: nextTailFollow, reason: 'navigation' });
    if (nextTailFollow) {
      cancelIndexedWriter('tail');
      const value = metrics.current;
      const distanceFromBottom = value.contentHeight - (value.offset + value.viewportHeight);
      // Cursor motion inside the already-visible two-row tail zone is purely
      // a highlight update. Do not enqueue a redundant competing scroll.
      if (shouldScrollTranscriptTailReveal(force, target, visible.current, distanceFromBottom, BOTTOM_TOLERANCE)) scrollToEnd();
      return;
    }
    pendingDatasetReset.current = false;
    const finalLineMotion = ownership === 'review' && previousTarget !== null && target > previousTarget && target === current.current.itemCount - 1;
    const rangeNeedsReveal = shouldScrollTranscriptTarget(target, visible.current, force || replacedRevisionReveal);
    const geometryNeedsReveal = !rangeNeedsReveal
      && viewportTargetOutsidePaintedViewport(list.current, target, metrics.current, observedScroll.current);
    if (!finalLineMotion && !rangeNeedsReveal && !geometryNeedsReveal) return;
    const range = visible.current;
    const viewPosition = preservedCursorPosition ?? (!range ? 0.45 : target < range.first ? 0.22 : 0.78);
    issueIndexedReveal(target, finalLineMotion ? 1 : viewPosition);
  }, [cancelIndexedWriter, cancelPostLayoutFrame, cancelRevisionReveal, cancelTailWriter, issueIndexedReveal, scrollToEnd, setTailFollow, viewPositionForRow]);

  const { captureRegionPosition, revealRegion, cancelRegionReveal } = useTranscriptRegionReveal({
    list, metrics, observedScroll, current, pendingDatasetReset, pendingIndexedReveal,
    cancelSessionRestore: () => { if (pendingReviewRestore.current?.session) { cancelIndexedWriter('navigation'); cancelRevisionReveal('navigation'); } },
    olderHistoryAnchor, cancelRevisionReveal, cancelPostLayoutFrame,
    cancelTailWriter, cancelIndexedWriter, setTailFollow, issueIndexedReveal,
  });

  const scheduleBlankRecovery = useCallback(() => {
    blankRecovery.schedule({ datasetKey: datasetKeyRef.current, generation: revisionRef.current,
      ownsGeneration: (owner) => owner === revisionRef.current,
      snapshot: () => ({ userScrollActive: gesture.active, pendingDatasetReset: pendingDatasetReset.current,
        writers: { tail: tailScrollFrame.current, indexed: indexedScrollFrame.current, revision: revisionRevealFrame.current,
          postLayout: postLayoutFrame.current, reviewRestore: pendingReviewRestore.current !== null,
          olderHistory: olderHistoryAnchor.ownsCorrection(datasetKeyRef.current) },
        itemCount: current.current.itemCount, hasMountedVisibleCells: mountedCellProof.current !== null, ...metrics.current,
        followTail: followTail.current, visible: visible.current }), diagnosticFields,
      record: (event, fields, force) => { diagnostics.current.record(event, fields, force); },
      recoverTailRange: (row) => issueIndexedReveal(row, 1, true), recoverBlank: () => reveal(metrics.current.recoveryRow(current.current.recoveryRow), true, 'preserve') });
  }, [blankRecovery, diagnosticFields, issueIndexedReveal, reveal]);
  useInsertionEffect(() => { scheduleBlankRecoveryRef.current = scheduleBlankRecovery; }, [scheduleBlankRecovery]);

  const recoverIfOffContent = useCallback(() => {
    // A native prepend can report its new scroll offset before the recycler's
    // content-height mirror catches up. The request-scoped keyed anchor owns
    // this settle interval; treating that temporary mismatch as blank/off-
    // content recovery cancels its correction and jumps to the selected row.
    if (olderHistoryAnchor.ownsCorrection(datasetKeyRef.current) || pendingReviewRestore.current) return;
    const value = metrics.current;
    if (!shouldRecoverTranscriptViewport(gesture.active, value.offset, value.contentHeight, value.viewportHeight)) return;
    diagnostics.current.record('off-content', { ...diagnosticFields(), reason: 'recovery' });
    reveal(metrics.current.recoveryRow(current.current.recoveryRow), true, 'preserve');
  }, [diagnosticFields, reveal]);

  const schedulePostLayoutFrame = useCallback((recover: boolean) => {
    pendingPostLayoutWork.current = nextTranscriptViewportPostLayoutWork(
      pendingPostLayoutWork.current,
      datasetKeyRef.current,
      recover,
    );
    if (postLayoutFrame.current !== null) return;
    diagnostics.current.record('writer', { ...diagnosticFields(), action: 'queue-post-layout', reason: 'geometry' });
    postLayoutFrame.current = frames.request(() => {
      postLayoutFrame.current = null;
      const work = pendingPostLayoutWork.current;
      pendingPostLayoutWork.current = null;
      if (!shouldRunTranscriptViewportPostLayoutWork(work, datasetKeyRef.current)) {
        diagnostics.current.record('writer', { ...diagnosticFields(), action: 'drop-post-layout', reason: 'dataset' }, true);
        return;
      }
      diagnostics.current.record('writer', { ...diagnosticFields(), action: 'run-post-layout', reason: 'geometry' });
      if (work.recover) recoverIfOffContent();
      scheduleBlankRecovery();
    });
  }, [diagnosticFields, recoverIfOffContent, scheduleBlankRecovery]);

  useInsertionEffect(() => {
    // A keyed FlashList can publish its only initial content-size callback
    // from a child layout effect. Reset this dataset before that callback;
    // a parent layout effect would erase its geometry and leave the blank
    // recovery guard pending until the first keyboard reveal.
    cancelTailWriter('dataset');
    cancelIndexedWriter('dataset');
    cancelRevisionReveal('dataset');
    cancelPostLayoutFrame('dataset');
    blankRecovery.cancel();
    diagnostics.current = createTranscriptViewportDiagnostics(datasetKey, recordViewportDiagnostic);
    followTail.current = true; gesture.retire(); pendingDatasetReset.current = true; visible.current = null; mountedCellProof.current = null; olderHistoryAnchor.cancel();
    metrics.current.resetDataset(); observedScroll.current = false; lastScrollSample.current = null;
    diagnostics.current.record('dataset', { ...diagnosticFields(), tail: true, reset: true, mounted: false, reason: 'dataset' }, true);
  }, [blankRecovery, cancelIndexedWriter, cancelPostLayoutFrame, cancelRevisionReveal, cancelTailWriter, datasetKey, diagnosticFields]);

  useEffect(() => {
    // `onScroll` belongs to the content generation that emitted it. Do not let
    // the preceding generation's mirror override newer recycler geometry.
    observedScroll.current = false;
    // A data revision is published before FlatList has its new content size.
    // Scrolling to the old end here, then again from onContentSizeChange,
    // makes a streaming tail visibly oscillate between two offsets. Let the
    // post-layout content-size callback be the sole tail writer.
    if (!followTail.current) schedulePostLayoutFrame(false);
    // A same-height replacement at the tail may emit neither a new content
    // size nor another viewability callback. The revision already invalidated
    // the preceding visible-range proof, so arm the revision-owned two-frame
    // blank check directly; normal viewability or pending writers cancel it.
    scheduleBlankRecovery();
    diagnostics.current.record('content', { ...diagnosticFields(), reason: 'revision' });
  }, [revision, scheduleBlankRecovery, schedulePostLayoutFrame, diagnosticFields]);

  useEffect(() => () => {
    for (const slot of [tailScrollFrame, indexedScrollFrame, revisionRevealFrame, reviewRestoreFrame, postLayoutFrame]) frames.cancelSlot(slot);
    blankRecovery.cancel();
    pendingRevisionReveal.current = null;
    pendingReviewRestore.current = null;
    unsettledIndexedReveal.current = null;
    acknowledgedIndexedReveal.current = null;
    pendingPostLayoutWork.current = null;
  }, []);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const previousSample = lastScrollSample.current;
    const geometryChanged = metrics.current.contentHeight !== contentSize.height || metrics.current.viewportHeight !== layoutMeasurement.height;
    if (!metrics.current.acceptScroll(event.nativeEvent)) return;
    observedScroll.current = true;
    lastScrollSample.current = { ...metrics.current };
    const expectedTailOffset = unsettledTailOffset.current;
    const tailWriterAcknowledged = transcriptTailWriterOwnsScrollSample(expectedTailOffset, contentOffset.y, BOTTOM_TOLERANCE);
    // Tail writes retire after their first native sample, matched or not.
    // Missing acknowledgements cannot mask later omitted-begin-drag input.
    if (expectedTailOffset !== null) unsettledTailOffset.current = null;
    const issuedReveal = unsettledIndexedReveal.current;
    const indexedWriterAcknowledged = !!issuedReveal
      && issuedReveal.datasetKey === datasetKeyRef.current
      && transcriptIndexedRevealAcknowledged(issuedReveal.offset, contentOffset.y);
    if (issuedReveal) {
      acknowledgedIndexedReveal.current = { datasetKey: issuedReveal.datasetKey, offset: issuedReveal.offset };
      unsettledIndexedReveal.current = null;
    }
    const restore = pendingReviewRestore.current;
    metrics.current.observeRecovery(!!restore || !!issuedReveal, geometryChanged, previousSample?.offset);
    const latestIndexedReveal = issuedReveal ?? acknowledgedIndexedReveal.current;
    pendingReviewRestore.current = reviewRestoreAfterScroll(restore,
      latestIndexedReveal?.datasetKey === restore?.datasetKey ? latestIndexedReveal?.offset : undefined,
      contentOffset.y, geometryChanged, performance.now(), !!issuedReveal, previousSample?.offset);
    if (pendingReviewRestore.current?.session && pendingReviewRestore.current.movedWithoutDrag
      && !transcriptViewportIsOffContent(contentOffset.y, contentSize.height, layoutMeasurement.height)) {
      blankRecovery.cancel(); holdReviewAnchor('navigation');
    }
    diagnostics.current.record('scroll', { ...diagnosticFields(), offset: contentOffset.y, contentHeight: contentSize.height, viewportHeight: layoutMeasurement.height, reason: 'geometry' });
    const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    // A user gesture may acknowledge the loaded tail, never grant follow-tail.
    // Capture this publication at the native sample; a later response or layout
    // must not be consumed by a stale drag/momentum completion.
    if (gesture.active) userEndReceipt.current = Number.isFinite(distanceFromBottom) && distanceFromBottom <= 2
      && contentSize.height > 0 && layoutMeasurement.height > 0
      ? { revision: revisionRef.current, callback: userReachedEnd.current, contentHeight: contentSize.height, viewportHeight: layoutMeasurement.height } : null;
    // An omitted begin-drag needs upward motion in a current visible range.
    // Retained mount proof survives empty reports and cannot settle placement.
    // Growth, entry, resize and off-content recovery are not review intent.
    const inferredUserReview = frames.isActive && followTail.current && visible.current !== null && !gesture.active && !pendingDatasetReset.current && !transcriptViewportIsOffContent(contentOffset.y, contentSize.height, layoutMeasurement.height)
      && transcriptScrollMovedIntoReview(previousSample, metrics.current, visible.current?.last === current.current.itemCount - 1 && mountedCellProof.current?.contentHeight === contentSize.height && mountedCellProof.current?.viewportHeight === layoutMeasurement.height ? expectedTailOffset : null)
      && !tailWriterAcknowledged && !indexedWriterAcknowledged && distanceFromBottom > BOTTOM_TOLERANCE;
    if (inferredUserReview) { cancelTailWriter('drag'); reviewIntent.current?.(datasetKeyRef.current); }
    setTailFollow(transcriptTailFollowAfterScroll(followTail.current, gesture.active || inferredUserReview, distanceFromBottom, BOTTOM_TOLERANCE));
    if (geometryChanged && followTail.current && !gesture.active && distanceFromBottom > BOTTOM_TOLERANCE) scrollToEnd();
    recoverIfOffContent(); olderHistoryAnchor.correct();
    sessionCapture.sample();
    scheduleReviewRestoreVerification();
  }, [cancelTailWriter, holdReviewAnchor, recoverIfOffContent, scheduleReviewRestoreVerification, scrollToEnd, setTailFollow]);

  const onContentSizeChange = useCallback((_width: number, height: number) => {
    if (Math.abs(metrics.current.contentHeight - height) > 0.5) {
      // A new measured content generation invalidates the last React mirror.
      observedScroll.current = false;
      pendingReviewRestore.current = reviewRestoreAfterGeometry(pendingReviewRestore.current, true, performance.now());
    }
    metrics.current.contentHeight = height;
    diagnostics.current.record('content', { ...diagnosticFields(), contentHeight: height, reason: 'content' });
    if (pendingDatasetReset.current) {
      pendingDatasetReset.current = false;
      if (followTail.current) scrollToEnd();
      schedulePostLayoutFrame(false);
      return;
    }
    if (followTail.current) scrollToEnd();
    scheduleRevisionReveal(true);
    scheduleReviewRestoreVerification();
    schedulePostLayoutFrame(true); olderHistoryAnchor.correct();
  }, [diagnosticFields, schedulePostLayoutFrame, scheduleReviewRestoreVerification, scheduleRevisionReveal, scrollToEnd]);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const changed = metrics.current.resize(event.nativeEvent.layout.height);
    diagnostics.current.record('layout', { ...diagnosticFields(), viewportHeight: event.nativeEvent.layout.height, reason: 'geometry' }, changed);
    if (!changed) return;
    pendingReviewRestore.current = reviewRestoreAfterGeometry(pendingReviewRestore.current, true, performance.now());
    if (followTail.current) scrollToEnd(); scheduleReviewRestoreVerification(); schedulePostLayoutFrame(true);
  }, [diagnosticFields, schedulePostLayoutFrame, scrollToEnd]);

  const finishUserScroll = useCallback(() => {
    const value = metrics.current;
    const receipt = userEndReceipt.current; userEndReceipt.current = null;
    if (gesture.active && receipt?.revision === revisionRef.current && receipt.callback === userReachedEnd.current
      && receipt.contentHeight === value.contentHeight && receipt.viewportHeight === value.viewportHeight) receipt.callback?.();
    setTailFollow(transcriptTailFollowAfterScroll(followTail.current, true, value.contentHeight - (value.offset + value.viewportHeight), BOTTOM_TOLERANCE));
    gesture.retire(); olderHistoryAnchor.endDrag();
    olderHistoryAnchor.correct();
    schedulePostLayoutFrame(true);
  }, [schedulePostLayoutFrame, setTailFollow]);

  const onScrollBeginDrag = useCallback(() => {
    olderHistoryAnchor.beginDrag();
    reviewIntent.current?.(datasetKeyRef.current);
    blankRecovery.cancel();
    gesture.begin(); userEndReceipt.current = null;
    setTailFollow(transcriptTailFollowOnDragBegin(), 'drag');
    cancelTailWriter('drag');
    cancelIndexedWriter('drag');
    cancelRevisionReveal('drag');
    cancelPostLayoutFrame('drag');
  }, [blankRecovery, cancelIndexedWriter, cancelPostLayoutFrame, cancelRevisionReveal, cancelTailWriter, setTailFollow]);
  const onScrollEndDrag = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (gesture.endDrag(event.nativeEvent.velocity?.y)) finishUserScroll();
  }, [finishUserScroll]);
  const onMomentumScrollBegin = useCallback(() => gesture.beginMomentum(), []);
  const onMomentumScrollEnd = useCallback(() => { if (gesture.endMomentum()) finishUserScroll(); }, [finishUserScroll]);

  const onViewableItemsChanged = useRef<NonNullable<FlashListProps<T>['onViewableItemsChanged']>>(({ viewableItems }) => {
    const indices = viewableItems.flatMap((item) => item.index === null ? [] : [item.index]);
    const readerMove = pendingReviewRestore.current;
    // Non-session restores retain their existing target-exclusion semantics.
    // Session reader movement is retired at its accepted native scroll sample.
    if (indices.length > 0 && readerMove?.movedWithoutDrag && readerMove.datasetKey === datasetKeyRef.current && !indices.includes(readerMove.target)) {
      blankRecovery.cancel(); holdReviewAnchor('navigation');
    }
    visible.current = indices.length ? { first: Math.min(...indices), last: Math.max(...indices) } : null;
    pendingReviewRestore.current = reviewRestoreAfterViewability(pendingReviewRestore.current, indices, current.current.itemCount - 1);
    mountedCellProof.current = nextTranscriptMountedCellProof(indices, mountedCellProof.current,
      revisionRef.current, metrics.current);
    const mounted = mountedCellProof.current !== null;
    const tailRangeIncomplete = shouldRestoreTranscriptTailRange(followTail.current, gesture.active, current.current.itemCount, visible.current);
    if (mounted && !tailRangeIncomplete) blankRecovery.settledVisible(); else scheduleBlankRecovery();
    diagnostics.current.record('visible', { ...diagnosticFields(), first: visible.current?.first ?? null, last: visible.current?.last ?? null, mounted, reason: 'geometry' });
    sessionCapture.sample(false);
    scheduleReviewRestoreVerification();
  }).current;

  const captureSessionReviewAnchor = useCallback(() => followTail.current ? null
    : captureSessionReviewPixelAnchor(list.current, current.current.itemCount, metrics.current, observedScroll.current), []);
  const captureReviewAnchor = useCallback((preference: 'cursor' | 'start' = 'cursor') => followTail.current ? null
    : captureTranscriptReviewAnchor(list.current, current.current.itemCount, current.current.recoveryRow, viewPositionForRow, preference), [viewPositionForRow]);
  const nativeCallbacks = useTranscriptNativeCallbacks<T>(datasetKey, { onScroll, onScrollBeginDrag, onScrollEndDrag, onMomentumScrollBegin, onMomentumScrollEnd, onContentSizeChange, onLayout, onViewableItemsChanged });
  return { list, ...nativeCallbacks, reveal, revealAfterRevision, revealRegion, cancelRegionReveal, captureRegionPosition, viewPositionForRow, holdReviewAnchor, captureReviewAnchor, captureSessionReviewAnchor,
    captureOlderHistoryAnchor: olderHistoryAnchor.captureFromViewport, retireUnchangedOlderHistoryAnchor: olderHistoryAnchor.retireUnchanged,
    onOlderHistoryLayoutCommit: olderHistoryAnchor.correct };
}
