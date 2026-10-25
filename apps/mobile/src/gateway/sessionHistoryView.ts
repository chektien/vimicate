import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { BoundedSessionCache } from '../workspace/boundedSessionCache';
import { sameArchiveIdentity, type ArchivedHistoryState } from './archivedHistory';
import type { HistoryCursor } from './historyPagination';
import { sameSessionGeneration, type GatewaySessionGeneration } from './registrySessionIdentity';

export type HistoryWindowMode = 'latest' | 'older';
export type HistoryFailure = HistoryWindowMode | null;
export type ThreadEntryHistoryPresentation = 'preserve-review' | 'reveal-current';
export type ReviewEntryIntent = 'deliberate' | 'fallback' | null;

export type SessionHistoryView = {
  generation: GatewaySessionGeneration | null;
  archive: ArchivedHistoryState | null;
  cursor: HistoryCursor | null;
  windowMode: HistoryWindowMode;
  reviewEntryIntent: ReviewEntryIntent;
  historyFailure: HistoryFailure;
  historyProblem: string;
};

export type RestoredHistorySelection = SessionHistoryView & {
  messages: WorkspaceMessage[];
  canLoadOlder: boolean;
};

/**
 * Review position is session-local UI state, not part of the latest live tail.
 * Keeping it beside the stable project key prevents a project round-trip from
 * silently replacing mounted archived rows with an empty successor session.
 */
export class SessionHistoryViewCache {
  private readonly values: BoundedSessionCache<SessionHistoryView>;

  constructor(sessionLimit = 64) {
    this.values = new BoundedSessionCache(sessionLimit);
  }

  store(sessionKey: string, view: SessionHistoryView) {
    this.values.store(sessionKey, view);
  }

  restore(sessionKey: string) {
    return this.values.restore(sessionKey);
  }
}

export function restoredHistorySelection(
  cached: SessionHistoryView | undefined,
  generation: GatewaySessionGeneration | null,
  initialArchive: ArchivedHistoryState | null,
  reviewMessages: WorkspaceMessage[],
  latestMessages: WorkspaceMessage[],
): RestoredHistorySelection {
  const validReview = cached?.windowMode === 'older'
    && sameSessionGeneration(cached.generation, generation)
    && sameArchiveIdentity(cached.archive, initialArchive)
    && (reviewMessages.length > 0 || cached.historyFailure === 'older');

  if (cached && validReview) {
    return {
      ...cached,
      messages: reviewMessages,
      canLoadOlder: canPageOlder(cached.cursor, cached.archive),
    };
  }

  return {
    generation,
    archive: initialArchive,
    cursor: null,
    windowMode: 'latest',
    reviewEntryIntent: null,
    historyFailure: null,
    historyProblem: '',
    messages: latestMessages,
    canLoadOlder: canPageOlder(null, initialArchive),
  };
}

/**
 * Durable review restoration is a fallback for a session whose current
 * generation has no visible tail. It must not win a race against a current
 * SQLite publication that arrived while the review cache was being read.
 */
export function restoredPersistedHistorySelection(
  cached: SessionHistoryView | undefined,
  generation: GatewaySessionGeneration | null,
  initialArchive: ArchivedHistoryState | null,
  reviewMessages: WorkspaceMessage[],
  latestMessages: WorkspaceMessage[],
) {
  if (latestMessages.length) return null;
  const restored = restoredHistorySelection(cached, generation, initialArchive, reviewMessages, latestMessages);
  return restored.windowMode === 'older' ? restored : null;
}

/**
 * A project round trip restores an intentional in-process review and must not
 * turn selection into an implicit bare G. A first entry has no cached review
 * yet, so its current-history request may displace a delayed durable fallback.
 */
export function threadEntryHistoryPresentation(restored: RestoredHistorySelection): ThreadEntryHistoryPresentation {
  return restored.windowMode === 'older' && restored.reviewEntryIntent === 'deliberate'
    ? 'preserve-review'
    : 'reveal-current';
}

/**
 * Bare G means "return to the newest available row". When the current
 * OpenClaw generation is legitimately empty, the newest available row is the
 * tail of the mounted archived review; publishing [] would strand the pane.
 */
export function returnToLatestHistory(
  currentMode: HistoryWindowMode,
  publishedLatest: WorkspaceMessage[],
  mountedReview: WorkspaceMessage[],
) {
  if (currentMode === 'older' && publishedLatest.length === 0 && mountedReview.length > 0) {
    return { windowMode: 'older' as const, messages: mountedReview };
  }
  return { windowMode: 'latest' as const, messages: publishedLatest };
}

export function canPageOlder(cursor: HistoryCursor | null, archive: ArchivedHistoryState | null) {
  return Boolean(cursor?.hasMore || (archive && !archive.exhausted && !archive.blocked));
}
