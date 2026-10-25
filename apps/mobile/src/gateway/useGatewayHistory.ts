import { useTranscriptPersistence } from './useTranscriptPersistence';
import { createNewerHistoryAction } from './newerHistoryLoading';
import { useHistoryPublicationReceipt } from './historyPublicationReceipt';
import { loadVisibleOlderHistoryBatch } from './loadVisibleOlderHistoryBatch';
import { OLDER_REVIEW_COST_LIMIT, type OlderHistoryVisibleContext } from './olderHistoryVisibleRows';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type Dispatch, type SetStateAction } from 'react';
import { archivedFamilyAuthorityInvalidated, archivedStateForProject, archiveIdentityTransition, type ArchivedHistoryState } from './archivedHistory';
import type { HistoryCursor } from './historyPagination';
import { latestPresentationWindow } from './historyWindow';
import type { OpenClawClient } from './OpenClawClient';
import { startupMessages, type WorkspaceMessage, type WorkspaceProject } from '../workspace/workspaceTypes';
import { persistedTranscriptRestorePublication, SessionHistoryCache } from './sessionHistoryCache';
import { loadHistoryReviewCache, loadTranscriptCache, saveHistoryReviewCache } from '../storage/workspaceStore';
import { sameTranscriptPublication } from './transcriptPublicationEquality';
import { authorizedHistoryStatePublication, reviewOmitsLatestMessages, latestSessionPublication, olderPageHistoryPublication, promptSubmissionHistoryPublication } from './historyReviewPublication';
import { createSessionMessagePublisher } from './sessionMessagePublication';
import { sessionOwnsVisiblePublication } from './sessionPublicationOwnership';
import { createLatestHistoryActions } from './latestHistoryLoading';
import { OlderHistoryRequestAuthority } from './historyRequestAuthority';
import { HistoryRefreshDeferral } from './historyRefreshDeferral';
import { mergeSharedNarration, sameSharedNarrationIdentity, sharedNarrationStateForProject, type SharedNarrationState } from './sharedNarration';
import { SharedNarrationHydration } from './sharedNarrationHydration';
import { gatewaySessionGeneration, type GatewaySessionGeneration } from './registrySessionIdentity';
import { generationReboundPublication, generationReboundVisiblePublication, messagesOwnedBySessionGeneration, sessionGenerationChanged } from './sessionGenerationPublication';
import { canPageOlder, restoredHistorySelection, restoredPersistedHistorySelection, SessionHistoryViewCache, threadEntryHistoryPresentation, type ReviewEntryIntent } from './sessionHistoryView';
import { parsedHistoryReview, serializedHistoryReview } from './persistentHistoryReview';
import { HistoryArchiveRecovery } from './historyArchiveRecovery';
import { HistoryPublicationAuthority } from './historyPublicationAuthority';
import { DeferredPromptRefusals, RefusalFilteredHistoryCache } from './deferredPromptRefusals';

const EMPTY_LATEST_MESSAGES: WorkspaceMessage[] = [];

