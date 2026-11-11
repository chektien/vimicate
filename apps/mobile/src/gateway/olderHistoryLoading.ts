import { reconcileHistoryCursor } from './historyTransport';
import { archivedFamilyAuthorityInvalidated } from './archivedHistory';
import { loadVisibleOlderHistoryBatch } from './loadVisibleOlderHistoryBatch';
import { OLDER_REVIEW_COST_LIMIT, type OlderHistoryVisibleContext } from './olderHistoryVisibleRows';
import { olderPageHistoryPublication } from './historyReviewPublication';
import type { LatestHistoryActionsContext } from './latestHistoryLoading';
import type { OlderHistoryLoadResult } from './historyPublicationReceipt';
import type { SharedNarrationHydration } from './sharedNarrationHydration';
import type { SharedNarrationState } from './sharedNarration';

type Context = LatestHistoryActionsContext & {
  receiptAfterCommit: (owns: () => boolean) => { publication: Promise<OlderHistoryLoadResult> };
  setCanLoadNewer: (value: boolean) => void;
  narrationHydration: { current: SharedNarrationHydration };
  sharedNarration: { current: SharedNarrationState | null };
  loadHistory: (sessionKey: string) => unknown;
};

/** Bounded older action of the existing history owner, not another frontier. */
export function createOlderHistoryAction(owner: Context) {
  const { client, cursor, archive, selectedRef, publicationAuthority, olderRequest, windowMode,
    historySelectionRevision, latestRequestRevision, setLoadingOlder, setHistoryProblem,
    historyFailure, setCanLoadNewer, reviewEntryIntent, workspacePath, historyCache,
    narrationHydration, sharedNarration, setHistoryMessages, latestTailCache, onDetail,
    setCanLoadOlder, receiptAfterCommit, archiveRecovery, clearPersistedHistoryReview,
    deferredLatestRefresh, loadHistory, persistHistoryReview, projectionContext } = owner;
  return async (context: OlderHistoryVisibleContext = {}) => {
    const sessionKey = selectedRef.current;
    if (!sessionKey || client.status !== 'connected' || !publicationAuthority.current?.isActive || olderRequest.current.isActive()) return;
    const current = reconcileHistoryCursor(cursor.current, historyCache.current.restore(sessionKey) ?? [], sessionKey);
    cursor.current = current;
    const currentOffset = current?.nextOffset ?? null;
    const hasCurrentPage = Boolean(current?.hasMore && currentOffset !== null && current.sessionKey === sessionKey);
    if (!hasCurrentPage && (!archive.current || archive.current.exhausted || archive.current.identity.sessionKey !== sessionKey)) return;
    const selectionRevision = windowMode.current === 'older'
      ? historySelectionRevision.current : ++historySelectionRevision.current;
    const requestRevision = ++latestRequestRevision.current;
    const activityRevision = publicationAuthority.current.capture();
    const request = olderRequest.current.begin(sessionKey, requestRevision); if (!request) return;
    const ownsRequest = () => Boolean(publicationAuthority.current?.owns(activityRevision))
      && olderRequest.current.owns(request, selectedRef.current, latestRequestRevision.current);
    // Accepted pages belong to this review, not the next transport request.
    // A deferred live refresh or another page may start before React commits
    // this updater. Neither can revoke rows whose cursor already advanced.
    // Explicit selection, submission, generation and scene changes still retire it.
    const ownsPublication = () => Boolean(publicationAuthority.current?.owns(activityRevision))
      && selectedRef.current === sessionKey && windowMode.current === 'older'
      && selectionRevision === historySelectionRevision.current;
    setLoadingOlder(true);
    setHistoryProblem('');
    historyFailure.current = null;
    if (archive.current?.blocked) {
      const { blocked: _blocked, ...retryableArchive } = archive.current;
      archive.current = retryableArchive;
    }
    windowMode.current = 'older';
    setCanLoadNewer(true);
    reviewEntryIntent.current = 'deliberate';
    let recoverLatest = false;
    try {
      const batch = await loadVisibleOlderHistoryBatch({ client, sessionKey,
        path: workspacePath.current, visible: historyCache.current.restore(sessionKey) ?? [],
        narration: narrationHydration.current.cache(sharedNarration.current), cursor: cursor.current,
        archive: archive.current, context, projectionContext, owns: ownsRequest });
      if (!ownsRequest()) return;
      if (batch.problem && archivedFamilyAuthorityInvalidated(batch.problem)) throw batch.problem;
      archive.current = batch.archive;
      if (batch.older.length) {
        setHistoryMessages(sessionKey, (rows) => olderPageHistoryPublication(
          rows,
          latestTailCache.current.restore(sessionKey) ?? [],
          batch.older,
          sessionKey,
          narrationHydration.current.cache(sharedNarration.current),
          true,
          OLDER_REVIEW_COST_LIMIT,
        ).visible, 'older', ownsPublication, batch.cursor);
      }
      if (!batch.older.length) { cursor.current = batch.cursor; persistHistoryReview(sessionKey, historyCache.current.restore(sessionKey) ?? []); }
      if (batch.problem) {
        const problem = batch.problem instanceof Error ? batch.problem.message : 'older history failed';
        historyFailure.current = 'older';
        if (!cursor.current?.hasMore && archive.current) archive.current = { ...archive.current, blocked: problem };
        setHistoryProblem(problem);
        onDetail(problem);
      } else if (!hasCurrentPage) onDetail(batch.older.length
        ? `loaded ${batch.older.length} older archived transcript rows` : 'archived history exhausted');
      setCanLoadOlder(Boolean(batch.cursor?.hasMore || (archive.current && !archive.current.exhausted && !archive.current.blocked)));
      if (!batch.older.length) return { publication: Promise.resolve({ committed: true, published: false, addedMessageCount: 0,
        mutation: batch.outcome === 'budget' || batch.outcome === 'scan' ? 'scan' as const : 'unchanged' as const }) };
      const receipt = receiptAfterCommit(ownsPublication);
      return { publication: receipt.publication.then(result => ({
        ...result, ...(batch.problem ? { mutation: 'partial' as const } : !result.published && batch.outcome === 'overlap' ? { mutation: 'scan' as const } : {}),
        ...(batch.outcome === 'budget' ? { continuation: 'budget' as const } : {}), addedVisibleRowCount: result.published ? batch.addedVisibleRowCount : 0,
      })) };
    } catch (error) {
      if (!ownsRequest()) return;
      if (archive.current && archivedFamilyAuthorityInvalidated(error)) {
        // `/new` can make the stable route's previous archive family obsolete
        // before the sessions/registry subscription publishes its successor.
        // This is an authority transition, not a retryable page error. Do not
        // persist the pane in failed older mode: retain the mounted rows until
        // canonical latest history atomically replaces them.
        cursor.current = null;
        archive.current = null;
        historyFailure.current = null;
        archiveRecovery.current.request(sessionKey);
        reviewEntryIntent.current = null;
        setCanLoadOlder(false);
        setHistoryProblem('');
        clearPersistedHistoryReview(sessionKey);
        onDetail('session generation changed; restoring latest transcript');
        recoverLatest = true;
        return;
      }
      const problem = error instanceof Error ? error.message : 'older history failed';
      historyFailure.current = 'older';
      if (!hasCurrentPage && archive.current) archive.current = { ...archive.current, blocked: problem };
      setCanLoadOlder(Boolean(cursor.current?.hasMore));
      setHistoryProblem(problem);
      persistHistoryReview(sessionKey, historyCache.current.restore(sessionKey) ?? []);
      onDetail(problem);
    } finally {
      if (olderRequest.current.finish(request)) {
        setLoadingOlder(false);
        const deferredSession = deferredLatestRefresh.current.consume(selectedRef.current);
        if (deferredSession) void loadHistory(deferredSession);
        else if (recoverLatest && selectedRef.current === sessionKey) void loadHistory(sessionKey);
      }
    }
  };
}
