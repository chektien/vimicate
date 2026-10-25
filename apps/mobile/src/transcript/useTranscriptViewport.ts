import { useTranscriptRegionReveal } from './useTranscriptRegionReveal';
import { TranscriptViewportGeometry } from './transcriptViewportGeometry';
import { TranscriptScrollGesture } from './transcriptScrollGesture';
import { captureViewportRowPosition, measuredViewportRowPosition, viewportTargetOutsidePaintedViewport } from './transcriptViewportPositionCapture';
import { remapViewportRowRequest, sameViewportRowKeys } from './transcriptViewportRowIdentity';
import { useCallback, useEffect, useInsertionEffect, useRef } from 'react';
import type { FlashListProps, FlashListRef } from '@shopify/flash-list';
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { launchGuardedBackgroundTask } from '../async/guardedBackgroundTask';
import { recordViewportDiagnostic } from '../../modules/vimicate-diagnostics';
import { boundedTranscriptRow, nextTranscriptViewportPostLayoutWork, shouldRecoverTranscriptViewport, shouldRestoreTranscriptTailRange, shouldRunTranscriptViewportPostLayoutWork, shouldRunTranscriptViewportWriter, shouldScheduleTranscriptViewportFrame, shouldScrollTranscriptTarget, transcriptTailScrollOffset, transcriptTailWriterOwnsScrollSample, transcriptViewportIsOffContent, transcriptVisibleRangeForRevision, type TranscriptViewportPostLayoutWork, type VisibleTranscriptRange } from './transcriptViewportPolicy';
import { shouldCancelTranscriptTailWriter, shouldScrollTranscriptTailReveal, transcriptScrollMovedIntoReview, transcriptTailFollowAfterScroll, transcriptTailFollowForReveal, transcriptTailFollowOnDragBegin, type TranscriptRevealOwnership } from './transcriptTailFollowPolicy';
import { createTranscriptViewportDiagnostics, transcriptViewportDiagnosticFields } from './transcriptViewportDiagnostics';
import { transcriptBoundedIndexedViewPosition, transcriptIndexedRevealAcknowledged, transcriptIndexedRevealOffset, transcriptIndexedViewPosition, transcriptIndexedViewPositionForCursorCenter } from './transcriptIndexedReveal';
import { scheduleTranscriptReviewRestoreVerification, TRANSCRIPT_REVIEW_RESTORE_SETTLE_MS, type TranscriptReviewRestoreRequest } from './transcriptReviewRestoreVerification';
import { TranscriptBlankRecoveryScheduler } from './transcriptBlankRecoveryScheduler';
import { useViewportFrameScheduler } from './useViewportFrameScheduler';
import { useTranscriptNativeCallbacks } from './useTranscriptNativeCallbacks';
import { captureTranscriptReviewAnchor } from './transcriptReviewAnchorCapture';
import { TranscriptOlderHistoryAnchor } from './TranscriptOlderHistoryAnchor';
import { nextTranscriptMountedCellProof } from './transcriptMountedCellProof';

const BOTTOM_TOLERANCE = 32;

