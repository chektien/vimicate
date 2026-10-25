import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { runElapsedDescription } from './runCompletionMessage';

/**
 * Canonical chat history has timestamped user/assistant boundaries but does
 * not persist Vimicate's transient lifecycle row. Reconstruct the native-like
 * completion footer from those authoritative timestamps and discard orphaned
 * live `start` rows that survived a relaunch.
 */
export function withHistoryRunCompletions(input: WorkspaceMessage[]) {
  const messages = input.filter((message) => !(message.role === 'run' && message.state === 'streaming'));
  const output: WorkspaceMessage[] = [];
  let index = 0;
  while (index < messages.length) {
    const first = messages[index]!;
    if (first.role !== 'user') { output.push(first); index += 1; continue; }
    let end = index + 1;
    let sessionKey = first.sessionKey;
    let generation = first.transcriptSessionId;
    while (end < messages.length) {
      const next = messages[end]!;
      if (next.role === 'user' || next.role === 'boundary'
        || sessionKey && next.sessionKey && sessionKey !== next.sessionKey
        || generation && next.transcriptSessionId && generation !== next.transcriptSessionId) break;
      sessionKey ||= next.sessionKey;
      generation ||= next.transcriptSessionId;
      end += 1;
    }
    const turn = messages.slice(index, end);
    output.push(...turn);
    const final = [...turn].reverse().find((message) => message.role !== 'run');
    const alreadyCompleted = turn.some((message) => message.role === 'run' && message.state === 'complete');
    const startedAt = timestampMilliseconds(first.timestamp);
    const endedAt = final?.role === 'assistant' ? timestampMilliseconds(final.timestamp) : null;
    // A still-streaming live answer is not a finished turn: windows merge live
    // rows, and a mid-run first-words row once produced "✓ done in 18s".
    if (!alreadyCompleted && final?.role === 'assistant' && final.state !== 'streaming' && !final.asyncMessage && !final.asyncQuestion && startedAt !== null && endedAt !== null && endedAt >= startedAt) {
      output.push({
        id: `history-run-${final.id}`,
        role: 'run',
        text: `✓ done in ${runElapsedDescription(endedAt - startedAt)}`,
        state: 'complete',
        source: 'history',
        ...(final.sessionKey || first.sessionKey ? { sessionKey: final.sessionKey || first.sessionKey } : {}),
        ...(generation ? { transcriptSessionId: generation } : {}),
        ...(final.runId ? { runId: final.runId } : {}),
        ...(final.timestamp ? { timestamp: final.timestamp } : {}),
      });
    }
    index = end;
  }
  return output;
}

function timestampMilliseconds(value: string | undefined) {
  if (!value) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric >= 0) return numeric < 100_000_000_000 ? numeric * 1000 : numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
