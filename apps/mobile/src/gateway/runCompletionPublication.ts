import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { incompleteApprovalRunMessage } from './approvalFinalization';
import { completedRunMessage, hasRenderedAssistantFinalForRun, reconcileCompletedRunMessage, reconcileOwnedPendingFinal, removeUnansweredRunLifecycle } from './runCompletionMessage';
import { settleRunToolMessages } from './runToolSettlement';

/** Caller samples registry ownership inside its React publication updater. */
export function reconcileVisibleRunCompletion(current: WorkspaceMessage[], sessionKey: string, runId: string,
  state: { incomplete: boolean; awaitingFinal: boolean; ownsRun: boolean; elapsedMs: number }) {
  const settled = settleRunToolMessages(current, sessionKey, runId, 'completed');
  if (state.incomplete) return reconcileCompletedRunMessage(settled, incompleteApprovalRunMessage(sessionKey, runId, state.elapsedMs));
  if (!hasRenderedAssistantFinalForRun(settled, runId)) return state.awaitingFinal
    ? reconcileOwnedPendingFinal(settled, sessionKey, runId, state.ownsRun)
    : removeUnansweredRunLifecycle(settled, sessionKey, runId);
  return reconcileCompletedRunMessage(settled, completedRunMessage(sessionKey, runId, state.elapsedMs));
}
