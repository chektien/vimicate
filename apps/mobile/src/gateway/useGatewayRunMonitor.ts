import { useCallback, type SetStateAction } from 'react';
import { guardedBackgroundTaskDetail, launchGuardedBackgroundTask } from '../async/guardedBackgroundTask';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { hasRenderedAssistantFinalForRun } from './runCompletionMessage';
import { isRecoverableRunInterruption, runPhaseForWaitResult, runTerminalDetail, runTimingForWaitResult } from './runLifecycle';
import { reconcileFailedRunWait } from './runWaitSettlement';
import { runAnsweredBeforeFailure } from './answeredRunFailure';
import { waitForAuthoritativeRun } from './runWaitPolling';
import type { OpenClawClient } from './OpenClawClient';
import type { PendingFinalAnswerRegistry } from './pendingFinalAnswerRegistry';
import { sessionOwnsDetailPublication } from './sessionPublicationOwnership';
import type { SessionRunMonitorOwners } from './sessionRunMonitorOwners';
import type { SessionRunRegistry } from './sessionRunRegistry';
import { latestPresentationWindow } from './historyWindow';
import type { HistoryPublicationAuthority } from './historyPublicationAuthority';

type GatewayRunMonitorDependencies = {
  client: OpenClawClient;
  selectedRef: { current: string };
  runRegistry: { current: SessionRunRegistry };
  recoveryTasks: { current: SessionRunMonitorOwners };
  pendingFinalAnswers: { current: PendingFinalAnswerRegistry };
  silentTerminalRuns: { current: Set<string> };
  hasPublishedFinalForRun: (sessionKey: string, runId: string) => boolean;
  loadHistory: (sessionKey: string) => Promise<WorkspaceMessage[] | undefined>;
  updateSessionMessages: (sessionKey: string, action: SetStateAction<WorkspaceMessage[]>) => void;
  persistPendingFinalAnswers: () => void;
  persistRuns: () => void;
  publishSelectedRun: (sessionKey?: string) => void;
  settleVisibleCompletion: (sessionKey: string, runId: string, awaitingFinal?: boolean) => void;
  startFinalAnswerRecovery: (sessionKey: string, runId: string) => void;
  setDetail: (detail: string) => void;
  scenePublicationAuthority: { current: HistoryPublicationAuthority };
};

export function sessionRunIdentity(sessionKey: string, runId: string) {
  return `${sessionKey}\u0000${runId}`;
}

/** Silent completion is transient coordination for the one exact run monitor. */
export function retainSilentTerminalRun(
  silentTerminalRuns: Set<string>,
  recoveryTasks: SessionRunMonitorOwners,
  sessionKey: string,
  runId: string,
) {
  const runIdentity = sessionRunIdentity(sessionKey, runId);
  const sessionPrefix = `${sessionKey}\u0000`;
  for (const identity of silentTerminalRuns) {
    if (identity.startsWith(sessionPrefix) && identity !== runIdentity) silentTerminalRuns.delete(identity);
  }
  if (recoveryTasks.runFor(sessionKey) !== runId) {
    silentTerminalRuns.delete(runIdentity);
    return false;
  }
  silentTerminalRuns.add(runIdentity);
  return true;
}