export function useGatewayHistory(client: OpenClawClient, selectedRef: { current: string }, onDetail: Dispatch<SetStateAction<string>>, initialSessionKey = '', initiallyActive = true) {
  const cursor = useRef<HistoryCursor | null>(null);
  const archive = useRef<ArchivedHistoryState | null>(null);
  const sessionGeneration = useRef<GatewaySessionGeneration | null>(null);
  const sharedNarration = useRef<SharedNarrationState | null>(null);
  const narrationHydration = useRef(new SharedNarrationHydration());
  useEffect(() => () => narrationHydration.current.retire(), []);
  const olderRequest = useRef(new OlderHistoryRequestAuthority());
  const deferredLatestRefresh = useRef(new HistoryRefreshDeferral());
  const archiveRecovery = useRef(new HistoryArchiveRecovery());
  const windowMode = useRef<'latest' | 'older'>('latest');
  const reviewEntryIntent = useRef<ReviewEntryIntent>(null);
  const historyFailure = useRef<'latest' | 'older' | null>(null);
  const latestRequestRevision = useRef(0);
  const workspacePath = useRef('');
  const promptRefusals = useRef(new DeferredPromptRefusals());
  const historyCache = useRef<SessionHistoryCache>(new RefusalFilteredHistoryCache(promptRefusals.current));
  const latestTailCache = useRef<SessionHistoryCache>(new RefusalFilteredHistoryCache(promptRefusals.current));
  const historyViewCache = useRef(new SessionHistoryViewCache());
  const historySelectionRevision = useRef(0);
  const publicationAuthority = useRef<HistoryPublicationAuthority | null>(null);
  if (!publicationAuthority.current) publicationAuthority.current = new HistoryPublicationAuthority(initiallyActive);
  const activeSessionKey = useRef(initialSessionKey);
  const historyCacheInitialized = useRef(false);
  if (!historyCacheInitialized.current) {
    historyCache.current.store(activeSessionKey.current, startupMessages);
    latestTailCache.current.store(activeSessionKey.current, startupMessages);
    historyCacheInitialized.current = true;
  }
  const [messages, setRawMessageState] = useState<WorkspaceMessage[]>(startupMessages);
  const setMessageState = useMemo(() => promptRefusals.current.statePublisher(publicationAuthority, setRawMessageState), []);
  const receiptAfterCommit = useHistoryPublicationReceipt(messages);
  const [messageSessionKey, setMessageSessionKey] = useState(initialSessionKey);
  const latestMessages = useSyncExternalStore(latestTailCache.current.subscribe,
    () => latestTailCache.current.restore(messageSessionKey) ?? EMPTY_LATEST_MESSAGES);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [canLoadOlder, setCanLoadOlder] = useState(false);
  const [canLoadNewer, setCanLoadNewer] = useState(false);
  const historyProblemRef = useRef('');
  const [historyProblem, setHistoryProblemState] = useState('');
  const setHistoryProblem = useCallback((value: string) => {
    historyProblemRef.current = value;
    setHistoryProblemState(value);
  }, []);

  const { persistLater, suspendPersistence } = useTranscriptPersistence(publicationAuthority, promptRefusals);

  const historyViewSnapshot = useCallback(() => ({
    generation: sessionGeneration.current,
    archive: archive.current,
    cursor: cursor.current,
    windowMode: windowMode.current,
    reviewEntryIntent: reviewEntryIntent.current,
    historyFailure: historyFailure.current,
    historyProblem: historyProblemRef.current,
  }), []);
  const persistHistoryReview = useCallback((sessionKey: string, rows: WorkspaceMessage[]) => {
    if (!sessionKey || !publicationAuthority.current?.isActive) return;
    const view = activeSessionKey.current === sessionKey ? historyViewSnapshot() : historyViewCache.current.restore(sessionKey);
    if (!view) return;
    historyViewCache.current.store(sessionKey, view);
    const payload = serializedHistoryReview(view, promptRefusals.current.filter(sessionKey, rows));
    void saveHistoryReviewCache(sessionKey, payload).catch(() => undefined);
  }, [historyViewSnapshot]);
  const clearPersistedHistoryReview = useCallback((sessionKey: string) => {
    if (sessionKey && publicationAuthority.current?.isActive) void saveHistoryReviewCache(sessionKey, null).catch(() => undefined);
  }, []);

  const suspendHistoryPublication = useCallback(() => {
    publicationAuthority.current?.suspend();
    narrationHydration.current.retire();
    latestRequestRevision.current += 1;
    historySelectionRevision.current += 1;
    olderRequest.current.retire();
    deferredLatestRefresh.current.retire();
    archiveRecovery.current.retire();
    suspendPersistence();
  }, [suspendPersistence]);

  const flushPromptRefusals = useCallback(() => promptRefusals.current.flush({ authority: publicationAuthority, history: historyCache, latest: latestTailCache,
    views: historyViewCache, persist: persistLater, persistReview: persistHistoryReview, publish: setMessageState }), [persistHistoryReview, persistLater, setMessageState]);
  const rejectPromptSubmission = useCallback((sessionKey: string, optimisticID: string) => {
    if (promptRefusals.current.reject(sessionKey, optimisticID)) flushPromptRefusals();
  }, [flushPromptRefusals]);

  const resumeHistoryPublication = useCallback(() => {
    publicationAuthority.current?.resume();
    flushPromptRefusals();
    setLoadingOlder(false);
  }, [flushPromptRefusals]);

  const configureArchive = useCallback((project: WorkspaceProject | undefined, registry: Record<string, unknown> | null) => {
    if (!publicationAuthority.current?.isActive) return 'same';
    workspacePath.current = project?.path ?? '';
    const nextNarration = sharedNarrationStateForProject(project, registry);
    narrationHydration.current.configure(nextNarration);
    sharedNarration.current = nextNarration;
    const nextGeneration = gatewaySessionGeneration(project, registry);
    const immutableGenerationChanged = sessionGenerationChanged(sessionGeneration.current, nextGeneration);
    if (nextGeneration) sessionGeneration.current = nextGeneration;
    const next = archivedStateForProject(project, registry);
    const transition = archiveIdentityTransition(archive.current, next);
    const generationRebound = immutableGenerationChanged || transition === 'generation';
    if (transition !== 'same') archive.current = next;
    if (generationRebound || transition === 'removed') {
      // `/new` retires offset/archive authority despite a stable route key.
      // Keep mounted review rows until the next load binds the new generation.
      latestRequestRevision.current += 1;
      historySelectionRevision.current += 1;
      cursor.current = null;
      olderRequest.current.retire();
      deferredLatestRefresh.current.retire();
      archiveRecovery.current.retire();
      historyFailure.current = null;
      reviewEntryIntent.current = null;
      setLoadingOlder(false);
      setHistoryProblem('');
      clearPersistedHistoryReview(project?.sessionKey ?? activeSessionKey.current);
    }
    if (generationRebound && project) {
      // The generation owner distinguishes legacy replacement sessions from
      // native SQLite same-ID resets. Do not infer ownership from this stable
      // project key or indiscriminately retain the preceding live tail.
      const cachedVisible = historyCache.current.restore(project.sessionKey) ?? [];
      const cachedLatest = latestTailCache.current.restore(project.sessionKey) ?? cachedVisible;
      const generationActivityRevision = publicationAuthority.current.capture();
      const retained = generationReboundPublication(windowMode.current, cachedVisible, cachedLatest, nextGeneration);
      if (windowMode.current === 'latest') historyCache.current.store(project.sessionKey, retained.visible);
      latestTailCache.current.store(project.sessionKey, retained.latest);
      persistLater(project.sessionKey, retained.latest);
      if (activeSessionKey.current === project.sessionKey) {
        setMessageState((current) => {
          if (!publicationAuthority.current?.owns(generationActivityRevision)) return current;
          return generationReboundVisiblePublication(
            project.sessionKey, selectedRef.current, activeSessionKey.current,
            nextGeneration, sessionGeneration.current,
            windowMode.current, current, retained.latest,
          );
        });
      }
    }
    setCanLoadOlder(Boolean(cursor.current?.hasMore || (archive.current && !archive.current.exhausted && !archive.current.blocked)));
    return generationRebound ? 'generation' : transition;
  }, [clearPersistedHistoryReview, persistLater, setHistoryProblem]);

  const updateSessionMessages = useMemo(() => createSessionMessagePublisher({
    selectedRef, activeSessionKey, publicationAuthority, windowMode, historyCache,
    latestTailCache, historyViewCache, setMessageState, persistLater, persistHistoryReview,
  }), [persistHistoryReview, persistLater, selectedRef]);

  const preparePromptSubmission = useCallback((sessionKey: string) => {
    if (!sessionKey || !publicationAuthority.current?.isActive || windowMode.current !== 'older') return;
    if (!sessionOwnsVisiblePublication(sessionKey, selectedRef.current, activeSessionKey.current)) return;

    // A send is an explicit return to the live conversation. Retire every
    // older-history writer before the optimistic prompt is queued, then mount
    // the hidden authoritative tail synchronously. Without this boundary the
    // accepted prompt and its live run rows remain hidden behind the review
    // window and later resurface above unrelated older responses.
    historySelectionRevision.current += 1;
    latestRequestRevision.current += 1;
    olderRequest.current.retire();
    deferredLatestRefresh.current.retire();
    archiveRecovery.current.retire();
    historyFailure.current = null;
    setLoadingOlder(false);
    setHistoryProblem('');
    const prepared = promptSubmissionHistoryPublication(
      windowMode.current,
      historyCache.current.restore(sessionKey) ?? [],
      latestTailCache.current.restore(sessionKey) ?? [],
    );
    windowMode.current = prepared.windowMode;
    reviewEntryIntent.current = null;
    historyCache.current.store(sessionKey, prepared.visible);
    latestTailCache.current.store(sessionKey, prepared.latest);
    setMessageState(prepared.visible);
    setCanLoadOlder(canPageOlder(cursor.current, archive.current));
    clearPersistedHistoryReview(sessionKey);
  }, [clearPersistedHistoryReview, selectedRef, setHistoryProblem]);
  const setHistoryMessages = useCallback((sessionKey: string, action: SetStateAction<WorkspaceMessage[]>, side: 'latest' | 'older', ownsPublication: () => boolean) => {
    if (!publicationAuthority.current?.isActive) return;
    setMessageState((current) => {
      const publication = authorizedHistoryStatePublication(
        sessionKey,
        selectedRef.current,
        activeSessionKey.current,
        ownsPublication,
        current,
        action,
      );
      if (!publication.owned) return current;
      const next = publication.messages;
      if (sameTranscriptPublication(current, next)) {
        if (side === 'older') persistHistoryReview(sessionKey, current);
        return current;
      }
      historyCache.current.store(sessionKey, next);
      if (side === 'latest') {
        latestTailCache.current.store(sessionKey, next);
        persistLater(sessionKey, next);
      } else persistHistoryReview(sessionKey, next);
      return next;
    });
  }, [persistHistoryReview, persistLater, selectedRef]);

  const resetHistory = useCallback((project: WorkspaceProject | undefined, registry: Record<string, unknown> | null, replacement: WorkspaceMessage[] = []) => {
    if (!publicationAuthority.current?.isActive) return;
    latestRequestRevision.current += 1;
    const restoreRevision = ++historySelectionRevision.current;
    const restoreActivityRevision = publicationAuthority.current.capture();
    workspacePath.current = project?.path ?? '';
    const nextNarration = sharedNarrationStateForProject(project, registry);
    narrationHydration.current.configure(nextNarration);
    sharedNarration.current = nextNarration;
    const nextSessionKey = project?.sessionKey ?? '';
    const previousSessionKey = activeSessionKey.current;
    const previousView = {
      generation: sessionGeneration.current,
      archive: archive.current,
      cursor: cursor.current,
      windowMode: windowMode.current,
      reviewEntryIntent: reviewEntryIntent.current,
      historyFailure: historyFailure.current,
      historyProblem: historyProblemRef.current,
    };
    historyViewCache.current.store(previousSessionKey, previousView);
    if (previousView.windowMode === 'older') {
      const previousRows = historyCache.current.restore(previousSessionKey) ?? [];
      const payload = serializedHistoryReview(previousView, promptRefusals.current.filter(previousSessionKey, previousRows));
      void saveHistoryReviewCache(previousSessionKey, payload).catch(() => undefined);
    }
    const initialArchive = archivedStateForProject(project, registry);
    const generation = gatewaySessionGeneration(project, registry);
    const reviewMemory = historyCache.current.restore(nextSessionKey) ?? [];
    const latestMemory = latestTailCache.current.restore(nextSessionKey);
    const cachedView = replacement.length ? undefined : historyViewCache.current.restore(nextSessionKey);
    const restored = restoredHistorySelection(
      cachedView,
      generation,
      initialArchive,
      reviewMemory,
      latestSessionPublication([], replacement.length
        ? replacement
        : messagesOwnedBySessionGeneration(latestMemory ?? [], generation)),
    );
    cursor.current = restored.cursor;
    archive.current = restored.archive;
    sessionGeneration.current = restored.generation;
    olderRequest.current.retire();
    deferredLatestRefresh.current.retire();
    archiveRecovery.current.retire();
    windowMode.current = restored.windowMode;
    setCanLoadNewer(restored.windowMode === 'older');
    reviewEntryIntent.current = restored.reviewEntryIntent;
    historyFailure.current = restored.historyFailure;
    activeSessionKey.current = nextSessionKey;
    setMessageSessionKey(nextSessionKey);
    setMessageState((current) => {
      historyCache.current.store(previousSessionKey, current);
      persistLater(previousSessionKey, latestTailCache.current.restore(previousSessionKey) ?? current);
      historyCache.current.store(nextSessionKey, restored.messages);
      if (restored.windowMode === 'latest') latestTailCache.current.store(nextSessionKey, restored.messages);
      return restored.messages;
    });
    if (!replacement.length && restored.windowMode === 'latest' && !latestMemory && nextSessionKey) void loadTranscriptCache(nextSessionKey).then((cached) => {
      if (!publicationAuthority.current?.owns(restoreActivityRevision) || !cached.length || historySelectionRevision.current !== restoreRevision || activeSessionKey.current !== nextSessionKey) return;
      if (latestTailCache.current.restore(nextSessionKey)?.length) return;
      // Keep the restart preview as the hidden latest tail even when a
      // durable archived review wins the visible pane a moment later.
      const decorated = latestSessionPublication([], messagesOwnedBySessionGeneration(client.decorateMessages(cached, nextSessionKey), generation));
      setMessageState((latest) => {
        if (!publicationAuthority.current?.owns(restoreActivityRevision) || windowMode.current !== 'latest' || historySelectionRevision.current !== restoreRevision || activeSessionKey.current !== nextSessionKey) return latest;
        const publication = persistedTranscriptRestorePublication(
          latest,
          latestTailCache.current.restore(nextSessionKey) ?? [],
          decorated,
        );
        if (!publication.publish) return publication.messages;
        // The persistence layer is byte/message bounded for suspension safety,
        // but those messages may each contain hundreds of display rows. Apply
        // the same presentation window before the very first cache paint so a
        // cold launch cannot transiently mount a pathological transcript.
        latestTailCache.current.store(nextSessionKey, publication.messages);
        historyCache.current.store(nextSessionKey, publication.messages);
        return publication.messages;
      });
    }).catch(() => undefined);
    setLoadingOlder(false);
    setCanLoadOlder(restored.canLoadOlder);
    setHistoryProblem(restored.historyProblem);
    if (!replacement.length && !cachedView && nextSessionKey) void loadHistoryReviewCache(nextSessionKey).then((payload) => {
      if (!publicationAuthority.current?.owns(restoreActivityRevision) || historySelectionRevision.current !== restoreRevision || activeSessionKey.current !== nextSessionKey) return;
      const persisted = parsedHistoryReview(payload);
      if (!persisted) return;
      const persistedSelection = restoredPersistedHistorySelection(
        persisted.view,
        sessionGeneration.current,
        archive.current,
        client.decorateMessages(persisted.messages, nextSessionKey),
        latestTailCache.current.restore(nextSessionKey) ?? [],
      );
      if (!persistedSelection) {
        clearPersistedHistoryReview(nextSessionKey);
        return;
      }
      cursor.current = persistedSelection.cursor;
      archive.current = persistedSelection.archive;
      sessionGeneration.current = persistedSelection.generation;
      windowMode.current = 'older';
      setCanLoadNewer(true);
      reviewEntryIntent.current = persistedSelection.reviewEntryIntent;
      historyFailure.current = persistedSelection.historyFailure;
      historyViewCache.current.store(nextSessionKey, persistedSelection);
      historyCache.current.store(nextSessionKey, persistedSelection.messages);
      setMessageState((current) => {
        if (!publicationAuthority.current?.owns(restoreActivityRevision) || historySelectionRevision.current !== restoreRevision || activeSessionKey.current !== nextSessionKey) return current;
        return persistedSelection.messages;
      });
      setCanLoadOlder(persistedSelection.canLoadOlder);
      setHistoryProblem(persistedSelection.historyProblem);
    }).catch(() => undefined);
    return threadEntryHistoryPresentation(restored);
  }, [clearPersistedHistoryReview, client, persistLater, setHistoryProblem]);

  const ownsSession = useCallback((sessionKey: string) => activeSessionKey.current === sessionKey, []);
  const sessionMessages = useCallback((sessionKey: string) => latestTailCache.current.restore(sessionKey) ?? historyCache.current.restore(sessionKey) ?? [], []);
  const visibleSessionMessages = useCallback((sessionKey: string) => historyCache.current.restore(sessionKey) ?? [], []);

  const hydrateSharedNarration = useCallback(async (sessionKey: string, isCurrent: () => boolean) => {
    const state = sharedNarration.current;
    if (!state || state.sessionKey !== sessionKey) return [] as WorkspaceMessage[];
    return narrationHydration.current.hydrate(client, state, isCurrent, onDetail);
  }, [client, onDetail]);

  const refreshSharedNarration = useCallback(async (sessionKey: string) => {
    if (!publicationAuthority.current?.isActive) return;
    const activityRevision = publicationAuthority.current.capture();
    const state = sharedNarration.current;
    if (!state || state.sessionKey !== sessionKey) return;
    const isCurrent = () => Boolean(publicationAuthority.current?.owns(activityRevision))
      && selectedRef.current === sessionKey
      && sameSharedNarrationIdentity(state, sharedNarration.current);
    const hydrated = await hydrateSharedNarration(sessionKey, isCurrent);
    if (!hydrated || !isCurrent()) return;
    // This is deliberately narrower than chat.history. An active run keeps
    // live rows mounted, while the host's immutable narration snapshot gives
    // delayed preambles their source timestamp so they can cross optimistic
    // steer prompts without waiting for terminal history refresh.
    updateSessionMessages(sessionKey, (current) => latestPresentationWindow(mergeSharedNarration(current, hydrated)));
  }, [hydrateSharedNarration, selectedRef, updateSessionMessages]);

  const historyActionsContext = {
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
  };
  const { loadHistory, restoreLatestHistory } = useMemo(() => createLatestHistoryActions(historyActionsContext), [clearPersistedHistoryReview, client, hydrateSharedNarration, onDetail, persistHistoryReview, persistLater, selectedRef, setHistoryMessages, setHistoryProblem]);
  const loadNewerHistory = useMemo(() => createNewerHistoryAction({ ...historyActionsContext, sessionGeneration, receiptAfterCommit, setCanLoadNewer, loadHistory }), [clearPersistedHistoryReview, client, hydrateSharedNarration, loadHistory, onDetail, persistHistoryReview, persistLater, receiptAfterCommit, selectedRef, setHistoryMessages, setHistoryProblem]);

  const loadOlderHistory = useCallback(async (context: OlderHistoryVisibleContext = {}) => {
    const current = cursor.current; const sessionKey = selectedRef.current;
    if (!sessionKey || client.status !== 'connected' || !publicationAuthority.current?.isActive || olderRequest.current.isActive()) return;
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
        archive: archive.current, context, owns: ownsRequest });
      if (!ownsRequest()) return;
      if (batch.problem && (!batch.older.length || archivedFamilyAuthorityInvalidated(batch.problem))) throw batch.problem;
      cursor.current = batch.cursor;
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
        ).visible, 'older', ownsPublication);
      }
      if (batch.problem) {
        const problem = batch.problem instanceof Error ? batch.problem.message : 'older history failed';
        historyFailure.current = 'older';
        if (!cursor.current?.hasMore && archive.current) archive.current = { ...archive.current, blocked: problem };
        setHistoryProblem(problem);
        onDetail(problem);
      } else if (!hasCurrentPage) onDetail(batch.older.length
        ? `loaded ${batch.older.length} older archived transcript rows` : 'archived history exhausted');
      setCanLoadOlder(Boolean(cursor.current?.hasMore || (archive.current && !archive.current.exhausted && !archive.current.blocked)));
      if (!batch.older.length) return undefined;
      const receipt = receiptAfterCommit(ownsPublication);
      return { publication: receipt.publication.then(result => ({
        ...result, addedVisibleRowCount: result.published ? batch.addedVisibleRowCount : 0,
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
  }, [clearPersistedHistoryReview, client, loadHistory, onDetail, persistHistoryReview, receiptAfterCommit, selectedRef, setHistoryMessages, setHistoryProblem]);

  const retryHistory = useCallback(async (context: OlderHistoryVisibleContext = {}) => {
    if (!publicationAuthority.current?.isActive) return;
    if (historyFailure.current === 'older') await loadOlderHistory(context);
    else if (selectedRef.current) await loadHistory(selectedRef.current);
  }, [loadHistory, loadOlderHistory, selectedRef]);

  return { messages, messageSessionKey, latestMessages, hasNewerHistory: windowMode.current === 'older' && (canLoadNewer || reviewOmitsLatestMessages(windowMode.current, messages, latestMessages)), updateSessionMessages, preparePromptSubmission, rejectPromptSubmission, sessionMessages, visibleSessionMessages, loadingOlder, canLoadOlder, historyProblem, configureArchive, resetHistory, ownsSession, loadHistory, loadOlderHistory, loadNewerHistory, retryHistory, restoreLatestHistory, refreshSharedNarration, suspendHistoryPublication, resumeHistoryPublication };
}
