import { retainedNativeHistoryWindow, type NativeHistoryFloor } from './latestHistoryContinuity';
import { transcriptPublicationIdentity } from './transcriptIdentityWall';
import { sharedNarrationWindowCache } from './sharedNarrationWindow';
import { mergeSharedNarration } from './sharedNarration';
import { mergeOlderHistory } from './historyPagination';
import type { SetStateAction } from 'react';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { latestHistoryWindow, latestPresentationWindow, olderHistoryWindow } from './historyWindow';
import { sessionOwnsVisiblePublication } from './sessionPublicationOwnership';
import type { PendingInputSnapshotReconciliation } from './pendingInputSnapshot';

/**
 * Network/request ownership can retire after a history result queues its React
 * state updater but before React applies it. Re-check both the request and the
 * mounted dataset at application time; a stable route reused by `/new` is not
 * sufficient authority for a predecessor page to enter the successor view.
 */
export function authorizedHistoryStatePublication(
  publicationSessionKey: string,
  selectedSessionKey: string,
  activeSessionKey: string,
  ownsPublication: () => boolean,
  current: WorkspaceMessage[],
  action: SetStateAction<WorkspaceMessage[]>,
) {
  if (!ownsPublication() || !sessionOwnsVisiblePublication(
    publicationSessionKey,
    selectedSessionKey,
    activeSessionKey,
  )) return { owned: false, messages: current };
  return {
    owned: true,
    messages: typeof action === 'function' ? action(current) : action,
  };
}

export type HistoryReviewPublication = {
  visible: WorkspaceMessage[];
  latest: WorkspaceMessage[];
};

export type SessionMessagePublicationIntent = 'live' | 'message-recovery' | 'optimistic-prompt';

export type PromptSubmissionHistoryPublication = HistoryReviewPublication & {
  windowMode: 'latest';
  changed: boolean;
};

export type ParkedSessionHistoryPublication = HistoryReviewPublication & {
  replaceVisible: boolean;
};

export function latestSessionPublication(current: WorkspaceMessage[], action: SetStateAction<WorkspaceMessage[]>) {
  const proposed = typeof action === 'function' ? action(current) : action;
  return latestPresentationWindow(proposed);
}

/**
 * React may already hold a queued live updater when an async canonical refresh
 * completes. Re-read the synchronous per-session tail when this action is
 * actually applied; capturing an absolute array at network completion lets a
 * later queued refresh erase the live row that ran immediately before it.
 */
export function latestHistoryRefreshAction(
  latest: WorkspaceMessage[],
  sessionKey: string,
  authoritativeTail: () => WorkspaceMessage[] | undefined,
  pendingInputs?: PendingInputSnapshotReconciliation,
  nativeHistoryFloor?: NativeHistoryFloor,
): (current: WorkspaceMessage[]) => WorkspaceMessage[] {
  return (current) => {
    const retained = retainedNativeHistoryWindow(authoritativeTail() ?? current, sessionKey, nativeHistoryFloor);
    return latestHistoryWindow(latest, sharedNarrationWindowCache(retained, latest), sessionKey, undefined, pendingInputs);
  };
}

export function externalHistoryPublication(mode: 'latest' | 'older', visible: WorkspaceMessage[], latest: WorkspaceMessage[], action: SetStateAction<WorkspaceMessage[]>, intent: SessionMessagePublicationIntent = 'live'): HistoryReviewPublication {
  const owner = mode === 'older' ? latest : visible;
  const bounded = latestSessionPublication(owner, action);
  // Explicit row repair belongs to the review as well as any matching tail
  // row. Do not re-window that review or append live content into it.
  if (mode === 'older' && intent === 'message-recovery') return {
    visible: typeof action === 'function' ? action(visible) : action,
    latest: bounded,
  };
  return mode === 'older'
    ? { visible, latest: bounded }
    : { visible: bounded, latest: bounded };
}

/**
 * A parked running session may keep receiving live rows. Its mounted older
 * review and hidden live tail are separate authorities: only a tail-owned
 * session may replace the visible cache while it is off-screen.
 */
export function parkedSessionHistoryPublication(mode: 'latest' | 'older', visible: WorkspaceMessage[], latest: WorkspaceMessage[], action: SetStateAction<WorkspaceMessage[]>, intent: SessionMessagePublicationIntent = 'live'): ParkedSessionHistoryPublication {
  return { ...externalHistoryPublication(mode, visible, latest, action, intent), replaceVisible: mode === 'latest' || intent === 'message-recovery' };
}

/** Older pagination may replace the bounded review edge, never the live tail. */
export function olderPageHistoryPublication(visible: WorkspaceMessage[], latest: WorkspaceMessage[], older: WorkspaceMessage[], sessionKey: string, narration: WorkspaceMessage[] = [], retainBoundary = false, limit?: number): HistoryReviewPublication {
  const merged = mergeSharedNarration(mergeOlderHistory(older, visible, sessionKey), narration);
  const boundary = retainBoundary ? visible.find(row => merged.some(next => next.id === row.id))?.id : undefined;
  return {
    visible: olderHistoryWindow([], merged, sessionKey, limit, boundary),
    latest,
  };
}

/** Sending explicitly leaves archived review and makes the live tail visible. */
export function promptSubmissionHistoryPublication(mode: 'latest' | 'older', visible: WorkspaceMessage[], latest: WorkspaceMessage[]): PromptSubmissionHistoryPublication {
  const mounted = mode === 'older' ? latest : visible;
  return { windowMode: 'latest', visible: mounted, latest: mounted, changed: mode === 'older' };
}

/** The current tail is separate from the bounded review; unread state cannot describe this gap. */
export function reviewOmitsLatestMessages(mode: 'latest' | 'older', visible: WorkspaceMessage[], latest: WorkspaceMessage[]) {
  if (mode !== 'older') return false;
  const last = latest.findLast(message => message.role !== 'run');
  if (!last) return false;
  const identity = transcriptPublicationIdentity(last);
  return !visible.some(message => message.sessionKey === last.sessionKey
    && transcriptPublicationIdentity(message) === identity);
}
