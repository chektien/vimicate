import type { WorkspaceMessage } from '../workspace/workspaceTypes';

/** A bounded older-page read is justified only by concrete shared run identity. */
export function runMissingCanonicalPrompt(messages: WorkspaceMessage[]) {
  const seenUserRuns = new Set<string>();
  for (const message of messages) {
    if (message.role === 'user' && message.runId) seenUserRuns.add(message.runId);
    if (message.role === 'assistant' && message.runId && !seenUserRuns.has(message.runId)) return message.runId;
  }
  return '';
}

export function historyPageCompletesRun(messages: WorkspaceMessage[], runId: string) {
  return Boolean(runId && messages.some((message) => message.role === 'user' && message.runId === runId));
}
