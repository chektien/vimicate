import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { transcriptInputReceiptRunId } from '../workspace/transcriptMetadata';

/** Attach lifecycle and accepted-input identities without conflating their authority. */
export function bindOptimisticPromptToRun(messages: WorkspaceMessage[], optimisticID: string, runId: string, inputReceiptRunId = '') {
  if (!optimisticID || !runId) return messages;
  const receipt = transcriptInputReceiptRunId(inputReceiptRunId);
  return messages.map((message) => message.id === optimisticID && message.role === 'user' && message.source === 'local'
    ? { ...message, runId, ...(receipt ? { inputReceiptRunId: receipt } : {}) }
    : message);
}
