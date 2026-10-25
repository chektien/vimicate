import type { GatewaySessionGeneration } from './registrySessionIdentity';
import type { LatestHistoryActionsContext } from './latestHistoryLoading';
import { loadVisibleNewerHistoryBatch, type NewerHistoryScan } from './loadVisibleNewerHistoryBatch';
import { newerHistoryWindow } from './newerHistoryWindow';
import type { OlderHistoryVisibleContext } from './olderHistoryVisibleRows';
import { canPageOlder } from './sessionHistoryView';
import type { OlderHistoryLoadResult } from './historyPublicationReceipt';

type Context = LatestHistoryActionsContext & {
  sessionGeneration: { current: GatewaySessionGeneration | null };
  setCanLoadNewer: (value: boolean) => void;
  loadHistory: (sessionKey: string) => unknown;
  receiptAfterCommit: (owns: () => boolean) => { publication: Promise<OlderHistoryLoadResult> };
};

/** Forward review work shares the history owner's authority and request lock. */
export function createNewerHistoryAction(context: Context) {
  let scan: { sessionKey: string; selectionRevision: number; value: NewerHistoryScan } | null = null;
  return async (visibleContext: OlderHistoryVisibleContext = {}) => {
    const { client, selectedRef, publicationAuthority, olderRequest, windowMode,
      historySelectionRevision, latestRequestRevision, historyCache } = context;
    const sessionKey = selectedRef.current;
    if (!sessionKey || client.status !== 'connected' || !publicationAuthority.current?.isActive
      || windowMode.current !== 'older' || olderRequest.current.isActive()) return;
    const selectionRevision = historySelectionRevision.current;
    const requestRevision = ++latestRequestRevision.current;
    const activityRevision = publicationAuthority.current.capture();
    const request = olderRequest.current.begin(sessionKey, requestRevision); if (!request) return;
    const ownsRequest = () => Boolean(publicationAuthority.current?.owns(activityRevision))
      && olderRequest.current.owns(request, selectedRef.current, latestRequestRevision.current);
    const ownsPublication = () => Boolean(publicationAuthority.current?.owns(activityRevision))
      && selectedRef.current === sessionKey && windowMode.current === 'older'
      && historySelectionRevision.current === selectionRevision;
    context.setLoadingOlder(true);
    context.setHistoryProblem('');
    context.historyFailure.current = null;
    try {
      const visible = historyCache.current.restore(sessionKey) ?? [];
      const batch = await loadVisibleNewerHistoryBatch({ client, sessionKey, path: context.workspacePath.current,
        visible, generation: context.sessionGeneration.current, cursor: context.cursor.current, archive: context.archive.current, context: visibleContext,
        scan: scan?.sessionKey === sessionKey && scan.selectionRevision === selectionRevision ? scan.value : null,
        owns: ownsRequest });
      if (!ownsRequest()) return;
      scan = batch.scan ? { sessionKey, selectionRevision, value: batch.scan } : null;
      if (!batch.rewind) {
        context.onDetail('checking the next newer history interval · j again to continue');
        return;
      }
      context.cursor.current = batch.rewind.cursor;
      context.archive.current = batch.rewind.archive;
      // Keep an overlapping suffix around the reader, then add consecutive
      // newer history. Explicit G remains the only action that jumps the gap.
      const next = newerHistoryWindow(visible, batch.newer, sessionKey, visibleContext.retainedBoundaryMessageID);
      context.setHistoryMessages(sessionKey, next, 'older', ownsPublication);
      context.setCanLoadOlder(canPageOlder(context.cursor.current, context.archive.current));
      // Reaching current history is still review intent. Hidden live content
      // remains isolated and tail-following is never enabled by this action.
      context.setCanLoadNewer(!batch.reachedLatest || batch.newer.some(row => !next.some(retained => retained.id === row.id)));
      return context.receiptAfterCommit(ownsPublication);
    } catch (error) {
      if (!ownsRequest()) return;
      const problem = error instanceof Error ? error.message : 'newer history failed';
      context.setHistoryProblem(problem);
      context.onDetail(problem);
    } finally {
      if (olderRequest.current.finish(request)) {
        context.setLoadingOlder(false);
        const deferred = context.deferredLatestRefresh.current.consume(selectedRef.current);
        if (deferred) void context.loadHistory(deferred);
      }
    }
  };
}
