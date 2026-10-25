import { type WorkspaceMessage } from '../workspace/workspaceTypes';
import { messagesFromPayload } from '../workspace/historyMessageProjection';
import { latestHistoryRefreshAction } from '../gateway/historyReviewPublication';
import { completePendingInputSnapshot, pendingInputCustodyCandidates } from '../gateway/pendingInputSnapshot';
import { parsedTranscriptCache, serializedTranscriptCache } from '../gateway/persistentTranscriptCache';

export const CLAUDE_QUEUE_SESSION = 'fixture:simulator:claude-queue';
const sessionId = '00000000-0000-4000-8000-000000000117';
const cliSessionId = '00000000-0000-4000-8000-000000000111';
const acceptedAt = 1789886184265;
const inputs = [
  { id: 'one', text: 'SIMULATOR stop using opencode astra' },
  { id: 'two', text: 'SIMULATOR stop' },
  // Two intentional equal-text submissions must remain visible.
  { id: 'repeat-one', text: 'SIMULATOR intentional repeat' },
  { id: 'repeat-two', text: 'SIMULATOR intentional repeat' },
];

export function simulatorClaudeQueuePayload(committed: boolean): Record<string, unknown> {
  const pending = inputs.map((input, index) => ({
    id: `claude-custody-${input.id}`, runId: `claude-receipt-${input.id}`,
    state: 'queued', acceptedAt: acceptedAt + index,
    message: { role: 'user', content: input.text },
  }));
  const canonical = inputs.map((input, index) => ({
    role: 'user', content: input.text, timestamp: acceptedAt + index,
    idempotencyKey: `claude-submission-${input.id}:user`,
    __openclaw: {
      id: `claude-committed-${input.id}`, importedFrom: 'claude-cli', cliSessionId,
      externalId: `claude-external-${input.id}`, recordTimestampMs: acceptedAt + 60_000 + index,
      transcriptPosition: { source: 'sqlite', rawSeq: 12568 + index },
    },
  }));
  return {
    sessionKey: CLAUDE_QUEUE_SESSION, sessionId,
    messages: committed ? canonical : [],
    pendingInputs: { items: committed ? [] : pending, total: committed ? 0 : pending.length },
  };
}

export function simulatorClaudeQueuedRows(): WorkspaceMessage[] {
  return messagesFromPayload(simulatorClaudeQueuePayload(false));
}

export function commitSimulatorClaudeQueue(current: WorkspaceMessage[]): WorkspaceMessage[] {
  const candidates = pendingInputCustodyCandidates(current, CLAUDE_QUEUE_SESSION);
  const payload = simulatorClaudeQueuePayload(true);
  const projected = messagesFromPayload(payload);
  const snapshot = completePendingInputSnapshot(payload, projected, CLAUDE_QUEUE_SESSION);
  if (!snapshot) throw new Error('Invalid simulator Claude queue snapshot');
  return latestHistoryRefreshAction(projected, CLAUDE_QUEUE_SESSION, () => current, { snapshot, candidates })(current);
}

export function restoreSimulatorClaudeQueue(current: WorkspaceMessage[]): WorkspaceMessage[] {
  return commitSimulatorClaudeQueue(parsedTranscriptCache(serializedTranscriptCache(current)));
}
