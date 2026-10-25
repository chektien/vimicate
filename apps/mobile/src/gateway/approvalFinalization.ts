import type { ApprovalDecision, WorkspaceMessage } from '../workspace/workspaceTypes';
import { runLifecycleMessageID, runElapsedDescription } from './runCompletionMessage';
import { convergedLiveMessage } from './liveMessageConvergence';

export type ApprovalReconciliation = {
  messages: WorkspaceMessage[];
  expiredRunIds: string[];
};

export function reconcileApprovalAbsence(
  current: WorkspaceMessage[],
  pending: WorkspaceMessage[],
  sessionKey: string,
  nowMs = Date.now(),
  candidateApprovalIds?: ReadonlySet<string>,
): ApprovalReconciliation {
  const pendingIds = new Set(pending.map((message) => message.approval?.id).filter(Boolean));
  const expiredRunIds = new Set<string>();
  const settled = current.map((message) => {
    const approval = message.approval;
    if (!approval || approval.resolved || message.sessionKey !== sessionKey || pendingIds.has(approval.id)
      || (candidateApprovalIds && !candidateApprovalIds.has(approval.id))) return message;
    const expired = approval.expiresAtMs !== undefined && approval.expiresAtMs <= nowMs;
    if (expired && message.runId) expiredRunIds.add(message.runId);
    return {
      ...message,
      text: expired ? 'approval expired · run outcome unconfirmed' : 'approval resolved on another surface · refreshing run outcome',
      state: expired ? 'error' as const : 'complete' as const,
      approval: {
        ...approval,
        allowedDecisions: [],
        resolved: true,
        outcome: expired ? 'expired' as const : 'resolved-externally' as const,
      },
    };
  });
  return { messages: pending.reduce(upsertByIdentity, settled), expiredRunIds: [...expiredRunIds] };
}

/**
 * Reconcile an approval-list response against the transcript that exists when
 * React applies the update. The list request is asynchronous, so publishing
 * the preview's absolute message array can erase a live row queued after the
 * request began but before its response committed.
 */
export function approvalReconciliationAction(
  pending: WorkspaceMessage[],
  sessionKey: string,
  candidateApprovalIds: readonly string[],
  nowMs = Date.now(),
) {
  const candidates = new Set(candidateApprovalIds);
  return (current: WorkspaceMessage[]) => reconcileApprovalAbsence(current, pending, sessionKey, nowMs, candidates).messages;
}

export function approvalReconciliationCandidates(current: WorkspaceMessage[], sessionKey: string) {
  return current.flatMap((message) => message.sessionKey === sessionKey && message.approval && !message.approval.resolved
    ? [message.approval.id]
    : []);
}

export function messageAfterApprovalDecisionFailure(message: WorkspaceMessage, error: unknown) {
  if (!message.approval || message.approval.resolved || !approvalFailureMeansExpired(error)) return message;
  return {
    ...message,
    text: 'approval expired · run outcome unconfirmed',
    state: 'error' as const,
    approval: { ...message.approval, allowedDecisions: [], resolved: true, outcome: 'expired' as const },
  };
}

/** A late resolve failure may only revise the same still-unresolved approval. */
export function approvalDecisionFailureAction(message: WorkspaceMessage, error: unknown) {
  return approvalRowAction(message, candidate => messageAfterApprovalDecisionFailure(candidate, error));
}

export function approvalDecisionAction(message: WorkspaceMessage, decision: ApprovalDecision) {
  return approvalRowAction(message, candidate => candidate.approval!.resolved ? candidate : {
    ...candidate, text: `approval ${decision}`, state: 'complete',
    approval: { ...candidate.approval!, allowedDecisions: [], resolved: true, outcome: decision === 'deny' ? 'denied' : 'allowed' },
  });
}

function approvalRowAction(message: WorkspaceMessage, update: (candidate: WorkspaceMessage) => WorkspaceMessage) {
  return (current: WorkspaceMessage[]) => current.map(candidate => message.approval && message.sessionKey && candidate.id === message.id
    && candidate.sessionKey === message.sessionKey && candidate.runId === message.runId
    && candidate.approval?.id === message.approval?.id && candidate.approval?.kind === message.approval?.kind
    ? update(candidate) : candidate);
}

export function approvalFailureMeansExpired(error: unknown) {
  const detail = error instanceof Error ? error.message : String(error ?? '');
  return /(?:unknown|missing|invalid|expired).{0,40}approval|approval.{0,40}(?:unknown|missing|invalid|expired)/i.test(detail);
}

export function runHasExpiredApproval(messages: WorkspaceMessage[], sessionKey: string, runId: string) {
  return messages.some((message) => message.sessionKey === sessionKey
    && message.runId === runId
    && message.approval?.outcome === 'expired');
}

export function incompleteApprovalRunMessage(sessionKey: string, runId: string, elapsedMs: number): WorkspaceMessage {
  return {
    id: runLifecycleMessageID(sessionKey, runId),
    role: 'error',
    text: `● incomplete after ${runElapsedDescription(elapsedMs)} · approval expired before a final answer`,
    state: 'error',
    runId,
    sessionKey,
    source: 'live',
  };
}

function upsertByIdentity(messages: WorkspaceMessage[], message: WorkspaceMessage) {
  const index = messages.findIndex((candidate) => candidate.id === message.id);
  if (index < 0) return [...messages, message];
  return messages.map((candidate, candidateIndex) => candidateIndex === index ? convergedLiveMessage(candidate, message) : candidate);
}
