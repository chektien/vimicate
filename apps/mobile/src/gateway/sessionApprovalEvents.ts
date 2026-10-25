import type { ApprovalDecision, WorkspaceMessage } from '../workspace/workspaceTypes';
import type { GatewayFrame } from './gatewayEvents';

const decisions = new Set<ApprovalDecision>(['allow-once', 'allow-always', 'deny']);
const statuses = new Set(['pending', 'allowed', 'denied', 'expired', 'cancelled']);
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const time = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 8.64e15;

/** The durable session stream has a different shape from legacy approval events. */
export function sessionApprovalMessage(frame: GatewayFrame, sessionKey: string): WorkspaceMessage | null {
  const payload = object(frame.payload);
  if (frame.event !== 'session.approval' || text(payload.sessionKey) !== sessionKey) return null;
  const approval = object(payload.approval);
  const presentation = object(approval.presentation);
  const id = text(approval.id), kind = presentation.kind, status = text(approval.status);
  if (!id || (kind !== 'exec' && kind !== 'plugin') || !statuses.has(status)
    || !time(approval.createdAtMs) || !time(approval.expiresAtMs) || approval.expiresAtMs < approval.createdAtMs) return null;
  const pending = status === 'pending';
  if (payload.phase !== (pending ? 'pending' : 'terminal')) return null;
  if (!pending && (!time(approval.resolvedAtMs) || approval.resolvedAtMs < approval.createdAtMs)) return null;
  if (status === 'allowed' && approval.decision !== 'allow-once' && approval.decision !== 'allow-always') return null;
  const offered = presentation.allowedDecisions;
  if (pending && (!Array.isArray(offered) || offered.length === 0 || offered.some(value => !decisions.has(value)))) return null;
  const allowedDecisions: ApprovalDecision[] = pending ? [...new Set(offered as ApprovalDecision[])] : [];
  const outcome = pending ? undefined : status === 'cancelled' ? 'resolved-externally' : status as 'allowed' | 'denied' | 'expired';
  const summary = text(presentation.description) || text(presentation.title) || 'Approval required';
  return {
    id: `live-approval-${id}`, role: 'approval', sessionKey, source: 'live',
    timestamp: new Date(approval.createdAtMs).toISOString(),
    text: pending ? summary : `${summary}\n${status === 'expired' ? 'Approval expired without an answer' : status === 'cancelled' ? 'Approval cancelled' : `Approval ${status}`}`,
    state: status === 'expired' || status === 'cancelled' ? 'error' : pending ? 'streaming' : 'complete',
    approval: { id, kind, allowedDecisions, resolved: !pending, expiresAtMs: approval.expiresAtMs, ...(outcome ? { outcome } : {}) },
  };
}

/** Replays are additive. Absence/truncation never resolves a live request. */
export function sessionApprovalReplayFrames(value: unknown, sessionKey: string): GatewayFrame[] {
  const replay = object(value);
  if (text(replay.sessionKey) !== sessionKey || !Array.isArray(replay.approvals) || replay.approvals.length > 1000) return [];
  return replay.approvals.flatMap(approval => {
    const frame = { type: 'event', event: 'session.approval', payload: { sessionKey, phase: 'pending', updatedAtMs: replay.updatedAtMs, approval } };
    return sessionApprovalMessage(frame, sessionKey) ? [frame] : [];
  });
}
