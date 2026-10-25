import { useCallback, useLayoutEffect, useRef, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from 'react';
import { BoundedSessionCache } from '../workspace/boundedSessionCache';
import { newConversationTailMessageID, SessionTranscriptNavigationCache } from './sessionTranscriptNavigation';
import { createTranscriptVimState, projectTranscriptVimState, reconcileTranscriptVimState, type TranscriptBuffer, type TranscriptVimState } from './transcriptVim';
import type { TranscriptPaneHandle } from './TranscriptPane';
import { captureSessionTranscriptViewportPosition, resolveSessionTranscriptViewportPosition, type SessionTranscriptViewportPosition } from './sessionTranscriptViewportPosition';

type TranscriptViewportHandoffKind = 'review-restore' | 'tail';
type TranscriptViewportHandoff = {
  sessionKey: string;
  buffer: TranscriptBuffer;
  navigation: TranscriptVimState;
  kind: TranscriptViewportHandoffKind;
  viewPosition: number | undefined;
  viewportAnchor: SessionTranscriptViewportPosition | undefined;
};

function handoffOwnsNavigation(request: TranscriptViewportHandoff, current: TranscriptVimState) {
  // A folded tail may project to another visible source row without changing
  // tail intent. Review requests, however, cannot outrank a newer user motion.
  return request.navigation === current || (request.kind === 'tail' && current.followTail);
}

type TailRevealAuthority = {
  cancel?: (sessionKey: string) => void;
  consumeIfAdvanced(
    sessionKey: string,
    previousLineCount: number,
    nextLineCount: number,
    replacementTailPublished?: boolean,
  ): boolean;
};

type Options = {
  sessionKey: string;
  buffer: TranscriptBuffer;
  navigationRef: MutableRefObject<TranscriptVimState>;
  setNavigation: Dispatch<SetStateAction<TranscriptVimState>>;
  viewportRef: RefObject<TranscriptPaneHandle | null>;
  tailReveal: TailRevealAuthority;
};

/** Own per-session cursor intent and the single viewport handoff on revision. */
export function useSessionTranscriptNavigation(options: Options) {
  const previousBuffer = useRef<TranscriptBuffer>({ lines: [], firstRowByMessage: [], lastRowByMessage: [] });
  const navigationCache = useRef(new SessionTranscriptNavigationCache());
  const viewPositionCache = useRef(new BoundedSessionCache<SessionTranscriptViewportPosition>());
  const previousSessionKey = useRef(options.sessionKey);
  const viewportHandoffFrame = useRef<number | null>(null);
  const pendingViewportHandoff = useRef<TranscriptViewportHandoff | null>(null);
  const onViewportReview = useCallback((sessionKey: string) => {
    // Touch review does not move the Vim cursor. It still supersedes a queued
    // session-return/revision request, just as a newer keyboard motion does.
    if (previousSessionKey.current !== sessionKey) return;
    options.tailReveal.cancel?.(sessionKey);
    options.setNavigation(current => current.followTail ? { ...current, followTail: false } : current);
    if (pendingViewportHandoff.current?.sessionKey !== sessionKey) return;
    if (viewportHandoffFrame.current !== null) cancelAnimationFrame(viewportHandoffFrame.current);
    viewportHandoffFrame.current = null;
    pendingViewportHandoff.current = null;
  }, [options.setNavigation, options.tailReveal]);
  const captureCurrentSession = useCallback(() => {
    const key = previousSessionKey.current;
    const buffer = previousBuffer.current;
    const navigation = options.navigationRef.current;
    navigationCache.current.store(key, buffer, navigation);
    const viewport = options.viewportRef.current;
    const review = viewport?.captureReviewPosition?.();
    const position = captureSessionTranscriptViewportPosition(buffer, review?.sourceRow ?? navigation.cursor.row,
      review?.viewPosition ?? viewport?.viewPositionForSourceRow(navigation.cursor.row), !!review);
    if (position) viewPositionCache.current.store(key, position);
    else viewPositionCache.current.delete(key);
  }, [options.navigationRef, options.viewportRef]);

  const scheduleOwnedViewportHandoff = useCallback((
    sessionKey: string,
    buffer: TranscriptBuffer,
    navigation: TranscriptVimState,
    kind: TranscriptViewportHandoffKind,
    viewPosition?: number,
    viewportAnchor?: SessionTranscriptViewportPosition,
  ) => {
    const sameSessionFrame = viewportHandoffFrame.current !== null && pendingViewportHandoff.current?.sessionKey === sessionKey;
    pendingViewportHandoff.current = { sessionKey, buffer, navigation, kind, viewPosition, viewportAnchor };
    // Keep an admitted handoff ahead of the list's queued geometry writers.
    // Cancel/requeue on every revision lets the old tail paint before review.
    if (sameSessionFrame) return;
    if (viewportHandoffFrame.current !== null) cancelAnimationFrame(viewportHandoffFrame.current);
    const frame = requestAnimationFrame(() => {
      if (viewportHandoffFrame.current !== frame) return;
      const request = pendingViewportHandoff.current;
      viewportHandoffFrame.current = null;
      pendingViewportHandoff.current = null;
      if (!request) return;
      const { sessionKey, buffer, navigation, kind, viewPosition, viewportAnchor } = request;
      if (previousSessionKey.current !== sessionKey || previousBuffer.current !== buffer) return;
      if (!handoffOwnsNavigation(request, options.navigationRef.current)) return;
      const viewport = options.viewportRef.current;
      if (!viewport) return;
      if (kind === 'tail') {
        viewport.reveal(buffer.lines.length - 1, true, 'tail');
      } else if (kind === 'review-restore') {
        const row = viewportAnchor ? resolveSessionTranscriptViewportPosition(buffer, viewportAnchor) : navigation.cursor.row;
        if (row !== null) viewport.revealAfterRevision(row, viewPosition ?? 0.45);
      }
    });
    viewportHandoffFrame.current = frame;
  }, [options.navigationRef, options.viewportRef]);

  useLayoutEffect(() => () => {
    if (viewportHandoffFrame.current !== null) cancelAnimationFrame(viewportHandoffFrame.current);
    viewportHandoffFrame.current = null;
    pendingViewportHandoff.current = null;
  }, []);

  useLayoutEffect(() => {
    const previous = previousBuffer.current;
    // Child layout effects have committed the pane's visible coordinates. A
    // revision must publish one projected result, never a hidden tail which
    // the pane would immediately project back during React lane replay.
    const navigationRows = options.viewportRef.current?.navigationSourceRows?.();
    if (previousSessionKey.current !== options.sessionKey) {
      navigationCache.current.store(previousSessionKey.current, previous, options.navigationRef.current);
      const cached = navigationCache.current.restore(options.sessionKey, options.buffer) ?? createTranscriptVimState(options.buffer);
      const restored = navigationRows ? projectTranscriptVimState(cached, options.buffer, navigationRows) : cached;
      previousSessionKey.current = options.sessionKey;
      previousBuffer.current = options.buffer;
      options.setNavigation(restored);
      // The child transcript viewport resets its native dataset in this same
      // layout commit. Restore on the next frame so that reset cannot cancel
      // or overwrite the session-owned source-row handoff.
      const saved = viewPositionCache.current.restore(options.sessionKey);
      const anchor = saved?.viewportOwned && resolveSessionTranscriptViewportPosition(options.buffer, saved) !== null ? saved : undefined;
      scheduleOwnedViewportHandoff(options.sessionKey, options.buffer, restored, anchor || !restored.followTail ? 'review-restore' : 'tail', saved?.viewPosition ?? 0.45, anchor);
      return;
    }

    const previousResetTail = newConversationTailMessageID(previous);
    const nextResetTail = newConversationTailMessageID(options.buffer);
    const replacementTailPublished = Boolean(nextResetTail && nextResetTail !== previousResetTail);
    if (options.tailReveal.consumeIfAdvanced(
      options.sessionKey,
      previous.lines.length,
      options.buffer.lines.length,
      replacementTailPublished,
    )) {
      const tail = createTranscriptVimState(options.buffer);
      const next = navigationRows ? projectTranscriptVimState(tail, options.buffer, navigationRows) : tail;
      options.setNavigation(next);
      scheduleOwnedViewportHandoff(options.sessionKey, options.buffer, next, 'tail');
    } else {
      const current = options.navigationRef.current;
      const next = reconcileTranscriptVimState(current, previous, options.buffer, navigationRows);
      const pending = pendingViewportHandoff.current;
      if (next !== current) options.setNavigation(next);
      // In-place publications keep the native visible-key anchor. Only an
      // already-owned session return may rebase an explicit restore here.
      if (pending && pending.sessionKey === options.sessionKey && pending.buffer === previous
        && handoffOwnsNavigation(pending, current)) {
        // Rebase still-owned work onto this committed revision. Rejecting the
        // stale buffer at execution is necessary, but silently dropping the
        // only return/restore request loses the session's viewport intent.
        scheduleOwnedViewportHandoff(options.sessionKey, options.buffer, next, pending.kind, pending.viewPosition, pending.viewportAnchor);
      }
    }
    previousBuffer.current = options.buffer;
  }, [options.buffer, options.navigationRef, options.sessionKey, options.setNavigation, options.tailReveal, options.viewportRef, scheduleOwnedViewportHandoff]);
  const jumpToLatest = useCallback(() => {
    options.setNavigation(createTranscriptVimState(previousBuffer.current));
    options.viewportRef.current?.reveal(Number.MAX_SAFE_INTEGER, true, 'tail');
  }, [options.setNavigation, options.viewportRef]);
  return { captureCurrentSession, onViewportReview, jumpToLatest };
}
