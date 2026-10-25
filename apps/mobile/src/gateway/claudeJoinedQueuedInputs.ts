import type { WorkspaceMessage } from '../workspace/workspaceTypes';

/**
 * Claude Code joins inputs queued during its turn into one native user message.
 * Each input keeps its own positioned row at its send position, so the joined
 * copy is dropped when every prompt it holds is one of those earlier rows.
 */
export function withoutJoinedQueuedInputs(rows: WorkspaceMessage[], joinedPrompts: Map<WorkspaceMessage, string[]>) {
  if (!joinedPrompts.size) return rows;
  return rows.filter((row) => {
    const prompts = joinedPrompts.get(row);
    if (!prompts || row.cliProvenance?.kind !== 'claude-native' || row.displayPosition) return true;
    const at = Number(row.timestamp);
    const claimed = new Set<WorkspaceMessage>();
    return !prompts.every((prompt) => {
      const input = rows.find((candidate) => !claimed.has(candidate) && candidate.role === 'user' && candidate.displayPosition
        && candidate.cliProvenance?.kind !== 'claude-native' && candidate.text === prompt
        && candidate.transcriptSessionId === row.transcriptSessionId && Number(candidate.timestamp) <= at);
      if (input) claimed.add(input);
      return Boolean(input);
    });
  });
}
