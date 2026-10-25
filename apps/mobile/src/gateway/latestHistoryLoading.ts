import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import type { OpenClawClient } from './OpenClawClient';
import type { ArchivedHistoryState } from './archivedHistory';
import { refreshedHistoryCursor, type HistoryCursor } from './historyPagination';
import type { HistoryPublicationAuthority } from './historyPublicationAuthority';
import type { HistoryArchiveRecovery } from './historyArchiveRecovery';
import type { HistoryRefreshDeferral } from './historyRefreshDeferral';
import type { OlderHistoryRequestAuthority } from './historyRequestAuthority';
import type { SessionHistoryCache } from './sessionHistoryCache';
import { canPageOlder, returnToLatestHistory, type HistoryFailure, type HistoryWindowMode, type ReviewEntryIntent, type ThreadEntryHistoryPresentation } from './sessionHistoryView';
import { latestHistoryRefreshAction } from './historyReviewPublication';
import { presentationBoundedLatestHistory } from './presentationBoundedLatestHistory';
import { pendingInputCustodyCandidates } from './pendingInputSnapshot';
import { completedNativeHistoryContinuity } from './latestHistoryContinuity';

type Cell<T> = { current: T };
type MessageAction = WorkspaceMessage[] | ((current: WorkspaceMessage[]) => WorkspaceMessage[]);
/** Dependencies reference the existing history owner; no independent state or timers. */
export type LatestHistoryActionsContext = {
  client: OpenClawClient;
  selectedRef: Cell<string>;
  publicationAuthority: Cell<HistoryPublicationAuthority | null>;
  latestRequestRevision: Cell<number>;
  historySelectionRevision: Cell<number>;
  windowMode: Cell<HistoryWindowMode>;
  reviewEntryIntent: Cell<ReviewEntryIntent>;
  historyFailure: Cell<HistoryFailure>;
  cursor: Cell<HistoryCursor | null>;
  archive: Cell<ArchivedHistoryState | null>;
  workspacePath: Cell<string>;
  olderRequest: Cell<OlderHistoryRequestAuthority>;
  deferredLatestRefresh: Cell<HistoryRefreshDeferral>;
  archiveRecovery: Cell<HistoryArchiveRecovery>;
  latestTailCache: Cell<SessionHistoryCache>;
  historyCache: Cell<SessionHistoryCache>;
  hydrateSharedNarration: (sessionKey: string, isCurrent: () => boolean) => Promise<WorkspaceMessage[] | null>;
  setHistoryMessages: (sessionKey: string, action: MessageAction, side: HistoryWindowMode, ownsPublication: () => boolean) => void;
  setHistoryProblem: (problem: string) => void;
  setLoadingOlder: (loading: boolean) => void;
  setCanLoadOlder: (canLoad: boolean) => void;
  onDetail: (detail: string) => void;
  persistLater: (sessionKey: string, messages: WorkspaceMessage[]) => void;
  persistHistoryReview: (sessionKey: string, messages: WorkspaceMessage[]) => void;
  clearPersistedHistoryReview: (sessionKey: string) => void;
};

