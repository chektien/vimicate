import { describe, expect, it } from 'vitest';
import { type WorkspaceMessage } from '../workspace/workspaceTypes';
import { messagesFromPayload } from '../workspace/historyMessageProjection';
import { projectGatewayEvent, upsertLiveMessage } from './gatewayEventProjection';
import { mergeLatestHistory } from './historyPagination';
import { sealLiveChatForSteer } from './steerLiveSeal';

const sessionKey = 'agent:main:direct:fixture';
const sessionId = '11111111-1111-4111-8111-111111111111';
const runId = 'run-claude';
const source = 'fixture-source';
const at = (offset: number) => 1_794_304_000_000 + offset;

// Claude CLI chat frames reach the client untimed.
const chat = (text: string) => projectGatewayEvent({ event: 'chat', payload: { sessionKey, runId, state: 'delta', message: { content: text } } }, sessionKey)!.message;
const positioned = (id: string, content: string, timestamp: number, rawSeq: number) => ({ role: 'user', content, timestamp: at(timestamp),
  idempotencyKey: `${id}:user`, __openclaw: { id, idempotencyKey: `${id}:user`, transcriptPosition: { source, rawSeq } } });
const shown = (rows: WorkspaceMessage[]) => rows.filter(row => row.text).map(row => `${row.role}:${row.text}`);
const expected = ['user:First request.', 'narration:Alpha.', 'user:Second request.', 'assistant:Beta.'];

// The steering prompt is stamped by the device clock, the saved prompt by the
// host. Neither clock places the live continuation that answers it.
describe('a steered continuation keeps its place below the steering prompt', () => {
  it.each([['behind', 1500], ['ahead', 9000]])('when the device clock runs %s the host', (_clock, deviceTime) => {
    let rows = messagesFromPayload({ sessionKey, sessionId, messages: [positioned('first', 'First request.', 1000, 10)] });
    rows = upsertLiveMessage(rows, chat('Alpha.'));
    const steer: WorkspaceMessage = { id: 'local-steer', role: 'user', text: 'Second request.', source: 'local', sessionKey, runId, idempotencyKey: 'steer', timestamp: String(at(deviceTime)) };
    rows = sealLiveChatForSteer(rows, steer, runId);
    rows = upsertLiveMessage(rows, chat('Alpha.\n\nBeta.'));
    expect(shown(rows)).toEqual(expected);
    const page = () => messagesFromPayload({ sessionKey, sessionId, messages: [
      positioned('first', 'First request.', 1000, 10), positioned('steer', 'Second request.', 2500, 11)] });
    const merged = mergeLatestHistory(page(), rows, sessionKey);
    expect(shown(merged)).toEqual(expected);
    expect(shown(mergeLatestHistory(page(), merged, sessionKey))).toEqual(expected);
  });
});
