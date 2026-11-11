import { beforeEach, describe, expect, it } from 'vitest';
import { type WorkspaceMessage } from '../workspace/workspaceTypes';
import { messagesFromPayload } from '../workspace/historyMessageProjection';
import { projectGatewayEvent, upsertLiveMessage } from './gatewayEventProjection';
import { mergeLatestHistory } from './historyPagination';
import { sealLiveChatForSteer } from './steerLiveSeal';

const sessionKey = 'agent:main:direct:fixture';
const sessionId = '11111111-1111-4111-8111-111111111111';
const runId = 'run-claude';
const source = 'fixture-source';
// Host epoch milliseconds: the event projection reads small numbers as seconds.
const at = (offset: number) => 1_794_304_000_000 + offset;

// Claude CLI chat frames reach the client untimed unless a case stamps them.
let timedChat = true;
const chat = (text: string, ts: number) => projectGatewayEvent({ event: 'chat', payload: { sessionKey, runId, state: 'delta', ...(timedChat ? { ts: at(ts) } : {}), message: { content: text } } }, sessionKey)!.message;
const tool = (id: string, ts: number) => projectGatewayEvent({ event: 'agent', payload: { sessionKey, runId, stream: 'tool', ts: at(ts), data: { phase: 'result', name: 'exec', toolCallId: id, result: {} } } }, sessionKey)!.message;
const positioned = (id: string, content: string, timestamp: number, rawSeq: number) => ({ role: 'user', content, timestamp: at(timestamp),
  idempotencyKey: `${id}:user`, __openclaw: { id, idempotencyKey: `${id}:user`, transcriptPosition: { source, rawSeq } } });
const label = (row: WorkspaceMessage) => row.role === 'tool' ? row.id.replace(`live-tool-${runId}-`, 'tool ') : `${row.role}:${row.text}`;
const shown = (rows: WorkspaceMessage[]) => rows.filter(row => row.text).map(label);

const expected = [
  'user:First request.', 'tool a0', 'tool a1', 'tool a2', 'narration:Still investigating.', 'tool b0', 'tool b1',
  'user:Second request.', 'assistant:Noted the second request.', 'tool c0', 'tool c1',
];

/** One Claude CLI turn: tools, commentary, tools, a steered prompt, commentary, tools. */
function liveTurn(first: WorkspaceMessage[]) {
  let rows = first;
  for (const [index, ts] of [1100, 1200, 1300].entries()) rows = upsertLiveMessage(rows, tool(`a${index}`, ts));
  rows = upsertLiveMessage(rows, chat('Still investigating.', 2000));
  for (const [index, ts] of [2100, 2200].entries()) rows = upsertLiveMessage(rows, tool(`b${index}`, ts));
  const steer: WorkspaceMessage = { id: 'local-steer', role: 'user', text: 'Second request.', source: 'local', sessionKey, runId, idempotencyKey: 'steer', timestamp: String(at(2500)) };
  rows = sealLiveChatForSteer(rows, steer, runId);
  rows = upsertLiveMessage(rows, chat('Still investigating.\n\nNoted the second request.', 2600));
  return upsertLiveMessage(upsertLiveMessage(rows, tool('c0', 2700)), tool('c1', 2800));
}

// Physical turn (10 Nov): the first Claude CLI turn after a runtime switch.
// Mid-run history held only the two positioned prompts, none of the run's
// Claude steps. The refresh after the steer lifted the steered prompt to just
// below the first prompt, above commentary and tools published before it.
describe('a steered prompt keeps its send position when mid-run history holds only the prompts', () => {
  beforeEach(() => { timedChat = true; });
  const promptsOnly = () => messagesFromPayload({ sessionKey, sessionId, messages: [
    positioned('first', 'First request.', 1000, 10), positioned('steer', 'Second request.', 2500, 11)] });

  it.each([true, false])('with a first prompt whose history row carries no run identity (timed chat %s)', (timed) => {
    timedChat = timed;
    const rows = liveTurn(messagesFromPayload({ sessionKey, sessionId, messages: [positioned('first', 'First request.', 1000, 10)] }));
    expect(shown(rows)).toEqual(expected);
    const merged = mergeLatestHistory(promptsOnly(), rows, sessionKey);
    expect(shown(merged)).toEqual(expected);
    expect(shown(mergeLatestHistory(promptsOnly(), merged, sessionKey))).toEqual(expected);
  });

  it('with a first prompt that kept its accepted run identity', () => {
    let rows: WorkspaceMessage[] = [{ id: 'local-first', role: 'user', text: 'First request.', source: 'local', sessionKey, runId, idempotencyKey: 'first', timestamp: String(at(1000)) }];
    rows = mergeLatestHistory(messagesFromPayload({ sessionKey, sessionId, messages: [positioned('first', 'First request.', 1000, 10)] }), rows, sessionKey);
    rows = liveTurn(rows);
    expect(shown(rows)).toEqual(expected);
    const merged = mergeLatestHistory(promptsOnly(), rows, sessionKey);
    expect(shown(merged)).toEqual(expected);
    expect(shown(mergeLatestHistory(promptsOnly(), merged, sessionKey))).toEqual(expected);
  });

  it('with a first prompt that is still optimistic', () => {
    const rows = liveTurn([{ id: 'local-first', role: 'user', text: 'First request.', source: 'local', sessionKey, runId, idempotencyKey: 'first', timestamp: String(at(1000)) }]);
    expect(shown(rows)).toEqual(expected);
    expect(shown(mergeLatestHistory(promptsOnly(), rows, sessionKey))).toEqual(expected);
  });
});
