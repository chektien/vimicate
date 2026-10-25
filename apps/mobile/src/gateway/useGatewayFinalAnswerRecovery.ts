import { useCallback, type SetStateAction } from 'react';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import type { OpenClawClient } from './OpenClawClient';
import { completedRunMessage, hasRenderedAssistantFinalForRun, reconcileOwnedPendingFinal, reconcileCompletedRunMessage } from './runCompletionMessage';
import type { SessionRunMonitorOwners } from './sessionRunMonitorOwners';
import type { SessionRunRegistry } from './sessionRunRegistry';
import { FINAL_ANSWER_RECOVERY_DELAYS_MS, FINAL_ANSWER_STEADY_RECOVERY_DELAY_MS, type PendingFinalAnswerRegistry } from './pendingFinalAnswerRegistry';
import { sessionOwnsDetailPublication } from './sessionPublicationOwnership';
import { guardedBackgroundTaskDetail, launchGuardedBackgroundTask } from '../async/guardedBackgroundTask';
import { pollForFinalAnswer } from './finalAnswerRecoveryPolling';
import type { HistoryPublicationAuthority } from './historyPublicationAuthority';

type FinalAnswerRecoveryDependencies = {
  client: OpenClawClient;
  selectedRef: { current: string };
  runRegistry: { current: SessionRunRegistry };
  pendingFinalAnswers: { current: PendingFinalAnswerRegistry };
  recoveryTasks: { current: SessionRunMonitorOwners };
  hasPublishedFinalForRun: (sessionKey: string, runId: string) => boolean;
  loadHistory: (sessionKey: string) => Promise<WorkspaceMessage[] | undefined>;
  updateSessionMessages: (sessionKey: string, action: SetStateAction<WorkspaceMessage[]>) => void;
  persistPendingFinalAnswers: () => void;
  persistRuns: () => void;
  publishSelectedRun: (sessionKey?: string) => void;
  setDetail: (detail: string) => void;
  scenePublicationAuthority: { current: HistoryPublicationAuthority };
};

export function useGatewayFinalAnswerRecovery(dependencies: FinalAnswerRecoveryDependencies) {
  const { client, selectedRef, runRegistry, pendingFinalAnswers, recoveryTasks, hasPublishedFinalForRun, loadHistory, updateSessionMessages, persistPendingFinalAnswers, persistRuns, publishSelectedRun, setDetail, scenePublicationAuthority } = dependencies;
  const startFinalAnswerRecovery = useCallback((sessionKey: string, runId: string) => {
    if (!sessionKey || !runId || !scenePublicationAuthority.current.isActive || !pendingFinalAnswers.current.owns(sessionKey, runId)) return;
    const activityRevision = scenePublicationAuthority.current.capture();
    // Pending runs are independent durable facts, but all consume the same
    // session history. One session ticket owns one timer and request cadence;
    // new pending runs join it without resetting or multiplying that cadence.
    const recoveryKey = sessionKey;
    const owner = recoveryTasks.current.claim(recoveryKey, sessionKey, scenePublicationAuthority.current.signal); if (!owner) return;
    const pendingRuns = () => pendingFinalAnswers.current.entries().filter(pending => pending.sessionKey === sessionKey);
    const ownsTask = () => scenePublicationAuthority.current.owns(activityRevision)
      && recoveryTasks.current.owns(recoveryKey, owner);
    launchGuardedBackgroundTask(async () => {
      try {
        const stillOwnsRecovery = () => client.status === 'connected'
          && ownsTask()
          && selectedRef.current === sessionKey
          && pendingRuns().length > 0;
        await pollForFinalAnswer({
          fastDelaysMs: FINAL_ANSWER_RECOVERY_DELAYS_MS,
          steadyDelayMs: FINAL_ANSWER_STEADY_RECOVERY_DELAY_MS,
          wait: (milliseconds) => recoveryTasks.current.wait(recoveryKey, owner, milliseconds),
          shouldContinue: stillOwnsRecovery,
          load: async () => (await loadHistory(sessionKey)) ?? [],
          isFinal: (latest) => {
            for (const pending of pendingRuns()) {
              const pendingRunId = pending.runId;
              if (!hasRenderedAssistantFinalForRun(latest, pendingRunId) && !hasPublishedFinalForRun(sessionKey, pendingRunId)) continue;
              pendingFinalAnswers.current.settle(sessionKey, pendingRunId); persistPendingFinalAnswers();
              // An older final cannot replace the session's newer lifecycle.
              if (runRegistry.current.ownsRun(sessionKey, pendingRunId)) runRegistry.current.observePhase(sessionKey, 'completed', pendingRunId);
              updateSessionMessages(sessionKey, current => reconcileCompletedRunMessage(current, completedRunMessage(sessionKey, pendingRunId, runRegistry.current.elapsedMsFor(sessionKey, pendingRunId))));
              persistRuns(); publishSelectedRun(sessionKey);
              if (sessionOwnsDetailPublication(sessionKey, selectedRef.current)) setDetail('delayed final answer recovered');
            }
            return pendingRuns().length === 0;
          },
          onFastPathExhausted: () => {
            if (!stillOwnsRecovery()) return;
            const pending = pendingRuns();
            for (const entry of pending) pendingFinalAnswers.current.markExhausted(sessionKey, entry.runId);
            persistPendingFinalAnswers();
            // Only the tracked run owns a pending notice. Quiet older facts
            // continue to be checked by this same session poll.
            const tracked = pending.find(entry => runRegistry.current.ownsRun(sessionKey, entry.runId));
            if (!tracked) return;
            updateSessionMessages(sessionKey, (current) => reconcileOwnedPendingFinal(current, sessionKey, tracked.runId, runRegistry.current.ownsRun(sessionKey, tracked.runId)));
            persistRuns(); publishSelectedRun(sessionKey);
            if (sessionOwnsDetailPublication(sessionKey, selectedRef.current)) setDetail('final answer delayed; continuing source confirmation');
          },
          onLoadFailure: (error) => {
            if (stillOwnsRecovery() && sessionOwnsDetailPublication(sessionKey, selectedRef.current)) setDetail(guardedBackgroundTaskDetail(error, 'final answer history retry failed; continuing confirmation'));
          },
        });
      } catch (error) {
        if (ownsTask() && sessionOwnsDetailPublication(sessionKey, selectedRef.current)) setDetail(guardedBackgroundTaskDetail(error, 'final answer recovery failed; run state retained'));
      } finally {
        recoveryTasks.current.release(recoveryKey, owner);
      }
    });
  }, [client, hasPublishedFinalForRun, loadHistory, pendingFinalAnswers, persistPendingFinalAnswers, persistRuns, publishSelectedRun, recoveryTasks, runRegistry, scenePublicationAuthority, selectedRef, setDetail, updateSessionMessages]);

  const recoverPendingFinalAnswers = useCallback(() => {
    const pending = pendingFinalAnswers.current.entries().find(entry => entry.sessionKey === selectedRef.current);
    if (pending) startFinalAnswerRecovery(pending.sessionKey, pending.runId);
  }, [pendingFinalAnswers, selectedRef, startFinalAnswerRecovery]);

  return { startFinalAnswerRecovery, recoverPendingFinalAnswers };
}