export function useTranscriptViewport<T>(datasetKey: string, revision: object, itemCount: number, recoveryRow: number, sourceCursorRow: number, onReviewIntent?: (sessionKey: string) => void, rowKeys?: readonly string[], onUserReachedEnd?: () => void) {
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
  const pendingIndexedReveal = useRef<{ rowKey?: string | undefined; datasetKey: string; target: number; viewPosition: number; nativeCorrection: boolean; region?: { y: number; height: number } } | null>(null);
  const unsettledIndexedReveal = useRef<{ datasetKey: string; target: number; viewPosition: number; offset: number } | null>(null);
  const acknowledgedIndexedReveal = useRef<{ datasetKey: string; target: number; viewPosition: number; offset: number } | null>(null);
  const pendingRevisionReveal = useRef<{ rowKey?: string | undefined; datasetKey: string; target: number; viewPosition: number } | null>(null);
  const pendingReviewRestore = useRef<TranscriptReviewRestoreRequest | null>(null);
  const pendingUnownedReviewMove = useRef<{ datasetKey: string; target: number } | null>(null);
  const olderHistoryAnchor = useRef(new TranscriptOlderHistoryAnchor<T>(
    () => ({ datasetKey: datasetKeyRef.current, owner: list.current, itemCount: current.current.itemCount, cursor: current.current.recoveryRow,
      rowKeys: committedRowKeys.current, position: (row) => viewPositionForRow(row, true), holdReview: () => holdReviewAnchor('navigation') }),
    () => ({ datasetKey: datasetKeyRef.current, gestureActive: gesture.active, rowKeys: committedRowKeys.current, owner: list.current,
      viewportHeight: metrics.current.viewportHeight, contentHeight: metrics.current.contentHeight,
      position: (target) => viewPositionForRow(target, true), record: (target, offset) => diagnostics.current.record('writer', {
        ...diagnosticFields(), target, offset, action: 'older-anchor', reason: 'content' }, true) }),
  )).current;
  const visible = useRef<VisibleTranscriptRange>(null); const hasMountedVisibleCells = useRef(false);
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
  // Commit before child layout callbacks, without leaking an abandoned render
  // into the still-visible list's imperative/native input owner.
  useInsertionEffect(() => {
    if (!sameViewportRowKeys(committedRowKeys.current, rowKeys)) {
      olderHistoryAnchor.revision(datasetKey, rowKeys);
      pendingIndexedReveal.current = remapViewportRowRequest(pendingIndexedReveal.current, datasetKey, rowKeys);
      pendingRevisionReveal.current = remapViewportRowRequest(pendingRevisionReveal.current, datasetKey, rowKeys);
      pendingReviewRestore.current = remapViewportRowRequest(pendingReviewRestore.current, datasetKey, rowKeys);
      unsettledIndexedReveal.current = null; acknowledgedIndexedReveal.current = null; pendingUnownedReviewMove.current = null;
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

  const cancelRevisionReveal = useCallback((reason: 'dataset' | 'drag' | 'fold' | 'navigation') => {
    const hadPendingReveal = pendingRevisionReveal.current !== null || pendingReviewRestore.current !== null;
    pendingRevisionReveal.current = null;
    pendingReviewRestore.current = null;
    pendingUnownedReviewMove.current = null;
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

  const issueIndexedReveal = useCallback((target: number, viewPosition: number, nativeCorrection = false, region?: { y: number; height: number }) => {
    // Latest cursor wins. This frame owner prevents multiple key events in one
    // display interval from starting overlapping FlashList scrollToIndex
    // correction sequences.
    acknowledgedIndexedReveal.current = null;
    const rowKey = committedRowKeys.current?.[target];
    const owner = list.current; const cell = rowKey && !nativeCorrection ? owner?.getLayout(target) : null;
    const layout = cell && region ? { y: cell.y + region.y, height: region.height } : cell;
    const windowHeight = owner?.getWindowSize().height || metrics.current.viewportHeight;
    const position = owner && layout && !(region && layout.height >= windowHeight) ? transcriptBoundedIndexedViewPosition(layout, windowHeight,
      Math.max(metrics.current.contentHeight, owner.getChildContainerDimensions().height), owner.getFirstItemOffset(), viewPosition) : viewPosition;
    pendingIndexedReveal.current = { datasetKey: datasetKeyRef.current, rowKey, target, viewPosition: position, nativeCorrection, ...(region ? { region } : {}) };
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
      const cell = request.nativeCorrection ? null : owner.getLayout(request.target);
      const layout = cell && request.region ? { y: cell.y + request.region.y, height: request.region.height } : cell;
      if (layout) {
        const windowHeight = owner.getWindowSize().height || metrics.current.viewportHeight;
        const contentHeight = Math.max(metrics.current.contentHeight, owner.getChildContainerDimensions().height);
        const firstItemOffset = owner.getFirstItemOffset();
        const offset = transcriptIndexedRevealOffset(layout, windowHeight, contentHeight, firstItemOffset, request.viewPosition);
        unsettledIndexedReveal.current = {
          datasetKey: request.datasetKey,
          target: request.target,
          offset,
          viewPosition: transcriptIndexedViewPosition(layout, windowHeight, offset, firstItemOffset),
        };
        diagnostics.current.record('writer', { ...diagnosticFields(), target: request.target, offset, action: 'indexed-offset', reason: 'navigation' });
        owner.scrollToOffset({ offset, animated: false, skipFirstItemOffset: true });
        return;
      }
      // Layout admission is normally synchronous. An isolated far jump before
      // admission may still use FlashList's corrective path; the frame owner
      // guarantees there is only one such request rather than a repeat backlog.
      diagnostics.current.record('writer', { ...diagnosticFields(), target: request.target, action: 'indexed-fallback', reason: 'recovery' }, true);
      launchGuardedBackgroundTask(
        () => owner.scrollToIndex({ index: request.target, animated: false, viewPosition: request.viewPosition }),
        () => diagnostics.current.record('writer', { ...diagnosticFields(), target: request.target, action: 'indexed-failed', reason: 'recovery' }, true),
      );
    });
  }, [diagnosticFields]);

  const scheduleReviewRestoreVerification = useCallback(() => scheduleTranscriptReviewRestoreVerification({
    pending: pendingReviewRestore, frame: reviewRestoreFrame, requestFrame: frames.request,
    ownsDataset: (owner) => shouldRunTranscriptViewportWriter(owner, datasetKeyRef.current),
    actualPosition: (target) => measuredViewportRowPosition(list.current, target, visible.current, metrics.current, observedScroll.current, pendingReviewRestore.current?.viewPosition),
    issueIndexedReveal, scheduleBlankRecovery: () => scheduleBlankRecoveryRef.current(),
    record: (action, request, actualPosition, force = true) => diagnostics.current.record('writer', {
      ...diagnosticFields(), target: request.target, positionPermille: request.viewPosition * 1_000,
      actualPermille: actualPosition === null ? undefined : actualPosition * 1_000, action, reason: 'recovery',
    }, force),
  }), [diagnosticFields, issueIndexedReveal]);

  const scheduleRevisionReveal = useCallback((restart = false) => {
    if (!pendingRevisionReveal.current) return;
    if (restart && revisionRevealFrame.current !== null) {
      frames.cancel(revisionRevealFrame.current);
      revisionRevealFrame.current = null;
    }
    if (revisionRevealFrame.current !== null) return;
    diagnostics.current.record('writer', { ...diagnosticFields(), action: 'queue-revision-reveal', reason: 'content' });
    revisionRevealFrame.current = frames.request(() => {
      revisionRevealFrame.current = frames.request(() => {
        revisionRevealFrame.current = null;
        const request = pendingRevisionReveal.current;
        pendingRevisionReveal.current = null;
        if (!request || !shouldRunTranscriptViewportWriter(request.datasetKey, datasetKeyRef.current)) return;
        const restore = pendingReviewRestore.current;
        if (restore && restore.datasetKey === request.datasetKey && restore.target === request.target) {
          pendingReviewRestore.current = {
            ...restore,
            writes: restore.writes + 1,
            confirmations: 0,
            settleUntil: performance.now() + TRANSCRIPT_REVIEW_RESTORE_SETTLE_MS,
          };
        }
        diagnostics.current.record('writer', { ...diagnosticFields(), target: request.target, positionPermille: request.viewPosition * 1_000, action: 'run-revision-reveal', reason: 'content' }, true);
        issueIndexedReveal(request.target, request.viewPosition);
        scheduleReviewRestoreVerification();
      });
    });
  }, [diagnosticFields, issueIndexedReveal, scheduleReviewRestoreVerification]);

  const revealAfterRevision = useCallback((requestedRow: number, viewPosition = 0.22) => {
    const target = boundedTranscriptRow(requestedRow, current.current.itemCount); if (target === null) return;
    cancelTailWriter('navigation');
    cancelIndexedWriter('fold');
    cancelPostLayoutFrame('navigation');
    setTailFollow(false, 'recovery');
    pendingDatasetReset.current = false;
    const boundedPosition = Math.max(0, Math.min(1, viewPosition));
    pendingRevisionReveal.current = { datasetKey: datasetKeyRef.current, rowKey: committedRowKeys.current?.[target], target, viewPosition: boundedPosition };
    pendingReviewRestore.current = { datasetKey: datasetKeyRef.current, rowKey: committedRowKeys.current?.[target], target, viewPosition: boundedPosition, writes: 0, confirmations: 0, settleUntil: Number.POSITIVE_INFINITY, fallbackUsed: false };
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
    const replacedRevisionReveal = cancelRevisionReveal('navigation');
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
        itemCount: current.current.itemCount, hasMountedVisibleCells: hasMountedVisibleCells.current, ...metrics.current,
        followTail: followTail.current, visible: visible.current }), diagnosticFields,
      record: (event, fields, force) => { diagnostics.current.record(event, fields, force); },
      recoverTailRange: (row) => issueIndexedReveal(row, 1, true), recoverBlank: () => reveal(current.current.recoveryRow, true, 'preserve') });
  }, [blankRecovery, diagnosticFields, issueIndexedReveal, reveal]);
  useInsertionEffect(() => { scheduleBlankRecoveryRef.current = scheduleBlankRecovery; }, [scheduleBlankRecovery]);

  const recoverIfOffContent = useCallback(() => {
    // A native prepend can report its new scroll offset before the recycler's
    // content-height mirror catches up. The request-scoped keyed anchor owns
    // this settle interval; treating that temporary mismatch as blank/off-
    // content recovery cancels its correction and jumps to the selected row.
    if (olderHistoryAnchor.ownsCorrection(datasetKeyRef.current)) return;
    const value = metrics.current;
    if (!shouldRecoverTranscriptViewport(gesture.active, value.offset, value.contentHeight, value.viewportHeight)) return;
    diagnostics.current.record('off-content', { ...diagnosticFields(), reason: 'recovery' });
    reveal(current.current.recoveryRow, true, 'preserve');
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
    followTail.current = true; gesture.retire(); pendingDatasetReset.current = true; visible.current = null; hasMountedVisibleCells.current = false; mountedCellProof.current = null; olderHistoryAnchor.cancel();
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
    if (tailScrollFrame.current !== null) frames.cancel(tailScrollFrame.current);
    if (indexedScrollFrame.current !== null) frames.cancel(indexedScrollFrame.current);
    if (revisionRevealFrame.current !== null) frames.cancel(revisionRevealFrame.current);
    if (reviewRestoreFrame.current !== null) frames.cancel(reviewRestoreFrame.current);
    if (postLayoutFrame.current !== null) frames.cancel(postLayoutFrame.current);
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
    // A direct tail write owns only a plausible acknowledgement and is retired
    // after the first following native sample either way. Otherwise a missing
    // programmatic callback can mask a much later reader scroll when iPad also
    // omits begin-drag.
    if (expectedTailOffset !== null) unsettledTailOffset.current = null;
    const issuedReveal = unsettledIndexedReveal.current;
    const indexedWriterAcknowledged = !!issuedReveal
      && issuedReveal.datasetKey === datasetKeyRef.current
      && transcriptIndexedRevealAcknowledged(issuedReveal.offset, contentOffset.y);
    if (indexedWriterAcknowledged) {
      acknowledgedIndexedReveal.current = issuedReveal;
      unsettledIndexedReveal.current = null;
    }
    const restore = pendingReviewRestore.current;
    const latestIndexedReveal = issuedReveal ?? acknowledgedIndexedReveal.current;
    if (restore && latestIndexedReveal?.datasetKey === restore.datasetKey
      && !transcriptIndexedRevealAcknowledged(latestIndexedReveal.offset, contentOffset.y)) {
      // UIKit can omit begin-drag after a thread-entry restore. Defer claiming
      // the move until viewability proves that the restored target actually
      // left the viewport; a small recycler correction keeps restore authority.
      pendingUnownedReviewMove.current = { datasetKey: restore.datasetKey, target: restore.target };
    } else if (indexedWriterAcknowledged) pendingUnownedReviewMove.current = null;
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
    scheduleReviewRestoreVerification();
  }, [cancelTailWriter, recoverIfOffContent, scheduleReviewRestoreVerification, scrollToEnd, setTailFollow]);

  const onContentSizeChange = useCallback((_width: number, height: number) => {
    if (Math.abs(metrics.current.contentHeight - height) > 0.5) {
      // A new measured content generation invalidates the last React mirror.
      observedScroll.current = false;
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
    if (followTail.current) scrollToEnd(); schedulePostLayoutFrame(true);
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
    const readerMove = pendingUnownedReviewMove.current;
    // A transient empty recycler report does not prove that the reader moved
    // away. Retain restore authority until a real range excludes its target.
    if (indices.length > 0 && readerMove?.datasetKey === datasetKeyRef.current && !indices.includes(readerMove.target)) {
      reviewIntent.current?.(datasetKeyRef.current);
      // A delivered restore may keep verifying for measured-layout changes.
      // Once an unowned native move places its target offscreen, reader intent
      // supersedes that verifier exactly as an explicit begin-drag would.
      blankRecovery.cancel();
      cancelTailWriter('drag');
      cancelIndexedWriter('drag');
      cancelRevisionReveal('drag');
      cancelPostLayoutFrame('drag');
      pendingDatasetReset.current = false;
      setTailFollow(false, 'drag');
      diagnostics.current.record('writer', { ...diagnosticFields(), target: readerMove.target, action: 'cancel-revision-reveal', reason: 'drag' }, true);
    }
    visible.current = indices.length ? { first: Math.min(...indices), last: Math.max(...indices) } : null;
    mountedCellProof.current = nextTranscriptMountedCellProof(indices, mountedCellProof.current,
      revisionRef.current, metrics.current);
    hasMountedVisibleCells.current = mountedCellProof.current !== null;
    const tailRangeIncomplete = shouldRestoreTranscriptTailRange(followTail.current, gesture.active, current.current.itemCount, visible.current);
    if (hasMountedVisibleCells.current && !tailRangeIncomplete) blankRecovery.settledVisible(); else scheduleBlankRecovery();
    diagnostics.current.record('visible', { ...diagnosticFields(), first: visible.current?.first ?? null, last: visible.current?.last ?? null, mounted: hasMountedVisibleCells.current, reason: 'geometry' });
    scheduleReviewRestoreVerification();
  }).current;

  const captureReviewAnchor = useCallback((preference: 'cursor' | 'start' = 'cursor') => followTail.current ? null
    : captureTranscriptReviewAnchor(list.current, current.current.itemCount, current.current.recoveryRow, viewPositionForRow, preference), [viewPositionForRow]);
  const nativeCallbacks = useTranscriptNativeCallbacks<T>(datasetKey, { onScroll, onScrollBeginDrag, onScrollEndDrag, onMomentumScrollBegin, onMomentumScrollEnd, onContentSizeChange, onLayout, onViewableItemsChanged });
  return { list, ...nativeCallbacks, reveal, revealAfterRevision, revealRegion, cancelRegionReveal, captureRegionPosition, viewPositionForRow, holdReviewAnchor, captureReviewAnchor,
    captureOlderHistoryAnchor: olderHistoryAnchor.captureFromViewport, retireUnchangedOlderHistoryAnchor: olderHistoryAnchor.retireUnchanged,
    onOlderHistoryLayoutCommit: olderHistoryAnchor.correct };
}
