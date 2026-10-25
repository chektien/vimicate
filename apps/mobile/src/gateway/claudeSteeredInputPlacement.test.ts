import { it, expect } from 'vitest';
import { messagesFromPayload } from '../workspace/historyMessageProjection';
import { projectGatewayEvent } from './gatewayEventProjection';
import { mergeLatestHistory } from './historyPagination';
const sessionKey = 'agent:main:direct:fixture';
const sessionId = '11111111-1111-4111-8111-111111111111';
const cliSessionId = '22222222-2222-4222-8222-222222222222';
const runId = 'run-claude'; const source = 'fixture-source';
// Physical example-cloud turn (5 Oct): steered prompts stacked after the latest
// narration while the live Claude copy streamed; a fresh load showed them in place.
it('steered prompts keep their send position while the Claude turn streams', () => {
  const rows = messagesFromPayload({ sessionKey, sessionId, messages: [
    { role: 'user', content: 'Start.', timestamp: 1000, idempotencyKey: 'start:user', __openclaw: { id: 'prompt', idempotencyKey: 'start:user', importedFrom: 'claude-cli', cliSessionId, externalId: 'prompt', transcriptPosition: { source, rawSeq: 10 } } },
    { role: 'assistant', content: [{ type: 'text', text: 'Step one.' }, { type: 'toolcall', id: 't0', name: 'Read', arguments: {} }], stopReason: 'tool_use', timestamp: 2000, __openclaw: { id: 'step-0', importedFrom: 'claude-cli', cliSessionId, externalId: 'step-0' } },
    { role: 'user', content: 'Steer A.', timestamp: 2050, idempotencyKey: 'a:user', __openclaw: { id: 'steer-a', idempotencyKey: 'a:user', transcriptPosition: { source, rawSeq: 11 } } },
    { role: 'assistant', content: [{ type: 'text', text: 'Step two.' }, { type: 'toolcall', id: 't1', name: 'Read', arguments: {} }], stopReason: 'tool_use', timestamp: 2100, __openclaw: { id: 'step-1', importedFrom: 'claude-cli', cliSessionId, externalId: 'step-1' } },
    { role: 'user', content: 'Steer B.', timestamp: 2150, idempotencyKey: 'b:user', __openclaw: { id: 'steer-b', idempotencyKey: 'b:user', transcriptPosition: { source, rawSeq: 12 } } },
    { role: 'assistant', content: [{ type: 'text', text: 'Step three.' }, { type: 'toolcall', id: 't2', name: 'Read', arguments: {} }], stopReason: 'tool_use', timestamp: 2200, __openclaw: { id: 'step-2', importedFrom: 'claude-cli', cliSessionId, externalId: 'step-2' } },
  ] });
  const live = { ...projectGatewayEvent({ event: 'chat', payload: { sessionKey, runId, state: 'delta', message: { content: 'Step one.\n\nStep two.\n\nStep three.' } } }, sessionKey)!.message, timestamp: rows.find(r => r.id === 'step-0')!.timestamp! };
  const merged = mergeLatestHistory(rows, [...rows, live], sessionKey);
  const order = merged.filter(r => ['steer-a', 'steer-b', 'step-0', 'step-1', 'step-2'].includes(r.id)).map(r => r.id);
  expect(order).toEqual(['step-0', 'steer-a', 'step-1', 'steer-b', 'step-2']);
});
