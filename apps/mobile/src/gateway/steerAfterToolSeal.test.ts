import { describe, expect, it } from 'vitest';
import { type WorkspaceMessage } from '../workspace/workspaceTypes';
import { messagesFromPayload } from '../workspace/historyMessageProjection';
import { projectRegisteredGatewayEvent } from './gatewayEventProjection';
import { mergeLatestHistory } from './historyPagination';
import { claudeNativeLiveDiagnosis, provenClaudeNativeLive } from './claudeNativeLiveConvergence';
import { flushBufferedLiveMessages, LiveMessagePublicationBuffer } from './liveMessagePublication';
import { sealLiveChatForSteer } from './steerLiveSeal';

const sessionKey = 'agent:main:direct:fixture';
const sessionId = '11111111-1111-4111-8111-111111111111';
const cliSessionId = '22222222-2222-4222-8222-222222222222';
const runId = 'fixture-steer-run';
const source = 'fixture-source';
const commentary = 'Inspecting the sample before the queued update.';
const answer = 'The second sample is included in this result.';
const label = (row: WorkspaceMessage) => `${row.source === 'history' ? 'saved' : 'live'} ${row.role}${row.steerSealed ? ' seal' : ''}: ${row.role === 'tool' ? '' : row.text}`.trimEnd();
const shown = (rows: WorkspaceMessage[]) => rows.filter(row => row.role !== 'tool' && row.text).map(label);