export function useGatewayRunMonitor(dependencies: GatewayRunMonitorDependencies) {
  const { client, selectedRef, runRegistry, recoveryTasks, pendingFinalAnswers, silentTerminalRuns, hasPublishedFinalForRun, loadHistory, updateSessionMessages, persistPendingFinalAnswers, persistRuns, publishSelectedRun, settleVisibleCompletion, startFinalAnswerRecovery, setDetail, scenePublicationAuthority } = dependencies;

  const waitForRunCompletion = useCallback(async (acceptedRunId: string, sessionKey: string, activityRevision: number, ownsContinuation: () => boolean) => {
    const terminal = await waitForAuthoritativeRun({
      wait: () => client.waitForRun(acceptedRunId),
      isConnected: () => scenePublicationAuthority.current.owns(activityRevision) && client.status === 'connected',
      ownsRun: () => runRegistry.current.runFor(sessionKey) === acceptedRunId && ownsContinuation(),
      onWaiting: (observation) => {
        if (!ownsContinuation()) return;
        runRegistry.current.observePhase(sessionKey, 'waiting', acceptedRunId); publishSelectedRun(sessionKey);
        if (selectedRef.current === sessionKey) setDetail(observation?.timeoutPhase ? `running: ${observation.timeoutPhase}` : 'running: confirming completion');
      },
    });
    if (!ownsContinuation()) return;
    const phaseBeforeWaitSettled = runRegistry.current.phaseFor(sessionKey);
    if ((phaseBeforeWaitSettled === 'completed' || phaseBeforeWaitSettled === 'failed') && runRegistry.current.runFor(sessionKey) !== acceptedRunId) return;
    const settledPhase = runPhaseForWaitResult(terminal);
    const applied = runRegistry.current.observePhase(sessionKey, settledPhase, acceptedRunId, runTimingForWaitResult(terminal));
    if (applied) { persistRuns(); publishSelectedRun(sessionKey); if (selectedRef.current === sessionKey) setDetail(runTerminalDetail(terminal)); }
    let latest: WorkspaceMessage[] | undefined;
    try {
      latest = await loadHistory(sessionKey);
    } finally {
      // A late Gateway failure after the saved answer is not a crashed thread.
      if (settledPhase === 'failed' && ownsContinuation() && latest && runAnsweredBeforeFailure(latest, acceptedRunId)) {
        if (runRegistry.current.observePhase(sessionKey, 'completed', acceptedRunId)) { persistRuns(); publishSelectedRun(sessionKey); }
      } else if (settledPhase === 'failed' && ownsContinuation()) {
        updateSessionMessages(sessionKey, (current) => latestPresentationWindow(reconcileFailedRunWait(
          current, sessionKey, acceptedRunId, terminal, runRegistry.current.elapsedMsFor(sessionKey, acceptedRunId),
        )));
      }
    }
    if (!ownsContinuation()) return;
    if (settledPhase !== 'completed') return;
    const silent = silentTerminalRuns.current.delete(sessionRunIdentity(sessionKey, acceptedRunId));
    if (silent) settleVisibleCompletion(sessionKey, acceptedRunId);
    else if ((latest && hasRenderedAssistantFinalForRun(latest, acceptedRunId))
      || hasPublishedFinalForRun(sessionKey, acceptedRunId)) settleVisibleCompletion(sessionKey, acceptedRunId);
    else {
      pendingFinalAnswers.current.register(sessionKey, acceptedRunId); persistPendingFinalAnswers();
      settleVisibleCompletion(sessionKey, acceptedRunId, true); startFinalAnswerRecovery(sessionKey, acceptedRunId);
    }
  }, [client, hasPublishedFinalForRun, loadHistory, pendingFinalAnswers, persistPendingFinalAnswers, persistRuns, publishSelectedRun, runRegistry, scenePublicationAuthority, selectedRef, setDetail, settleVisibleCompletion, silentTerminalRuns, startFinalAnswerRecovery, updateSessionMessages]);

  const startRunMonitor = useCallback((acceptedRunId: string, sessionKey: string) => {
    if (!scenePublicationAuthority.current.isActive || !runRegistry.current.ownsRun(sessionKey, acceptedRunId)) return;
    const activityRevision = scenePublicationAuthority.current.capture();
    const owner = recoveryTasks.current.claim(sessionKey, acceptedRunId, scenePublicationAuthority.current.signal); if (!owner) return;
    const ownsContinuation = () => scenePublicationAuthority.current.owns(activityRevision)
      && recoveryTasks.current.owns(sessionKey, owner)
      && runRegistry.current.ownsRun(sessionKey, acceptedRunId);
    const task = waitForRunCompletion(acceptedRunId, sessionKey, activityRevision, ownsContinuation).catch((error: unknown) => {
      if (!ownsContinuation()) return;
      runRegistry.current.observePhase(sessionKey, 'uncertain', acceptedRunId);
      if (selectedRef.current === sessionKey) setDetail(isRecoverableRunInterruption(error)
        ? 'run interrupted; waiting to reconnect'
        : error instanceof Error ? `run state uncertain: ${error.message}` : 'run state uncertain');
      persistRuns(); publishSelectedRun(sessionKey);
    }).catch((error: unknown) => {
      if (ownsContinuation() && sessionOwnsDetailPublication(sessionKey, selectedRef.current)) setDetail(guardedBackgroundTaskDetail(error, 'run monitor failed; run state retained'));
    }).finally(() => {
      const publish = ownsContinuation();
      silentTerminalRuns.current.delete(sessionRunIdentity(sessionKey, acceptedRunId));
      recoveryTasks.current.release(sessionKey, owner);
      if (publish) publishSelectedRun(sessionKey);
    });
    launchGuardedBackgroundTask(() => task);
  }, [persistRuns, publishSelectedRun, recoveryTasks, runRegistry, scenePublicationAuthority, selectedRef, setDetail, waitForRunCompletion]);

  const recoverActiveRuns = useCallback(() => {
    if (client.status !== 'connected') return;
    for (const [sessionKey, acceptedRunId] of runRegistry.current.entries()) startRunMonitor(acceptedRunId, sessionKey);
    publishSelectedRun();
  }, [client, publishSelectedRun, runRegistry, startRunMonitor]);

  return { startRunMonitor, recoverActiveRuns };
}
