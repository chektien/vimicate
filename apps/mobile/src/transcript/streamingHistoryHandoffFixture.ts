import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { projectGatewayEvent, upsertLiveMessage } from '../gateway/gatewayEventProjection';
import { mergeLatestHistory } from '../gateway/historyPagination';

/** Exercise lagging history through the real publication owners in Hermes. */
export function streamingHistoryHandoffFixture(): WorkspaceMessage[] {
  const sessionKey = 'fixture-stream-handoff';
  const prompt: WorkspaceMessage = {
    id: 'handoff-prompt', role: 'user', text: 'Keep the growing reply through history refresh.',
    sessionKey, source: 'history', timestamp: '2026-08-30T21:45:00+08:00',
    idempotencyKey: 'handoff-request:user',
  };
  const partial: WorkspaceMessage = {
    id: 'handoff-canonical-answer', role: 'assistant', text: 'Review in progress.',
    sessionKey, source: 'history', timestamp: '2026-08-30T21:45:04+08:00',
    idempotencyKey: 'handoff-mirror:assistant',
  };
  const delta = projectGatewayEvent({ event: 'chat', payload: {
    sessionKey, runId: 'fixture-handoff-run', state: 'delta',
    message: { content: partial.text, timestamp: Date.parse('2026-08-30T21:45:03+08:00') },
  } }, sessionKey)!.message;
  let rows = [prompt, delta];
  let text = `${partial.text}\n\nCumulative sections:`;
  for (let index = 1; index <= 40; index += 1) {
    text += ` ${index}`;
    rows = upsertLiveMessage(rows, { ...delta, text });
    rows = mergeLatestHistory([prompt, { ...partial, text: index % 2 ? text : partial.text }], rows, sessionKey);
  }
  return rows;
}
