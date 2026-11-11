import { describe, expect, it } from 'vitest';
import { type WorkspaceMessage } from '../workspace/workspaceTypes';
import { messagesFromPayload } from '../workspace/historyMessageProjection';
import { projectGatewayEvent, upsertLiveMessage } from './gatewayEventProjection';
import { mergeLatestHistory } from './historyPagination';
import { parsedTranscriptCache, serializedTranscriptCache } from './persistentTranscriptCache';
import { sameTranscriptPublication } from './transcriptPublicationEquality';

const sessionKey = 'agent:main:direct:fixture';
const sessionId = '11111111-1111-4111-8111-111111111111';
const cliSessionId = '22222222-2222-4222-8222-222222222222';
const runId = 'run-claude';
const prompt = { role: 'user', content: 'Start.', timestamp: 1700000000257, idempotencyKey: `${runId}:user`,
  __openclaw: { id: 'p1', idempotencyKey: `${runId}:user`, transcriptPosition: { source: 'fixture-source', rawSeq: 10 } } };
// The shape Claude CLI history has on the wire: one saved message holds the call and, once it ends, its result.
const saved = (id: string, done: boolean) => ({ role: 'assistant', timestamp: 1700000007252, stopReason: 'tool_use', api: 'anthropic-messages', provider: 'claude-cli',
  content: [{ type: 'toolcall', id, name: 'exec', arguments: { command: 'sleep 50' } }, ...(done ? [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text: 'finished' }], name: 'exec' }] : [])],
  __openclaw: { id: `m-${id}`, importedFrom: 'claude-cli', cliSessionId, externalId: `m-${id}` } });
const liveTool = (id: string, phase: 'start' | 'result') => projectGatewayEvent({ event: 'agent', payload: { sessionKey, runId, stream: 'tool', ts: 1700000007300,
  data: { phase, name: 'exec', toolCallId: id, ...(phase === 'result' ? { result: {} } : {}) } } }, sessionKey)!.message;
const liveRows = (rows: WorkspaceMessage[]) => rows.filter(row => row.role === 'tool' && row.source === 'live').map(row => row.id);
const history = (...messages: unknown[]) => messagesFromPayload({ sessionKey, sessionId, messages: [prompt, ...messages] });

// Simulator replay (11 Nov): one Claude CLI tool call showed three tool rows
// once saved history held it, because only Codex history named the call its
// saved result belongs to.
describe('a live tool row retires once saved history holds that call\'s result', () => {
  it('retires the live row for a saved Claude result, on the page that brings it and from a cold restore', () => {
    let rows = [liveTool('toolu_1', 'start'), liveTool('toolu_2', 'start')].reduce(upsertLiveMessage, history());
    rows = upsertLiveMessage(rows, liveTool('toolu_1', 'result'));
    const page = () => history(saved('toolu_1', true), saved('toolu_2', false));
    expect(liveRows(mergeLatestHistory(page(), rows, sessionKey))).toEqual([`live-tool-${runId}-toolu_2`]);
    const restored = parsedTranscriptCache(serializedTranscriptCache(mergeLatestHistory(page(), rows, sessionKey)));
    const late = upsertLiveMessage(restored, liveTool('toolu_1', 'result'));
    // A retained saved result still speaks for its call after a restore.
    expect(liveRows(mergeLatestHistory(history(), late, sessionKey))).toEqual([`live-tool-${runId}-toolu_2`]);
  });

  it('keeps the live row while history holds only the call, and for a call history does not hold', () => {
    const rows = [liveTool('toolu_1', 'start'), liveTool('toolu_9', 'result')].reduce(upsertLiveMessage, history());
    expect(liveRows(mergeLatestHistory(history(saved('toolu_1', false)), rows, sessionKey))).toEqual([`live-tool-${runId}-toolu_1`, `live-tool-${runId}-toolu_9`]);
  });

  // Integration review (11 Nov): a call id alone is not ownership. Runtimes with
  // small ids can reuse one across runs.
  it('never retires a live row for a saved result that another run or generation owns', () => {
    const rows = upsertLiveMessage(history(), liveTool('call-1', 'start'));
    const owned = (patch: Record<string, unknown>, top: Record<string, unknown> = {}) => ({ role: 'assistant', timestamp: 1699999910000, ...top,
      content: [{ type: 'toolcall', id: 'call-1', name: 'exec', arguments: {} }, { type: 'tool_result', tool_use_id: 'call-1', content: [{ type: 'text', text: 'old' }], name: 'exec' }],
      __openclaw: { id: 'old-call', ...patch } });
    // Another run's saved result, named by the host.
    expect(liveRows(mergeLatestHistory(history(owned({ runId: 'another-run' })), rows, sessionKey))).toEqual([`live-tool-${runId}-call-1`]);
    // A saved result with no run identity and no provider-unique native origin proves nothing.
    expect(liveRows(mergeLatestHistory(history(owned({})), rows, sessionKey))).toEqual([`live-tool-${runId}-call-1`]);
    // The same run's saved result, named by the host, does retire it.
    expect(liveRows(mergeLatestHistory(history(owned({ runId })), upsertLiveMessage(rows, liveTool('call-1', 'result')), sessionKey))).toEqual([]);
    // A live row that names another generation keeps its row.
    const elsewhere = rows.map(row => row.source === 'live' ? { ...row, transcriptSessionId: '33333333-3333-4333-8333-333333333333' } : row);
    expect(liveRows(mergeLatestHistory(history(saved('call-1', true)), elsewhere, sessionKey))).toEqual([`live-tool-${runId}-call-1`]);
  });

  it('names the call only on a saved result row, and counts it in publication equality', () => {
    const rows = history(saved('toolu_1', true)).filter(row => row.role === 'tool');
    expect(rows.map(row => row.tool?.resultOf)).toEqual([undefined, 'toolu_1']);
    expect(sameTranscriptPublication([rows[1]!], [{ ...rows[1]!, tool: { ...rows[1]!.tool!, resultOf: 'toolu_2' } }])).toBe(false);
  });
});
