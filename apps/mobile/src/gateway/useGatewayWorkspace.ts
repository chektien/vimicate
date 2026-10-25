import { useSelectedRunPublication } from './useSelectedRunPublication';
import { useStoppedRunNotices } from './useStoppedRunNotices';
 import { useGatewayQuestions } from './useGatewayQuestions'; import { useGatewayFileLocations } from './useGatewayFileLocations';
import { reconcileVisibleRunCompletion } from './runCompletionPublication'; import { ChatStreamAccumulator } from './chatStreamAccumulator';
import * as SecureStore from 'expo-secure-store';
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { saveValue, setWorkspacePersistenceActive } from '../storage/workspaceStore';
import { applyStarOverrides, updatedStarOverrides, type StarOverrides } from '../workspace/workspacePresentation';
import { offlineProjects, startupMessages, type WorkspaceProject } from '../workspace/workspaceTypes';
import { OpenClawClient, type GatewayStatus } from './OpenClawClient';
import { pendingApprovalMessages, projectRegisteredGatewayEvent, upsertLiveMessage } from './gatewayEventProjection';
import { gatewayFrameSessionKey, refreshIntentForGatewayEvent } from './gatewayEvents';
import { GatewayRefreshBatch } from './gatewayRefreshBatch';
import { type GatewayCommand } from './gatewayCommands'; import type { ModelChoice } from './modelMatching';
import { GatewayReconnectLadder, shouldReconnect } from './reconnectPolicy';
import { bindRunLifecycleSignal, noteTrackedLiveFrame, ownedRunLifecycleSignal, runLifecycleSignalForGatewayFrame } from './runLifecycleProjection';
import { completedRunMessage, hasRenderedAssistantFinalForRun, reconcileOwnedPendingFinal, reconcileAuthoritativeActiveRunLifecycle, reconcileCompletedRunMessage, removeUnansweredRunLifecycle } from './runCompletionMessage';
import { parseSetupCode, type GatewayProfile } from './setupCode';
import { detachSharedPairing, reattachSharedPairing, saveSharedPairedProfile } from './sharedPairing';
import { useGatewayHistory } from './useGatewayHistory';
import { SessionRunRegistry } from './sessionRunRegistry';
import { useGatewaySubmission } from './useGatewaySubmission';
import { useGatewayConversationInputs } from './useGatewayConversationInputs';
import { shouldResetHistoryForSelection } from './sessionHistoryCache';
import { flushBufferedLiveMessages, liveMessagePublicationDelayMs, liveMessagePublicationMode, LiveMessagePublicationBuffer, LiveMessagePublicationTimers, requiresImmediateLivePublication, suspendLiveMessagePublication } from './liveMessagePublication';
import { latestPresentationWindow } from './historyWindow';
import { SessionRunMonitorOwners } from './sessionRunMonitorOwners';
import { gatewayAllowsLivePublication, gatewayAppLifecycleAction, gatewayAppMountLifecycleAction } from './gatewayAppLifecycle';
import { settleRunToolMessages } from './runToolSettlement';
import { delegatedFailureQualification } from './delegatedRunTruth';
import { answeredFailureAsCompletion } from './answeredRunFailure';
import { WorkspaceActivityLedger } from '../workspace/workspaceActivityLedger';
import { acceptWorkspaceAttention, WorkspaceAttentionLedger, workspaceAttentionSignal } from '../workspace/workspaceAttention';
import { approvalReconciliationAction, approvalReconciliationCandidates, incompleteApprovalRunMessage, reconcileApprovalAbsence, runHasExpiredApproval } from './approvalFinalization';
import { PendingFinalAnswerRegistry } from './pendingFinalAnswerRegistry';
import { useGatewayApprovalDecision } from './useGatewayApprovalDecision';
import { useGatewayMessageRecovery } from './useGatewayMessageRecovery';
import { useGatewayFinalAnswerRecovery } from './useGatewayFinalAnswerRecovery';
import { useProviderUsage } from './useProviderUsage';
import { resetLocalDeviceIdentityIfSimulator } from './deviceIdentity';
import { sessionOwnsDetailPublication } from './sessionPublicationOwnership';
import { guardedBackgroundTaskDetail, launchGuardedBackgroundTask } from '../async/guardedBackgroundTask';
import { scheduleSharedNarrationRefresh } from './sharedNarrationLiveRefresh';
import { gatewayFrameHasSilentAssistant } from './gatewaySilentTerminal';
import { ACTIVE_RUNS_KEY, LEGACY_LAB_PROFILE_KEY, PENDING_FINAL_ANSWERS_KEY, PROFILE_KEY, SELECTED_SESSION_KEY, STARRED_SESSION_KEYS, WORKSPACE_ACTIVITY_KEY, WORKSPACE_ATTENTION_KEY } from './gatewayWorkspaceStorageKeys';
import { acknowledgeSelectedSessionRead } from './sessionReadAcknowledgement';
import { useSelectedSessionRunTruth } from './useSelectedSessionRunTruth';
import { useTranscriptRunTruth } from './useTranscriptRunTruth';
import { retainSilentTerminalRun, useGatewayRunMonitor } from './useGatewayRunMonitor';
import { ProjectRegistryRetryOwner } from '../workspace/projectRegistryRetry';
import { useGatewaySessionRefresh } from './useGatewaySessionRefresh';
import { gatewaySessionGeneration } from './registrySessionIdentity';
import { serializedPersistedWorkspaceSelection } from './persistedWorkspaceSelection';
import { mediaScenePublicationAuthority } from '../transcript/mediaScenePublicationAuthority';
import { HistoryPublicationAuthority } from './historyPublicationAuthority';
import { useGatewayPersistedStartup } from './useGatewayPersistedStartup';
import { useGatewayCommands } from './useGatewayCommands';
import { useGatewayAbort } from './useGatewayAbort';
import { useGatewayThreadRegistryMutation } from './useGatewayThreadRegistryMutation';
import { useGatewayWorkspaceUnmount } from './useGatewayWorkspaceUnmount'; function persistWorkspaceSelection(sessionKey: string, projectID: string) { launchGuardedBackgroundTask(() => saveValue(SELECTED_SESSION_KEY, serializedPersistedWorkspaceSelection(sessionKey, projectID))); }
export function useGatewayWorkspace({ restorePersisted = true }: { restorePersisted?: boolean } = {}) {
  const client = useMemo(() => new OpenClawClient(), []);
  const refreshBatch = useRef(new GatewayRefreshBatch());
  const livePublicationTimers = useRef(new LiveMessagePublicationTimers());
  const narrationRefreshTimers = useRef(new LiveMessagePublicationTimers());
  const pendingLiveMessages = useRef(new LiveMessagePublicationBuffer());
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectLadder = useRef(new GatewayReconnectLadder());
  const reconnectEnabled = useRef(false);
  const appActive = useRef(AppState.currentState === 'active');
  const suspendedByBackground = useRef(false);
  const scenePublicationAuthority = useRef(new HistoryPublicationAuthority(appActive.current));
  const profileRef = useRef<GatewayProfile | null>(null);
  const connectionTask = useRef<Promise<void> | null>(null);
  const recoveryTasks = useRef(new SessionRunMonitorOwners());
  const finalAnswerRecoveryTasks = useRef(new SessionRunMonitorOwners());
  const pendingFinalAnswers = useRef(new PendingFinalAnswerRegistry());
  const silentTerminalRuns = useRef(new Set<string>());
  const runRegistry = useRef(new SessionRunRegistry());
  const registrySnapshot = useRef<Record<string, unknown> | null>(null);
  const registryRetryOwner = useRef(new ProjectRegistryRetryOwner());
  const starOverrides = useRef<StarOverrides>({});
  const activityLedger = useRef(new WorkspaceActivityLedger());
  const attentionLedger = useRef(new WorkspaceAttentionLedger());
  const selectedRef = useRef('');
  const selectedProjectIDRef = useRef('');
  const [profile, setProfile] = useState<GatewayProfile | null>(null);
  const [status, setStatus] = useState<GatewayStatus>('idle');
  const providerUsage = useProviderUsage(client, profile, status, scenePublicationAuthority); const [detail, setDetail] = useState('offline');
  const [projects, setProjects] = useState<WorkspaceProject[]>(offlineProjects); const [projectsReady, setProjectsReady] = useState(false);
  const projectsRef = useRef(projects); projectsRef.current = projects;
  const [selectedKey, setSelectedKey] = useState(offlineProjects[0]?.sessionKey ?? '');
  const [commands, setCommands] = useState<GatewayCommand[]>([]); const [modelChoices, setModelChoices] = useState<ModelChoice[]>([]);
  const [sending, setSending] = useState(false); const chatStreams = useRef(new ChatStreamAccumulator()); useEffect(() => { if (status !== 'connected') chatStreams.current.clear(); }, [status]); // no stale deltaText baseline after a drop
  const { hasNewerHistory, messages: rawMessages, latestMessages: rawLatestMessages, messageSessionKey, updateSessionMessages, preparePromptSubmission, rejectPromptSubmission, sessionMessages, visibleSessionMessages, loadingOlder, canLoadOlder, historyProblem, configureArchive, resetHistory, ownsSession, loadHistory, loadOlderHistory, loadNewerHistory, retryHistory, restoreLatestHistory, refreshSharedNarration, suspendHistoryPublication, resumeHistoryPublication } = useGatewayHistory(client, selectedRef, setDetail, selectedKey, appActive.current);
  const messages = useStoppedRunNotices(rawMessages, runRegistry.current); const latestMessages = useStoppedRunNotices(rawLatestMessages, runRegistry.current);
  const questions = useGatewayQuestions(client, status, scenePublicationAuthority, messages, messageSessionKey, projects, selectedKey); const messagesRef = useRef(messages); messagesRef.current = messages;
  const hasPublishedFinalForRun = useCallback((sessionKey: string, runId: string) => (messageSessionKey === sessionKey && hasRenderedAssistantFinalForRun(messagesRef.current, runId)) || hasRenderedAssistantFinalForRun(sessionMessages(sessionKey), runId), [messageSessionKey, sessionMessages]);
  const publishSelectedRun = useSelectedRunPublication(runRegistry, selectedRef, setSending, setProjects);
  const { asyncSubmit, asyncQuestions, queuedPrompts } = useGatewayConversationInputs(client, status, profile?.endpoint ?? '', scenePublicationAuthority, runRegistry, selectedKey, projects, messages, latestMessages, publishSelectedRun);
  const persistRuns = useCallback(() => { launchGuardedBackgroundTask(() => saveValue(ACTIVE_RUNS_KEY, JSON.stringify(runRegistry.current.snapshot()))); }, []);
  const persistPendingFinalAnswers = useCallback(() => { launchGuardedBackgroundTask(() => saveValue(PENDING_FINAL_ANSWERS_KEY, pendingFinalAnswers.current.serialized())); }, []);
  const recordLocalInteraction = useCallback((sessionKey: string, timestamp = Date.now(), unread = false) => {
    activityLedger.current.record(sessionKey, timestamp);
    setProjects((current) => current.map((project) => project.sessionKey === sessionKey ? { ...project, updatedAt: Math.max(project.updatedAt ?? 0, timestamp), ...(unread ? { unread: true } : {}) } : project));
    launchGuardedBackgroundTask(() => saveValue(WORKSPACE_ACTIVITY_KEY, activityLedger.current.serialized()));
  }, []);
  useTranscriptRunTruth({ messageSessionKey, visibleMessages: messages, runRegistry, sessionMessages, persistRuns, publishSelectedRun });
  const settleVisibleCompletion = useCallback((sessionKey: string, runId: string, awaitingFinal = false) => {
    if (!sessionKey || selectedRef.current !== sessionKey) return;
    const incomplete = runHasExpiredApproval(messagesRef.current, sessionKey, runId)
      && !hasRenderedAssistantFinalForRun(messagesRef.current, runId);
    if (incomplete) {
      runRegistry.current.markIncompleteRun(sessionKey, runId);
      persistRuns(); publishSelectedRun(sessionKey);
    }
    updateSessionMessages(sessionKey, current => reconcileVisibleRunCompletion(current, sessionKey, runId, {
      incomplete, awaitingFinal, ownsRun: runRegistry.current.ownsRun(sessionKey, runId), elapsedMs: runRegistry.current.elapsedMsFor(sessionKey, runId),
    }));
  }, [persistRuns, publishSelectedRun, updateSessionMessages]);
  const { startFinalAnswerRecovery, recoverPendingFinalAnswers } = useGatewayFinalAnswerRecovery({ client, selectedRef, runRegistry, pendingFinalAnswers, recoveryTasks: finalAnswerRecoveryTasks, hasPublishedFinalForRun, loadHistory, updateSessionMessages, persistPendingFinalAnswers, persistRuns, publishSelectedRun, setDetail, scenePublicationAuthority });
  const refreshRunTruth = useSelectedSessionRunTruth(client, runRegistry, persistRuns, publishSelectedRun, scenePublicationAuthority);
  const { loadSessions, retireSessionRefresh } = useGatewaySessionRefresh({ client, scenePublicationAuthority, runRegistry, attentionLedger, activityLedger, starOverrides, registrySnapshot, registryRetryOwner, appActive, suspendedByBackground, selectedRef, selectedProjectIDRef, projectsRef, setProjects, setProjectsReady, setSelectedKey, setDetail, recordLocalInteraction, persistRuns, persistWorkspaceSelection, publishSelectedRun, refreshRunTruth, configureArchive, resetHistory, ownsSession, loadHistory, visibleSessionMessages, updateSessionMessages });
  const loadCommands = useGatewayCommands(client, scenePublicationAuthority, setCommands, setModelChoices, setDetail);
  const loadPendingApprovals = useCallback(async (sessionKey = selectedRef.current) => {
    if (client.status !== 'connected' || !sessionKey || !scenePublicationAuthority.current.isActive) return;
    const activityRevision = scenePublicationAuthority.current.capture();
    const reconciliationCandidates = approvalReconciliationCandidates(messagesRef.current, sessionKey);
    try {
      const [exec, plugin] = await Promise.all([client.listApprovals('exec'), client.listApprovals('plugin')]);
      if (!scenePublicationAuthority.current.owns(activityRevision) || selectedRef.current !== sessionKey) return;
      const pending = [...pendingApprovalMessages(exec, 'exec', sessionKey), ...pendingApprovalMessages(plugin, 'plugin', sessionKey)];
      const reconciliationNow = Date.now();
      const candidateIds = new Set(reconciliationCandidates);
      const reconciliation = reconcileApprovalAbsence(messagesRef.current, pending, sessionKey, reconciliationNow, candidateIds);
      updateSessionMessages(sessionKey, approvalReconciliationAction(pending, sessionKey, reconciliationCandidates, reconciliationNow));
      let lifecycleChanged = false;
      for (const runId of reconciliation.expiredRunIds) lifecycleChanged = runRegistry.current.markRunUncertain(sessionKey, runId) || lifecycleChanged;
      if (lifecycleChanged) { persistRuns(); publishSelectedRun(sessionKey); }
    } catch (error) { if (scenePublicationAuthority.current.owns(activityRevision) && sessionOwnsDetailPublication(sessionKey, selectedRef.current)) setDetail(error instanceof Error ? error.message : 'pending approvals failed'); }
  }, [client, persistRuns, publishSelectedRun, updateSessionMessages]);
  const { startRunMonitor, recoverActiveRuns } = useGatewayRunMonitor({ client, selectedRef, runRegistry, recoveryTasks, pendingFinalAnswers, silentTerminalRuns, hasPublishedFinalForRun, loadHistory, updateSessionMessages, persistPendingFinalAnswers, persistRuns, publishSelectedRun, settleVisibleCompletion, startFinalAnswerRecovery, setDetail, scenePublicationAuthority: scenePublicationAuthority });
  const establishConnection = useCallback(async (target: GatewayProfile) => {
    if (!scenePublicationAuthority.current.isActive) return;
    const activityRevision = scenePublicationAuthority.current.capture();
    profileRef.current = target;
    reconnectEnabled.current = true;
    if (connectionTask.current) return connectionTask.current;
    const task = (async () => {
      await client.connect(target);
      if (!scenePublicationAuthority.current.owns(activityRevision)) return;
      await loadSessions(true, '', false, true);
      if (!scenePublicationAuthority.current.owns(activityRevision)) return;
      await Promise.all([loadCommands(), loadPendingApprovals()]);
      if (!scenePublicationAuthority.current.owns(activityRevision)) return;
      recoverActiveRuns();
      recoverPendingFinalAnswers();
    })();
    connectionTask.current = task;
    try { await task; }
    finally { if (connectionTask.current === task) connectionTask.current = null; }
  }, [client, loadCommands, loadPendingApprovals, loadSessions, recoverActiveRuns, recoverPendingFinalAnswers]);

  const canPublishScene = useCallback(() => gatewayAllowsLivePublication(appActive.current, suspendedByBackground.current), []);
  const resumePersistedWorkspace = useGatewayPersistedStartup({ enabled: restorePersisted, canPublish: canPublishScene, runRegistry, starOverrides, activityLedger, attentionLedger, pendingFinalAnswers, setProjects, selectedRef, selectedProjectIDRef, setSelectedKey, profileRef, reconnectEnabled, setProfile, setDetail, establishConnection });
  useEffect(() => {
    selectedRef.current = selectedKey;
  }, [selectedKey]);
  useEffect(() => {
    const mountAction = gatewayAppMountLifecycleAction(AppState.currentState);
    appActive.current = mountAction === 'resume';
    suspendedByBackground.current = !appActive.current; setWorkspacePersistenceActive(appActive.current);
    if (appActive.current) resumeHistoryPublication(); else suspendHistoryPublication();
    if (appActive.current) scenePublicationAuthority.current.resume(); else scenePublicationAuthority.current.suspend();
    if (appActive.current) mediaScenePublicationAuthority.resume(); else mediaScenePublicationAuthority.suspend();
    const clearReconnectTimer = () => {
      if (!reconnectTimer.current) return;
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    };
    const scheduleReconnect = (immediate = false) => {
      if (reconnectTimer.current || !shouldReconnect(client.status, reconnectEnabled.current, appActive.current, Boolean(profileRef.current))) return;
      const delay = immediate ? 0 : reconnectLadder.current.delayMs();
      if (delay) setDetail(`reconnecting in ${Math.ceil(delay / 1000)}s`);
      reconnectTimer.current = setTimeout(() => {
        reconnectTimer.current = null;
        const target = profileRef.current;
        if (!target || !shouldReconnect(client.status, reconnectEnabled.current, appActive.current, true)) return;
        reconnectLadder.current.attempted();
        void establishConnection(target).catch(() => undefined);
      }, delay);
    };
    client.onStatus = (next, value) => {
      if (next !== 'connected') retireSessionRefresh();
      console.info(`[vimicate.gateway] status=${next}`);
      if (!gatewayAllowsLivePublication(appActive.current, suspendedByBackground.current)) return;
      setStatus(next); setDetail(value ?? next);
      if (next === 'connected') { reconnectLadder.current.connected(); clearReconnectTimer(); }
      else if (next === 'connecting' || next === 'idle') clearReconnectTimer();
      else { reconnectLadder.current.dropped(); scheduleReconnect(); }
    };
    client.onEventError = () => {
      if (!gatewayAllowsLivePublication(appActive.current, suspendedByBackground.current)) return;
      setDetail('live event could not be projected; canonical history will recover it');
    };
    client.onIssuedDeviceToken = (token, scopes) => {
      if (!gatewayAllowsLivePublication(appActive.current, suspendedByBackground.current)) return;
      setProfile((current) => {
        if (!current) return current;
        const paired = { ...current, credentialKind: 'deviceToken' as const, credential: token, scopes, authoritySource: 'sharedKeychain' as const };
        profileRef.current = paired;
        launchGuardedBackgroundTask(() => SecureStore.setItemAsync(PROFILE_KEY, JSON.stringify(paired), { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY }));
        void saveSharedPairedProfile(paired, token, scopes).catch(() => {
          if (gatewayAllowsLivePublication(appActive.current, suspendedByBackground.current)) setDetail('paired; shared Keychain update failed');
        });
        return paired;
      });
    };
    client.onEvent = (incoming) => { const frame = chatStreams.current.normalize(incoming); // before any early return: keep the deltaText baseline
      if (!gatewayAllowsLivePublication(appActive.current, suspendedByBackground.current)) return;
      if (frame.event === 'question.requested' || frame.event === 'question.resolved') {
        if (questions.event(frame) && frame.event === 'question.requested') {
          // The accepted record supplies scope. Publish already-arrived rows in
          // the same priority lane as the question, never in a later transition.
          const sessionKey = gatewayFrameSessionKey(frame).trim();
          livePublicationTimers.current.cancel(sessionKey);
          const pending = pendingLiveMessages.current.drainSession(sessionKey);
          if (pending.length) updateSessionMessages(sessionKey, current => latestPresentationWindow(pending
            .filter(message => message.role !== 'run' || !message.runId || runRegistry.current.ownsRun(sessionKey, message.runId))
            .reduce(upsertLiveMessage, current)));
        }
        return;
      }
      const attention = workspaceAttentionSignal(frame);
      const attentionAcceptance = attention ? acceptWorkspaceAttention(attentionLedger.current, attention, selectedRef.current) : null;
      if (attention && attentionAcceptance?.accepted) {
        recordLocalInteraction(attention.sessionKey, attention.occurredAt, attentionAcceptance.unread);
        launchGuardedBackgroundTask(() => saveValue(WORKSPACE_ATTENTION_KEY, attentionLedger.current.serialized()));
      }
      const rawLifecycle = noteTrackedLiveFrame(runRegistry.current, runLifecycleSignalForGatewayFrame(frame));
      const lifecycleMessages = rawLifecycle ? rawLifecycle.sessionKey === selectedRef.current ? messagesRef.current : sessionMessages(rawLifecycle.sessionKey) : [];
      const delegatedFailure = rawLifecycle ? delegatedFailureQualification(rawLifecycle, lifecycleMessages) : null;
      const observedLifecycle = answeredFailureAsCompletion(delegatedFailure?.signal ?? rawLifecycle, lifecycleMessages);
      const lifecycle = ownedRunLifecycleSignal(bindRunLifecycleSignal(observedLifecycle, observedLifecycle ? runRegistry.current.runFor(observedLifecycle.sessionKey) : ''), runRegistry.current);
      const lifecycleChanged = Boolean(lifecycle && runRegistry.current.observePhase(lifecycle.sessionKey, lifecycle.phase, lifecycle.runId, lifecycle));
      if (lifecycleChanged && lifecycle) {
        persistRuns(); publishSelectedRun(lifecycle.sessionKey);
        updateSessionMessages(lifecycle.sessionKey, current => reconcileAuthoritativeActiveRunLifecycle(current, lifecycle.sessionKey, runRegistry.current.runFor(lifecycle.sessionKey)));
      }
      const rawProjection = projectRegisteredGatewayEvent(frame, projectsRef.current);
      const projection = delegatedFailure && rawProjection && (rawProjection.message.role === 'error' || rawProjection.message.role === 'run')
        ? { ...rawProjection, message: { ...rawProjection.message, role: 'run' as const, text: delegatedFailure.detail, state: 'streaming' as const } }
        : rawProjection;
      const silentTerminal = Boolean(lifecycle?.phase === 'completed' && gatewayFrameHasSilentAssistant(frame));
      if (silentTerminal && lifecycle?.runId) {
        retainSilentTerminalRun(silentTerminalRuns.current, recoveryTasks.current, lifecycle.sessionKey, lifecycle.runId);
        if (pendingFinalAnswers.current.settle(lifecycle.sessionKey, lifecycle.runId)) persistPendingFinalAnswers();
      }
      if (projection?.message.runId && hasRenderedAssistantFinalForRun([projection.message], projection.message.runId) && pendingFinalAnswers.current.settle(projection.sessionKey, projection.message.runId)) persistPendingFinalAnswers();
      const incompleteTerminal = Boolean(lifecycle?.phase === 'completed'
        && lifecycle.sessionKey === selectedRef.current
        && rawProjection?.message.role !== 'assistant'
        && runHasExpiredApproval(messagesRef.current, lifecycle.sessionKey, lifecycle.runId)
        && !hasRenderedAssistantFinalForRun(messagesRef.current, lifecycle.runId));
      if (incompleteTerminal && lifecycle) {
        runRegistry.current.markIncompleteRun(lifecycle.sessionKey, lifecycle.runId, lifecycle);
        persistRuns(); publishSelectedRun(lifecycle.sessionKey);
      }
      const projectedMessage = projection ? client.decorateMessages([projection.message], projection.sessionKey)[0] ?? projection.message : null;
      scheduleSharedNarrationRefresh(narrationRefreshTimers.current, projectedMessage, projection?.sessionKey ?? '', refreshSharedNarration, (error) => {
        if (gatewayAllowsLivePublication(appActive.current, suspendedByBackground.current)) setDetail(guardedBackgroundTaskDetail(error, 'shared narration refresh failed'));
      });
      if (projectedMessage) pendingLiveMessages.current.enqueue(projectedMessage);
      const lifecycleHasRegisteredOwner = Boolean(lifecycle && projectsRef.current.some((project) => project.sessionKey === lifecycle.sessionKey));
      const terminalPhase = incompleteTerminal ? 'failed' as const : lifecycle && lifecycleHasRegisteredOwner && (lifecycle.phase === 'completed' || lifecycle.phase === 'failed') ? lifecycle.phase : null;
      const terminal = terminalPhase === 'completed';
      const terminalSessionKey = terminalPhase ? lifecycle!.sessionKey : '';
      const terminalRunId = terminalPhase ? lifecycle!.runId : '';
      const publicationSessionKey = projection?.sessionKey ?? (terminalPhase ? lifecycle!.sessionKey : '');
      const terminalLifecycle = Boolean(lifecycle && (lifecycle.phase === 'completed' || lifecycle.phase === 'failed'));
      const publicationMode = liveMessagePublicationMode(projectedMessage, Boolean(terminalPhase));
      const flushLiveMessages = (urgent = false) => {
        livePublicationTimers.current.cancel(publicationSessionKey);
        const ownedPending = pendingLiveMessages.current.drainSession(publicationSessionKey);
        if (!ownedPending.length && !terminalPhase) return;
        const publish = () => updateSessionMessages(publicationSessionKey, (current) => {
          const ownedRows = ownedPending.filter(message => message.role !== 'run' || !message.runId || runRegistry.current.ownsRun(publicationSessionKey, message.runId));
          let next = ownedRows.reduce(upsertLiveMessage, current);
          if (terminalPhase) next = settleRunToolMessages(next, terminalSessionKey, terminalRunId, terminalPhase);
          if (incompleteTerminal) next = reconcileCompletedRunMessage(next, incompleteApprovalRunMessage(terminalSessionKey, terminalRunId, runRegistry.current.elapsedMsFor(terminalSessionKey, terminalRunId)));
          if (terminal) next = !hasRenderedAssistantFinalForRun(next, terminalRunId)
            ? silentTerminal ? removeUnansweredRunLifecycle(next, terminalSessionKey, terminalRunId) : reconcileOwnedPendingFinal(next, terminalSessionKey, terminalRunId, runRegistry.current.ownsRun(terminalSessionKey, terminalRunId))
            : reconcileCompletedRunMessage(next, completedRunMessage(terminalSessionKey, terminalRunId, runRegistry.current.elapsedMsFor(terminalSessionKey, terminalRunId)));
          return latestPresentationWindow(next);
        });
        if (urgent) publish(); else startTransition(publish);
      };
      if (publicationMode === 'flush') flushLiveMessages(Boolean(projectedMessage && requiresImmediateLivePublication(projectedMessage)));
      else if (publicationMode === 'schedule' && projectedMessage) livePublicationTimers.current.schedule(publicationSessionKey, liveMessagePublicationDelayMs(projectedMessage), () => flushLiveMessages(), () => {
        if (gatewayAllowsLivePublication(appActive.current, suspendedByBackground.current)) setDetail('live transcript publication failed; canonical history will recover it');
      });
      if (terminal && !silentTerminal && !incompleteTerminal && rawProjection?.message.role !== 'assistant' && !hasRenderedAssistantFinalForRun(messagesRef.current, terminalRunId)) {
        pendingFinalAnswers.current.register(terminalSessionKey, terminalRunId); persistPendingFinalAnswers(); startFinalAnswerRecovery(terminalSessionKey, terminalRunId);
      }
      const intent = refreshIntentForGatewayEvent(frame, selectedRef.current);
      if (intent.detail && (!projectedMessage || terminal || lifecycleChanged || requiresImmediateLivePublication(projectedMessage))) setDetail(intent.detail);
      refreshBatch.current.schedule(intent, selectedRef.current, terminalLifecycle, () => {
        const key = selectedRef.current;
        const plan = refreshBatch.current.take(key, Boolean(runRegistry.current.runFor(key)));
        if (plan.refreshHistory) void loadHistory(key, 'preserve-review', plan.requiredHistorySessionKey === key);
        if (plan.refreshSessions) void loadSessions(plan.refreshRegistry, '', false, plan.refreshHistory ? '' : plan.requiredHistorySessionKey);
      });
    };
    const appStateSubscription = AppState.addEventListener('change', (next) => {
      appActive.current = next === 'active';
      setWorkspacePersistenceActive(appActive.current);
      const action = gatewayAppLifecycleAction(next, suspendedByBackground.current);
      if (action === 'suspend') {
        suspendedByBackground.current = true;
        scenePublicationAuthority.current.suspend();
        suspendHistoryPublication();
        mediaScenePublicationAuthority.suspend();
        registryRetryOwner.current.suspend();
        clearReconnectTimer();
        refreshBatch.current.clear();
        suspendLiveMessagePublication(livePublicationTimers.current, narrationRefreshTimers.current, pendingLiveMessages.current);
        connectionTask.current = null;
        client.disconnect();
      } else if (action === 'resume') {
        suspendedByBackground.current = false;
        scenePublicationAuthority.current.resume();
        resumeHistoryPublication();
        mediaScenePublicationAuthority.resume();
        resumePersistedWorkspace();
        const target = profileRef.current;
        if (target && reconnectEnabled.current) void establishConnection(target).catch(() => undefined);
      } else if (appActive.current) scheduleReconnect(true);
      else clearReconnectTimer();
    });
    return () => {
      appStateSubscription.remove();
    };
  }, [client, establishConnection, loadHistory, loadSessions, retireSessionRefresh, persistPendingFinalAnswers, persistRuns, publishSelectedRun, recordLocalInteraction, refreshSharedNarration, resumeHistoryPublication, resumePersistedWorkspace, sessionMessages, settleVisibleCompletion, startFinalAnswerRecovery, suspendHistoryPublication, updateSessionMessages]);
  useGatewayWorkspaceUnmount({ client, scenePublicationAuthority, reconnectEnabled, registryRetryOwner, refreshBatch, reconnectTimer, livePublicationTimers, narrationRefreshTimers, pendingLiveMessages, suspendHistoryPublication });
  const pair = useCallback(async (raw: string) => {
    const parsed = parseSetupCode(raw);
    if (!parsed) throw new Error('Use an OpenClaw setup code, WSS URL, or private-network WS address.');
    retireSessionRefresh(); questions.clear(); asyncQuestions.clear(); registryRetryOwner.current.suspend(); registrySnapshot.current = null; setProjectsReady(false); reconnectLadder.current.reset();
    profileRef.current = parsed; reconnectEnabled.current = true;
    setProfile(parsed);
    await reattachSharedPairing();
    await SecureStore.setItemAsync(PROFILE_KEY, JSON.stringify(parsed), { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
    setDetail('profile saved');
    return parsed;
  }, [retireSessionRefresh]);

  const connect = useCallback(async (override?: GatewayProfile) => {
    const target = override ?? profile;
    if (!target) throw new Error('Pair a gateway first.'); reconnectLadder.current.reset();
    await establishConnection(target);
  }, [establishConnection, profile]);

  const forget = useCallback(async () => {
    registryRetryOwner.current.suspend(); reconnectLadder.current.reset();
    reconnectEnabled.current = false; profileRef.current = null; runRegistry.current.clear(); persistRuns(); recoveryTasks.current.clear(); finalAnswerRecoveryTasks.current.clear(); pendingFinalAnswers.current.restore(null); persistPendingFinalAnswers();
    if (reconnectTimer.current) { clearTimeout(reconnectTimer.current); reconnectTimer.current = null; }
    client.disconnect(); questions.clear(); asyncQuestions.clear();
    await SecureStore.deleteItemAsync(PROFILE_KEY);
    await SecureStore.deleteItemAsync(LEGACY_LAB_PROFILE_KEY);
    await resetLocalDeviceIdentityIfSimulator();
    await detachSharedPairing();
    const offlineKey = offlineProjects[0]?.sessionKey ?? '';
    registrySnapshot.current = null; resetHistory(offlineProjects[0], null, startupMessages);
    const offlineProjectID = offlineProjects[0]?.id ?? ''; selectedRef.current = offlineKey; selectedProjectIDRef.current = offlineProjectID; setSelectedKey(offlineKey);
    persistWorkspaceSelection(offlineKey, offlineProjectID);
    setProfile(null); setProjectsReady(false); setProjects(offlineProjects); setStatus('idle'); setDetail('offline'); setSending(false);
  }, [client, persistPendingFinalAnswers, persistRuns, resetHistory]);
  const selectProject = useCallback((sessionKey: string) => {
    if (!scenePublicationAuthority.current.isActive) return;
    const activityRevision = scenePublicationAuthority.current.capture();
    const connectionRevision = client.connectionRevision;
    const shouldReset = shouldResetHistoryForSelection(selectedRef.current, sessionKey);
    livePublicationTimers.current.cancelAll(); flushBufferedLiveMessages(pendingLiveMessages.current, updateSessionMessages);
    narrationRefreshTimers.current.cancelAll();
    const readProject = projects.find((project) => project.sessionKey === sessionKey);
    const readGeneration = JSON.stringify(gatewaySessionGeneration(readProject, registrySnapshot.current));
    const ownsReadGeneration = () => readGeneration === JSON.stringify(gatewaySessionGeneration(projectsRef.current.find(project => project.sessionKey === sessionKey), registrySnapshot.current));
    const selectedProjectID = readProject?.id ?? ''; selectedRef.current = sessionKey; selectedProjectIDRef.current = selectedProjectID; setSelectedKey(sessionKey); publishSelectedRun(sessionKey);
    acknowledgeSelectedSessionRead(client, readProject, () => scenePublicationAuthority.current.owns(activityRevision) && client.connectionRevision === connectionRevision && selectedRef.current === sessionKey && ownsReadGeneration(), () => loadSessions(), () => setDetail('read acknowledgement failed; reopen thread to retry'));
    attentionLedger.current.clearUnread(sessionKey); launchGuardedBackgroundTask(() => saveValue(WORKSPACE_ATTENTION_KEY, attentionLedger.current.serialized()));
    setProjects((current) => current.map((project) => project.sessionKey === sessionKey && project.unread ? { ...project, unread: false } : project));
    const historyPresentation = shouldReset ? resetHistory(readProject, registrySnapshot.current) ?? 'reveal-current' : 'reveal-current';
    persistWorkspaceSelection(sessionKey, selectedProjectID);
    if (client.status === 'connected') {
      void refreshRunTruth(sessionKey, false, ownsReadGeneration).catch((error: unknown) => {
        if (scenePublicationAuthority.current.owns(activityRevision) && client.connectionRevision === connectionRevision && sessionOwnsDetailPublication(sessionKey, selectedRef.current)) setDetail(error instanceof Error ? error.message : 'run state refresh failed');
      });
      if (shouldReset) void (async () => {
        await loadHistory(sessionKey, historyPresentation);
        if (!scenePublicationAuthority.current.owns(activityRevision) || selectedRef.current !== sessionKey) return;
        await loadPendingApprovals(sessionKey);
        if (scenePublicationAuthority.current.owns(activityRevision) && selectedRef.current === sessionKey) recoverPendingFinalAnswers();
      })().catch((error: unknown) => {
        if (scenePublicationAuthority.current.owns(activityRevision) && client.connectionRevision === connectionRevision && sessionOwnsDetailPublication(sessionKey, selectedRef.current)) setDetail(error instanceof Error ? error.message : 'session subscription failed');
      });
    }
  }, [client, loadHistory, loadPendingApprovals, loadSessions, projects, publishSelectedRun, recoverPendingFinalAnswers, refreshRunTruth, resetHistory, updateSessionMessages]);
  const toggleStar = useCallback((sessionKey: string) => {
    const selected = projects.find((project) => project.sessionKey === sessionKey);
    if (!selected) return;
    const next = updatedStarOverrides(starOverrides.current, selected);
    starOverrides.current = next;
    setProjects((current) => applyStarOverrides(current, next));
    launchGuardedBackgroundTask(() => saveValue(STARRED_SESSION_KEYS, JSON.stringify(next)));
  }, [projects]);

  const reconnect = useCallback(async () => { const target = profileRef.current; if (!target) throw new Error('No paired Gateway is saved.'); reconnectLadder.current.reset(); client.disconnect(); connectionTask.current = null; await establishConnection(target); }, [client, establishConnection]);

  const acceptThreadRegistryMutation = useGatewayThreadRegistryMutation({ projectsRef, registrySnapshot, selectedRef, selectedProjectIDRef, activityLedger, attentionLedger, starOverrides, runRegistry, setProjects, setProjectsReady, setSelectedKey, resetHistory, publishSelectedRun });

  const decideApproval = useGatewayApprovalDecision({ client, selectedRef, runRegistry, updateSessionMessages, loadPendingApprovals, persistRuns, publishSelectedRun, setDetail, scenePublicationAuthority });
  const submit = useGatewaySubmission({ client, status, commands, projects, messages, selectedRef, registrySnapshot, runRegistry, setDetail, updateSessionMessages, preparePromptSubmission, publishSelectedRun, persistRuns, loadHistory, loadPendingApprovals, decideApproval, loadSessions, acceptThreadRegistryMutation, startRunMonitor, reconnect, repair: forget, recordLocalInteraction, scenePublicationAuthority, queuedPrompts, rejectPromptSubmission });

  asyncSubmit.current = submit; const abort = useGatewayAbort(client, selectedRef, runRegistry, scenePublicationAuthority, setDetail, publishSelectedRun);

  const fileLocations = useGatewayFileLocations(client); const recoverMessage = useGatewayMessageRecovery({ client, selectedRef, messagesRef, messageSessionKey, projectsRef, updateSessionMessages, setDetail, scenePublicationAuthority }); const listProjectFiles = useCallback((projectId: string, path = '') => client.listProjectFiles(projectId, path), [client]); const readProjectFile = useCallback((projectId: string, path: string) => client.readProjectFile(projectId, path), [client]); const resolveSharedFile = useCallback((sourcePath: string) => client.resolveSharedFile(sourcePath), [client]); const listSharedFiles = useCallback((projectId: string, path = '') => client.listSharedFiles(projectId, path), [client]); const readSharedFile = useCallback((projectId: string, path: string) => client.readSharedFile(projectId, path), [client]);
  const refresh = useCallback(() => Promise.all([loadSessions(true, '', true), providerUsage.refresh()]).then(() => undefined), [loadSessions, providerUsage]);
  return { queuedPrompts, asyncQuestions, questions: questions.ui, questionNotice: questions.notice, ...fileLocations, hasNewerHistory, resolveArtifact: client.resolveArtifact, listProjectFiles, readProjectFile, resolveSharedFile, listSharedFiles, readSharedFile, profile, status, detail, projects: questions.projects, projectsReady, selectedKey, latestMessages, messages: questions.messages, messageSessionKey, commands, modelChoices, sending, loadingOlder, canLoadOlder, historyProblem, providerUsage: providerUsage.state, refreshProviderUsage: providerUsage.refresh, pair, connect, forget, selectProject, toggleStar, submit, abort, decideApproval, recoverMessage, loadOlderHistory, loadNewerHistory, retryHistory, restoreLatestHistory, refresh };
}
