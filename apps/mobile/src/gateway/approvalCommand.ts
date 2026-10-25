import type { ApprovalDecision, WorkspaceMessage } from '../workspace/workspaceTypes';

export type ApprovalCommandResolution = { message: WorkspaceMessage; decision: ApprovalDecision };

export function approvalCommandResolution(command: ':approve' | ':deny', argumentsInput: string, messages: WorkspaceMessage[], sessionKey: string): ApprovalCommandResolution {
  const pending = messages.filter((message) => sessionKey && message.sessionKey === sessionKey && message.approval && !message.approval.resolved);
  const parts = argumentsInput.trim().split(/\s+/).filter(Boolean);
  const alwaysIndex = parts.findIndex((part) => ['always', 'allow-always'].includes(part.toLocaleLowerCase()));
  const identifier = parts.filter((_, index) => index !== alwaysIndex).join(' ');
  const matches = identifier
    ? pending.filter((message) => message.approval?.id === identifier || message.approval?.id.startsWith(identifier))
    : pending;
  if (!matches.length) throw new Error(identifier ? `No pending approval matches ${identifier}.` : 'No pending approvals.');
  if (matches.length !== 1) throw new Error(identifier ? `${identifier} matches more than one pending approval; type a longer id.` : 'More than one approval is pending; provide its id.');
  const message = matches[0]!;
  const decision: ApprovalDecision = command === ':deny' ? 'deny' : alwaysIndex >= 0 ? 'allow-always' : 'allow-once';
  if (!message.approval!.allowedDecisions.includes(decision)) throw new Error(`${decision} is not allowed for approval ${message.approval!.id}.`);
  return { message, decision };
}
