import type { WorkspaceMessage } from '../workspace/workspaceTypes';

export function settleRunToolMessages(
  messages: WorkspaceMessage[],
  sessionKey: string,
  runId: string,
  phase: 'completed' | 'failed',
): WorkspaceMessage[] {
  let changed = false;
  const next = messages.map((message) => {
    if (message.role !== 'tool' || message.state !== 'streaming' || message.sessionKey !== sessionKey || (runId && message.runId && message.runId !== runId)) return message;
    changed = true;
    return { ...message, state: phase === 'completed' ? 'complete' as const : 'error' as const };
  });
  return changed ? next : messages;
}