// Synthetic saved rows preserve the mid-turn steering sequence. Steering
// into a Claude CLI turn makes the Gateway close the steer request when the
// run adopts it, and the app refreshes history mid-turn. Saved history then
// held the commentary and the steered prompt, not yet the answer. The final
// frame brought the commentary back in the live copy, and the streaming reply
// sat above the prompt it answered.
describe('a steer adopted mid-turn, with history refreshed before the answer is saved', () => {
  const first = { role: 'user', content: 'Inspect the sample.', timestamp: 1700000000257, idempotencyKey: `${runId}:user`,
    __openclaw: { id: 'p1', idempotencyKey: `${runId}:user`, recordTimestampMs: 1700000000300, transcriptPosition: { source, rawSeq: 10 }, importedFrom: 'claude-cli', cliSessionId, externalId: 'ext-p1' } };
  const step = { role: 'assistant', timestamp: 1700000006433, content: [{ type: 'text', text: commentary }], stopReason: 'tool_use', api: 'anthropic-messages', provider: 'claude-cli',
    __openclaw: { id: 'step-text', importedFrom: 'claude-cli', cliSessionId, externalId: 'step-text' } };
  const call = { role: 'assistant', timestamp: 1700000007252, stopReason: 'tool_use', api: 'anthropic-messages', provider: 'claude-cli',
    content: [{ type: 'toolcall', id: 'toolu_1', name: 'exec', arguments: {} }, { type: 'tool_result', tool_use_id: 'toolu_1', content: [{ type: 'text', text: 'finished' }], name: 'exec' }],
    __openclaw: { id: 'step-tool', importedFrom: 'claude-cli', cliSessionId, externalId: 'step-tool' } };
  const steer = { role: 'user', content: 'Include the second sample.', timestamp: 1700000025909, idempotencyKey: 'fixture-steer-prompt:user',
    __openclaw: { id: 'p2', idempotencyKey: 'fixture-steer-prompt:user', steerTargetRunId: runId, recordTimestampMs: 1700000025950, transcriptPosition: { source, rawSeq: 11 } } };
  const saved = { role: 'assistant', timestamp: 1700000061156, content: [{ type: 'text', text: answer }], stopReason: 'end_turn', api: 'anthropic-messages', provider: 'claude-cli',
    __openclaw: { id: 'step-answer', importedFrom: 'claude-cli', cliSessionId, externalId: 'step-answer' } };

  function turn() {
    const buffer = new LiveMessagePublicationBuffer();
    let rows: WorkspaceMessage[] = mergeLatestHistory(messagesFromPayload({ sessionKey, sessionId, messages: [first] }),
      [{ id: 'local-first', role: 'user', text: 'Inspect the sample.', source: 'local', sessionKey, runId, idempotencyKey: runId, timestamp: '1700000000200' }], sessionKey);
    const receive = (event: string, payload: Record<string, unknown>) => {
      const projected = projectRegisteredGatewayEvent({ event, payload: { sessionKey, runId, ...payload } }, [{ sessionKey, path: '', agentRuntime: 'claude-cli' }]);
      if (projected) buffer.enqueue(projected.message);
      flushBufferedLiveMessages(buffer, (_key, action) => { rows = action(rows); });
      return rows;
    };
    receive('chat', { state: 'delta', message: { content: commentary } });
    receive('agent', { stream: 'tool', ts: 1700000007300, data: { phase: 'start', name: 'exec', toolCallId: 'toolu_1' } });
    rows = sealLiveChatForSteer(rows, { id: 'local-steer', role: 'user', text: 'Include the second sample.', source: 'local', sessionKey, runId, idempotencyKey: 'fixture-steer-prompt', timestamp: '1700000025800' }, runId);
    receive('agent', { stream: 'tool', ts: 1700000057300, data: { phase: 'result', name: 'exec', toolCallId: 'toolu_1', result: {} } });
    const refresh = (messages: unknown[]) => { rows = mergeLatestHistory(messagesFromPayload({ sessionKey, sessionId, messages }), rows, sessionKey); return rows; };
    return { receive, refresh, rows: () => rows };
  }
  const before = ['saved user: Inspect the sample.', `saved narration: ${commentary}`, 'saved user: Include the second sample.'];

  it('keeps the commentary out of the live copy through the final frame, and the reply below the steered prompt', () => {
    const live = turn();
    expect(shown(live.refresh([first, step, call, steer]))).toEqual(before);
    // The Gateway can repeat the text it already sent when the steer is adopted.
    expect(shown(live.receive('chat', { state: 'delta', message: { content: commentary } }))).toEqual(before);
    expect(shown(live.receive('chat', { state: 'delta', message: { content: `${commentary}\n\n${answer.slice(0, 10)}` } }))).toEqual([...before, `live assistant: ${answer.slice(0, 10)}`]);
    const final = live.receive('chat', { state: 'final', message: { content: `${commentary}\n\n${answer}` } });
    expect(shown(final)).toEqual([...before, `live assistant: ${answer}`]);
    const copy = final.find(row => row.id === `live-chat-${runId}`)!;
    expect(copy.state).toBe('complete');
    // The crop is carried from the streaming copy, not re-proven: saved history
    // cannot vouch for a completed copy until it holds the answer.
    expect(claudeNativeLiveDiagnosis(final, copy)).toBe('candidates=0 partial:1');
    expect(provenClaudeNativeLive(final)).toEqual([]);
    const footer: WorkspaceMessage = { id: `live-run-${runId}`, role: 'run', text: '✓ done in 1m', source: 'live', sessionKey, runId, state: 'complete' };
    const settled = mergeLatestHistory(messagesFromPayload({ sessionKey, sessionId, messages: [first, step, call, steer, saved] }), [...final, footer], sessionKey);
    expect(shown(settled.filter(row => row.role !== 'run'))).toEqual([...before, `saved assistant: ${answer}`]);
    expect(settled.some(row => row.id === `live-chat-${runId}` || row.steerSealed)).toBe(false);
  });

  it('needs no refresh: the seal alone keeps the order and the crop', () => {
    const live = turn();
    const sealed = ['saved user: Inspect the sample.', `live narration seal: ${commentary}`, 'live user: Include the second sample.'];
    expect(shown(live.receive('chat', { state: 'delta', message: { content: `${commentary}\n\n${answer.slice(0, 10)}` } }))).toEqual([...sealed, `live assistant: ${answer.slice(0, 10)}`]);
    expect(shown(live.receive('chat', { state: 'final', message: { content: `${commentary}\n\n${answer}` } }))).toEqual([...sealed, `live assistant: ${answer}`]);
  });
});
