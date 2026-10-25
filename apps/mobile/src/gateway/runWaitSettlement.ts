import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import type { AgentWaitResult } from './OpenClawClient';
import { failedRunMessage, reconcileCompletedRunMessage } from './runCompletionMessage';
import { runPhaseForWaitResult, runTerminalDetail } from './runLifecycle';
import { settleRunToolMessages } from './runToolSettlement';

/**
 * A definitive failed agent.wait result is authoritative even when OpenClaw
 * emits no matching live error frame. Keep that fact beside the accepted turn
 * instead of exposing it only through the transient footer.
 */
export function reconcileFailedRunWait(
  messages: WorkspaceMessage[],
  sessionKey: string,
  runId: string,
  result: AgentWaitResult,
  elapsedMs: number,
) {
  if (runPhaseForWaitResult(result) !== 'failed') return messages;
  const settled = settleRunToolMessages(messages, sessionKey, runId, 'failed');
  return reconcileCompletedRunMessage(
    settled,
    failedRunMessage(sessionKey, runId, elapsedMs, runTerminalDetail(result)),
  );
}
