import { useCallback, type SetStateAction } from 'react';
import type { ApprovalDecision, WorkspaceMessage } from '../workspace/workspaceTypes';
import { approvalDecisionAction, approvalDecisionFailureAction, messageAfterApprovalDecisionFailure } from './approvalFinalization';
import type { OpenClawClient } from './OpenClawClient';
import type { SessionRunRegistry } from './sessionRunRegistry';
import { sessionOwnsDetailPublication } from './sessionPublicationOwnership';
import type { HistoryPublicationAuthority } from './historyPublicationAuthority';

type ApprovalDecisionDependencies = {
  client: OpenClawClient;
  selectedRef: { current: string };
  runRegistry: { current: SessionRunRegistry };
  updateSessionMessages: (sessionKey: string, action: SetStateAction<WorkspaceMessage[]>) => void;
  loadPendingApprovals: (sessionKey?: string) => Promise<void>;
  persistRuns: () => void;
  publishSelectedRun: (sessionKey?: string) => void;
  setDetail: (detail: string) => void;
  scenePublicationAuthority: { current: HistoryPublicationAuthority };
};

export type ApprovalDecisionHandler = (message: WorkspaceMessage, decision: ApprovalDecision) => Promise<boolean>;

export function useGatewayApprovalDecision({ client, selectedRef, runRegistry, updateSessionMessages, loadPendingApprovals, persistRuns, publishSelectedRun, setDetail, scenePublicationAuthority }: ApprovalDecisionDependencies): ApprovalDecisionHandler {
  return useCallback(async (message: WorkspaceMessage, decision: ApprovalDecision) => {
    const approval = message.approval;
    if (!approval || approval.resolved || client.status !== 'connected' || !scenePublicationAuthority.current.isActive) return false;
    const sessionKey = message.sessionKey;
    if (!sessionKey?.trim() || !approval.id.trim()) {
      setDetail('approval identity unavailable; refresh approvals'); return false;
    }
    if (!approval.allowedDecisions.includes(decision)) {
      if (sessionOwnsDetailPublication(sessionKey, selectedRef.current)) setDetail('approval decision unavailable; refresh approvals');
      return false;
    }
    const activityRevision = scenePublicationAuthority.current.capture();
    try {
      if (sessionOwnsDetailPublication(sessionKey, selectedRef.current)) setDetail(`approval: ${decision}`);
      await client.resolveApproval(approval.kind, approval.id, decision);
    } catch (error) {
      if (!scenePublicationAuthority.current.owns(activityRevision)) return false;
      const failed = messageAfterApprovalDecisionFailure(message, error);
      if (failed !== message) {
        updateSessionMessages(sessionKey, approvalDecisionFailureAction(message, error));
        if (message.runId) runRegistry.current.markRunUncertain(sessionKey, message.runId);
        persistRuns(); publishSelectedRun(sessionKey);
      }
      if (sessionOwnsDetailPublication(sessionKey, selectedRef.current)) setDetail(error instanceof Error ? error.message : 'approval failed');
      return false;
    }
    if (!scenePublicationAuthority.current.owns(activityRevision)) return false;
    updateSessionMessages(sessionKey, approvalDecisionAction(message, decision));
    // A refresh failure is not a failure of the decision already accepted.
    try { await loadPendingApprovals(sessionKey); }
    catch (error) {
      if (scenePublicationAuthority.current.owns(activityRevision) && sessionOwnsDetailPublication(sessionKey, selectedRef.current)) {
        setDetail(`approval ${decision} accepted; refresh failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      }
    }
    return scenePublicationAuthority.current.owns(activityRevision);
  }, [client, loadPendingApprovals, persistRuns, publishSelectedRun, runRegistry, scenePublicationAuthority, selectedRef, setDetail, updateSessionMessages]);
}