export function createLatestHistoryActions(context: LatestHistoryActionsContext) {
  const {
    client,
    selectedRef,
    publicationAuthority,
    latestRequestRevision,
    historySelectionRevision,
    windowMode,
    reviewEntryIntent,
    historyFailure,
    cursor,
    archive,
    workspacePath,
    olderRequest,
    deferredLatestRefresh,
    archiveRecovery,
    latestTailCache,
    historyCache,
    hydrateSharedNarration,
    setHistoryMessages,
    setHistoryProblem,
    setLoadingOlder,
    setCanLoadOlder,
    onDetail,
    persistLater,
    persistHistoryReview,
    clearPersistedHistoryReview,
  } = context;

  // Every owner that refreshes a session's latest history wants the same
  // publication. Recovery pollers, the run monitor and the live-event refresh
  // each used to issue their own Gateway history and narration request, and
  // revision supersession then discarded all but the newest: N concurrent
  // callers cost N request sets and N-1 of them resolved to nothing, so a
  // caller that polls until it sees a final never saw one. A caller that does
  // not change the presentation now joins the request already in flight.
  const inFlightLatest = new Map<string, { request: Promise<WorkspaceMessage[] | undefined>; owns: () => boolean }>();

  function resetLatestPagination(latest: HistoryCursor) {
    cursor.current = latest;
    const previous = archive.current;
    if (previous) archive.current = { identity: previous.identity, ...(previous.workspacePath ? { workspacePath: previous.workspacePath } : {}), exhausted: false };
    setCanLoadOlder(canPageOlder(cursor.current, archive.current));
  }

  function loadHistory(sessionKey: string, presentation: ThreadEntryHistoryPresentation = 'preserve-review', requireFreshSnapshot = false): Promise<WorkspaceMessage[] | undefined> {
    const joined = presentation === 'preserve-review' ? inFlightLatest.get(sessionKey) : undefined;
    // A remote input can arrive after an existing request captured its snapshot.
    // Keep ordinary coalescing, but reread after that request for explicit input
    // or terminal authority. Its captured owner also cancels the queued reread.
    if (joined?.owns()) return requireFreshSnapshot
      ? joined.request.then(() => joined.owns() ? loadHistory(sessionKey) : undefined)
      : joined.request;
    const request = loadLatestHistory(sessionKey, presentation);
    // Census/read-ack refreshes may arrive during thread entry. They can join
    // its reveal request, but must not supersede it with preserve-review and
    // leave the old transcript mounted until a subsequent selection.
    const authority = publicationAuthority.current;
    const activityRevision = authority?.capture();
    const requestRevision = latestRequestRevision.current;
    const selectionRevision = historySelectionRevision.current;
    // Joining shares publication authority as well as data. A resumed scene,
    // re-entered thread or replacement request cannot use a retired promise.
    const owns = () => authority === publicationAuthority.current && activityRevision !== undefined
      && Boolean(authority?.owns(activityRevision)) && selectedRef.current === sessionKey
      && requestRevision === latestRequestRevision.current && selectionRevision === historySelectionRevision.current;
    inFlightLatest.set(sessionKey, { request, owns });
    const settle = () => { if (inFlightLatest.get(sessionKey)?.request === request) inFlightLatest.delete(sessionKey); };
    request.then(settle, settle);
    return request;
  }

  async function loadLatestHistory(sessionKey: string, presentation: ThreadEntryHistoryPresentation) {
    if (client.status !== 'connected' || !publicationAuthority.current?.isActive || selectedRef.current !== sessionKey) return;
    if (olderRequest.current.isActive()) {
      if (selectedRef.current === sessionKey) deferredLatestRefresh.current.request(sessionKey);
      return;
    }
    deferredLatestRefresh.current.retire();
    const requestRevision = ++latestRequestRevision.current;
    const activityRevision = publicationAuthority.current.capture();
    const selectionRevision = historySelectionRevision.current;
    const reviewingOlder = windowMode.current === 'older';
    const pendingCandidates = pendingInputCustodyCandidates(
      latestTailCache.current.restore(sessionKey) ?? historyCache.current.restore(sessionKey) ?? [],
      sessionKey,
    );
    if (!reviewingOlder) {
      setHistoryProblem('');
      historyFailure.current = null;
    }
    try {
      const ownsLatest = () => Boolean(publicationAuthority.current?.owns(activityRevision))
        && selectedRef.current === sessionKey && requestRevision === latestRequestRevision.current
        && selectionRevision === historySelectionRevision.current;
      // Both snapshots follow subscription admission: commentary written while
      // switching must be covered either by the snapshot or by live delivery.
      // A retired selection must not start another set of expensive reads.
      await client.followSession(sessionKey);
      if (!ownsLatest()) return;
      const [payload, narration] = await Promise.all([
        client.history(sessionKey, 80, 0),
        hydrateSharedNarration(sessionKey, ownsLatest),
      ]);
      if (!payload || !narration || !ownsLatest()) return;
      const bounded = await presentationBoundedLatestHistory(client, sessionKey, payload, workspacePath.current, ownsLatest, narration);
      if (!bounded) return;
      const retained = latestTailCache.current.restore(sessionKey) ?? historyCache.current.restore(sessionKey) ?? [];
      const completed = await completedNativeHistoryContinuity(client, sessionKey, bounded, retained, workspacePath.current, ownsLatest, presentation !== 'reveal-current');
      if (!completed) return;
      const latest = completed.cursor;
      cursor.current = completed.nativeHistoryFloor && windowMode.current === 'latest'
        ? latest : refreshedHistoryCursor(cursor.current, latest);
      setCanLoadOlder(Boolean(cursor.current.hasMore || (archive.current && !archive.current.exhausted && !archive.current.blocked)));
      const projected = completed.messages;
      const pendingInputs = completed.pendingInputSnapshot
        ? { snapshot: completed.pendingInputSnapshot, candidates: pendingCandidates }
        : undefined;
      if (windowMode.current !== 'latest') {
        const currentTail = latestTailCache.current.restore(sessionKey) ?? [];
        const publication = latestHistoryRefreshAction(
          projected,
          sessionKey,
          () => latestTailCache.current.restore(sessionKey),
          pendingInputs,
          completed.nativeHistoryFloor,
        );
        const published = publication(currentTail);
        latestTailCache.current.store(sessionKey, published);
        persistLater(sessionKey, published);
        const recoveringArchive = published.length > 0 && archiveRecovery.current.consume(sessionKey);
        if (published.length && (presentation === 'reveal-current' || recoveringArchive)) {
          // A thread-entry request reveals a nonempty current tail. An
          // archived-family authority rejection also makes the mounted review
          // obsolete. In either case this canonical latest publication is the
          // sole atomic writer that returns the pane to the live tail.
          resetLatestPagination(latest);
          windowMode.current = 'latest';
          reviewEntryIntent.current = null;
          historyFailure.current = completed.lookbackProblem ? 'latest' : null;
          setHistoryProblem(completed.lookbackProblem);
          setHistoryMessages(sessionKey, publication, 'latest', ownsLatest);
          clearPersistedHistoryReview(sessionKey);
          if (recoveringArchive) setCanLoadOlder(false);
          return published;
        }
        return projected;
      }
      // Run settlement must inspect the exact publication that the transcript
      // receives, not the raw Gateway projection. The publication retains the
      // optimistic prompt's accepted run identity beside a canonical final
      // whose history row may omit runId. Returning the raw projection caused
      // completed restored runs to inject a stale "final answer pending" row
      // until a project switch rebuilt the same history window.
      const currentTail = latestTailCache.current.restore(sessionKey)
        ?? historyCache.current.restore(sessionKey)
        ?? [];
      const publication = latestHistoryRefreshAction(
        projected,
        sessionKey,
        () => latestTailCache.current.restore(sessionKey),
        pendingInputs,
        completed.nativeHistoryFloor,
      );
      const published = publication(currentTail);
      historyFailure.current = completed.lookbackProblem ? 'latest' : null;
      setHistoryProblem(completed.lookbackProblem);
      setHistoryMessages(sessionKey, publication, 'latest', ownsLatest);
      return published;
    } catch (error) {
      if (!publicationAuthority.current?.owns(activityRevision) || selectedRef.current !== sessionKey || requestRevision !== latestRequestRevision.current) return;
      const problem = error instanceof Error ? error.message : 'history failed';
      if (selectedRef.current === sessionKey && windowMode.current === 'latest') { historyFailure.current = 'latest'; setHistoryProblem(problem); }
      onDetail(problem);
      return undefined;
    }
  }

  async function restoreLatestHistory() {
    const sessionKey = selectedRef.current; if (!sessionKey || client.status !== 'connected' || !publicationAuthority.current?.isActive) return;
    historySelectionRevision.current += 1;
    olderRequest.current.retire(); deferredLatestRefresh.current.retire(); setLoadingOlder(false);
    const requestRevision = ++latestRequestRevision.current;
    const activityRevision = publicationAuthority.current.capture();
    const pendingCandidates = pendingInputCustodyCandidates(
      latestTailCache.current.restore(sessionKey) ?? historyCache.current.restore(sessionKey) ?? [],
      sessionKey,
    );
    setHistoryProblem('');
    historyFailure.current = null;
    try {
      const ownsLatest = () => Boolean(publicationAuthority.current?.owns(activityRevision))
        && selectedRef.current === sessionKey && requestRevision === latestRequestRevision.current;
      const narrationRequest = hydrateSharedNarration(sessionKey, ownsLatest);
      const payload = await client.history(sessionKey, 80, 0); if (!ownsLatest()) return;
      const narration = await narrationRequest; if (!narration || !ownsLatest()) return;
      const bounded = await presentationBoundedLatestHistory(client, sessionKey, payload, workspacePath.current, ownsLatest, narration); if (!bounded) return;
      const retained = latestTailCache.current.restore(sessionKey) ?? historyCache.current.restore(sessionKey) ?? [];
      const completed = await completedNativeHistoryContinuity(client, sessionKey, bounded, retained, workspacePath.current, ownsLatest); if (!completed) return;
      const mountedReview = historyCache.current.restore(sessionKey) ?? [];
      const projected = completed.messages;
      const pendingInputs = completed.pendingInputSnapshot
        ? { snapshot: completed.pendingInputSnapshot, candidates: pendingCandidates }
        : undefined;
      const currentTail = latestTailCache.current.restore(sessionKey) ?? [];
      const publication = latestHistoryRefreshAction(
        projected,
        sessionKey,
        () => latestTailCache.current.restore(sessionKey),
        pendingInputs,
        completed.nativeHistoryFloor,
      );
      const publishedLatest = publication(currentTail);
      const restored = returnToLatestHistory(windowMode.current, publishedLatest, mountedReview);
      if (restored.windowMode === 'latest') resetLatestPagination(completed.cursor);
      windowMode.current = restored.windowMode;
      reviewEntryIntent.current = restored.windowMode === 'latest' ? null : 'fallback';
      historyFailure.current = completed.lookbackProblem ? 'latest' : null;
      setHistoryProblem(completed.lookbackProblem);
      setHistoryMessages(
        sessionKey,
        restored.windowMode === 'latest' ? publication : restored.messages,
        restored.windowMode,
        ownsLatest,
      );
      if (restored.windowMode === 'latest') clearPersistedHistoryReview(sessionKey);
      else persistHistoryReview(sessionKey, restored.messages);
      setCanLoadOlder(canPageOlder(cursor.current, archive.current));
    } catch (error) {
      if (!publicationAuthority.current?.owns(activityRevision) || selectedRef.current !== sessionKey || requestRevision !== latestRequestRevision.current) return;
      const problem = error instanceof Error ? error.message : 'latest history failed';
      historyFailure.current = 'latest';
      setHistoryProblem(problem);
      onDetail(problem);
    }
  }

  return { loadHistory, restoreLatestHistory };
}
