import { describe, expect, it } from 'vitest';
import { type WorkspaceMessage } from '../workspace/workspaceTypes';
import { messagesFromPayload } from '../workspace/historyMessageProjection';
import { projectRegisteredGatewayEvent } from './gatewayEventProjection';
import { mergeLatestHistory } from './historyPagination';
import { latestHistoryWindow } from './historyWindow';
import { claudeNativeLiveDiagnosis, provenClaudeNativeLive } from './claudeNativeLiveConvergence';
import { flushBufferedLiveMessages, LiveMessagePublicationBuffer } from './liveMessagePublication';
const sessionKey = 'agent:main:direct:fixture'; const sessionId = '11111111-1111-4111-8111-111111111111'; const cliSessionId = '22222222-2222-4222-8222-222222222222';
const runId = 'fixture-steer-run'; const source = 'fixture-source';
const c1 = 'Inspecting the first sample.'; const c2 = 'Checking the next sample.'; const answer = 'The sample output is ready. Both items are included.';
const label = (row: WorkspaceMessage) => `${row.source === 'history' ? 'saved' : 'live'} ${row.role}: ${row.text}`;
const shown = (rows: WorkspaceMessage[]) => rows.filter(row => row.role !== 'tool' && row.role !== 'run' && row.text).map(label);
const native = (id: string, ts: number, content: unknown[], stop = 'tool_use') => ({ role: 'assistant', timestamp: ts, content, stopReason: stop, api: 'anthropic-messages', provider: 'claude-cli', __openclaw: { id, importedFrom: 'claude-cli', cliSessionId, externalId: id } });
// Synthetic rows model a prompt carrying the
// run's submission key and a Gateway position, every Claude step is native and
// unpositioned, and the answer is the native end-turn step.
const first = { role: 'user', content: 'Inspect both samples.', timestamp: 1700000000257, idempotencyKey: `${runId}:user`, __openclaw: { id: 'p1', idempotencyKey: `${runId}:user`, recordTimestampMs: 1700000000300, transcriptPosition: { source, rawSeq: 10 }, importedFrom: 'claude-cli', cliSessionId, externalId: 'ext-p1' } };
const s1 = native('s1', 1700000006433, [{ type: 'text', text: c1 }]);
const t1 = native('t1', 1700000007252, [{ type: 'toolcall', id: 'toolu_1', name: 'exec', arguments: {} }, { type: 'tool_result', tool_use_id: 'toolu_1', content: [{ type: 'text', text: 'ok' }], name: 'exec' }]);
const s2 = native('s2', 1700000016433, [{ type: 'text', text: c2 }]);
const t2 = native('t2', 1700000017252, [{ type: 'toolcall', id: 'toolu_2', name: 'exec', arguments: {} }, { type: 'tool_result', tool_use_id: 'toolu_2', content: [{ type: 'text', text: 'ok' }], name: 'exec' }]);
const savedNative = native('s3', 1700000061156, [{ type: 'text', text: answer }], 'end_turn');
const full = `${c1}\n\n${c2}\n\n${answer}`;
// Real windows hold the finished turn before this one. A window that starts at
// the prompt is the first turn of a transcript or a cut-off page.
const earlier = { ...first, content: 'Earlier.', timestamp: 1699999910000, idempotencyKey: 'earlier-run:user',
  __openclaw: { ...first.__openclaw, id: 'p0', idempotencyKey: 'earlier-run:user', recordTimestampMs: 1699999910050, transcriptPosition: { source, rawSeq: 8 }, externalId: 'ext-p0' } };
const turnBefore = [earlier, native('s-1', 1699999920000, [{ type: 'text', text: 'Earlier answer.' }], 'end_turn')];
function app(cold: boolean, prompt: unknown = first, merge: (latest: WorkspaceMessage[], current: WorkspaceMessage[], key: string) => WorkspaceMessage[] = mergeLatestHistory) {
  const buffer = new LiveMessagePublicationBuffer();
  let rows: WorkspaceMessage[] = cold ? [] : mergeLatestHistory(messagesFromPayload({ sessionKey, sessionId, messages: [prompt] }),
    [{ id: 'local-first', role: 'user', text: 'Inspect both samples.', source: 'local', sessionKey, runId, idempotencyKey: runId, timestamp: '1700000000200' }], sessionKey);
  const receive = (event: string, payload: Record<string, unknown>) => {
    const projected = projectRegisteredGatewayEvent({ event, payload: { sessionKey, runId, ...payload } }, [{ sessionKey, path: '', agentRuntime: 'claude-cli' }]);
    if (projected) buffer.enqueue(projected.message);
    flushBufferedLiveMessages(buffer, (_key, action) => { rows = action(rows); });
    return rows;
  };
  const refresh = (messages: unknown[]) => { rows = merge(messagesFromPayload({ sessionKey, sessionId, messages }), rows, sessionKey); return rows; };
  return { receive, refresh };
}
const end = (a: ReturnType<typeof app>) => a.receive('agent', { stream: 'lifecycle', ts: 1700000061300, data: { phase: 'end' } });
const sawFirstCommentary = (a: ReturnType<typeof app>) => { a.receive('chat', { state: 'delta', message: { content: c1 } }); a.receive('agent', { stream: 'tool', ts: 1700000007300, data: { phase: 'start', name: 'exec', toolCallId: 'toolu_1' } }); };
const mid = [...turnBefore, first, s1, t1, s2, t2]; const done = [...mid, savedNative];
const savedCommentary = ['saved user: Earlier.', 'saved assistant: Earlier answer.', 'saved user: Inspect both samples.', `saved narration: ${c1}`, `saved narration: ${c2}`];
const copy = (rows: WorkspaceMessage[]) => rows.find(row => row.id === `live-chat-${runId}`);

describe('interrupted Claude steps are not completed turns', () => {
  it.each(['max_tokens', 'stop_sequence'])('keeps a queued reply after a %s step', stopReason => {
    const queuedRun = 'queued-run';
    const queued = { ...first, timestamp: 1700000007000, idempotencyKey: `${queuedRun}:user`,
      __openclaw: { ...first.__openclaw, id: 'queued', idempotencyKey: `${queuedRun}:user`, externalId: 'ext-queued',
        recordTimestampMs: 1700000007050, transcriptPosition: { source, rawSeq: 11 } } };
    let rows = latestHistoryWindow(messagesFromPayload({ sessionKey, sessionId, messages: [...turnBefore, first, { ...s1, stopReason }, queued, s2, t2] }), [], sessionKey);
    const text = `${c2}\n\nThe queued answer.`;
    const reply = projectRegisteredGatewayEvent({ event: 'chat', payload: { sessionKey, runId: queuedRun, state: 'final', message: { content: text } } }, [{ sessionKey, path: '', agentRuntime: 'claude-cli' }])!.message;
    const buffer = new LiveMessagePublicationBuffer(); buffer.enqueue(reply);
    flushBufferedLiveMessages(buffer, (_key, action) => { rows = action(rows); });
    expect(rows.find(row => row.id === `live-chat-${queuedRun}`)?.text).toBe(text);
  });

  it.each(['max_tokens', 'stop_sequence'])('does not retire a final from a saved %s prefix alone', stopReason => {
    const a = app(true, first, latestHistoryWindow);
    a.refresh([...mid, { ...savedNative, stopReason }]);
    expect(copy(a.receive('chat', { state: 'final', message: { content: full } }))).toBeDefined();
  });
});

// Synthetic foreground-return sequence with a cumulative final frame.
// A phone leaves mid-turn, refreshes saved history on return and then receives
// the reply as one final frame. Frames are cumulative, so that frame repeats
// the commentary history already holds. Nothing had cropped a streaming frame
// first, so the copy kept everything, and without the run's end receipt it
// was never retired: the saved answer then sat beside it.
describe('a final frame that is the first frame after a mid-turn refresh', () => {
  it('shows only the answer when the phone saw the turn start and was away for the rest', () => {
    const a = app(false); sawFirstCommentary(a);
    expect(shown(a.refresh(mid))).toEqual(savedCommentary);
    const final = a.receive('chat', { state: 'final', message: { content: full } });
    expect(shown(final)).toEqual([...savedCommentary, `live assistant: ${answer}`]);
    // Cropping is not completion: the copy stays until history holds the answer.
    expect(claudeNativeLiveDiagnosis(final, copy(final)!)).toBe('match');
    expect(provenClaudeNativeLive(final)).toEqual([]);
    end(a);
    expect(shown(a.refresh(done))).toEqual([...savedCommentary, `saved assistant: ${answer}`]);
  });

  it('shows only the answer when the app launched mid-turn', () => {
    const a = app(true); a.refresh(mid);
    expect(shown(a.receive('chat', { state: 'final', message: { content: full } }))).toEqual([...savedCommentary, `live assistant: ${answer}`]);
  });

  it('retires the copy for the saved answer even when the run end was never received', () => {
    const a = app(true); a.refresh(mid);
    a.receive('chat', { state: 'final', message: { content: full } });
    const settled = a.refresh(done);
    expect(shown(settled)).toEqual([...savedCommentary, `saved assistant: ${answer}`]);
    expect(copy(settled)).toBeUndefined();
    expect(shown(a.refresh(done))).toEqual([...savedCommentary, `saved assistant: ${answer}`]);
  });

  it('never paints a late final frame beside the answer history already holds', () => {
    const a = app(true); a.refresh(done);
    expect(shown(a.receive('chat', { state: 'final', message: { content: full } }))).toEqual([...savedCommentary, `saved assistant: ${answer}`]);
  });

  // Review (10 Nov): only the turn's own prompt may vouch. A prompt saved
  // without this run's submission key leaves a one-frame final whole, and a
  // later turn that opens with an earlier turn's words keeps them.
  it('leaves the copy whole when the saved prompt does not carry the run submission key', () => {
    for (const key of [undefined, 'another-run:user']) {
      const { idempotencyKey: _own, ...rest } = first;
      const prompt = { ...rest, ...(key ? { idempotencyKey: key } : {}), __openclaw: { ...first.__openclaw, idempotencyKey: key } };
      const a = app(true, prompt); a.refresh([...turnBefore, prompt, s1, t1, s2, t2]);
      expect(shown(a.receive('chat', { state: 'final', message: { content: full } })).at(-1)).toBe(`live assistant: ${full}`);
    }
  });

  // Review (11 Nov): a prompt queued while an earlier turn runs is saved among
  // that turn's rows, wherever it lands. Its key proves nothing about them.
  it('keeps the words of a queued turn that opens like the turn it waited behind', () => {
    const queuedRun = 'queued-run';
    const queuedAt = (timestamp: number) => ({ role: 'user', content: 'And then?', timestamp, idempotencyKey: `${queuedRun}:user`,
      __openclaw: { id: 'pq', idempotencyKey: `${queuedRun}:user`, recordTimestampMs: timestamp + 50, transcriptPosition: { source, rawSeq: 11 }, importedFrom: 'claude-cli', cliSessionId, externalId: 'ext-pq' } });
    const beforeAnyStep = queuedAt(1700000001000); const afterCommentary = queuedAt(1700000007000); const afterToolStep = queuedAt(1700000010000);
    // The earlier turn's prompt is saved by the Gateway before Claude's own copy is imported.
    const { importedFrom: _i, cliSessionId: _c, externalId: _e, ...position } = first.__openclaw;
    const notYetImported = { ...first, __openclaw: position };
    // A turn opened by an injected notice has no positioned prompt of its own.
    const finished = native('s0', 1699999920000, [{ type: 'text', text: 'Earlier answer.' }], 'end_turn');
    const scheduled = { role: 'user', content: 'Heartbeat scan.', timestamp: 1699999995000, idempotencyKey: 'cron-run:user', provenance: { kind: 'internal_system', sourceTool: 'cron' },
      __openclaw: { id: 'ps', idempotencyKey: 'cron-run:user', recordTimestampMs: 1699999995050, transcriptPosition: { source, rawSeq: 9 } } };
    const notice = { role: 'user', content: '[OpenClaw: 3 messages occurred outside this Claude session]', timestamp: 1700000000000, __openclaw: { id: 'n1', importedFrom: 'claude-cli', cliSessionId, externalId: 'n1' } };
    const placements: Array<[unknown[], string]> = [
      [[...turnBefore, first, s1, afterCommentary, t1, s2, t2, savedNative], c2],
      [[...turnBefore, notYetImported, beforeAnyStep, s1], c1],
      // The page starts at the queued prompt, so the open turn is cut off.
      [[afterToolStep, s2, t2], c2],
      [[afterToolStep, s2, t2, savedNative], c2],
      // A scheduled scan opens the earlier turn with a positioned system prompt.
      [[finished, scheduled, beforeAnyStep, s1, t1, s2], c1],
      [[scheduled, beforeAnyStep, s1, t1, s2], c1],
      [[finished, notice, t1, afterToolStep, s2, t2], c2],
      [[...turnBefore, first, s1, t1, afterToolStep, s2, t2, savedNative], c2],
      [[...turnBefore, first, s1, t1, afterToolStep, s2, t2], c2],
      [[...turnBefore, first, t1, afterToolStep, s2, t2, savedNative], c2],
      [[...turnBefore, first, beforeAnyStep, s1, t1, s2, t2, savedNative], c1],
      [[...turnBefore, first, beforeAnyStep, s1], c1],
      [[...turnBefore, first, beforeAnyStep, savedNative], answer],
    ];
    for (const [history, opening] of placements) for (const timestamp of [undefined, 1700000062000]) {
      const rows = messagesFromPayload({ sessionKey, sessionId, messages: history });
      const text = `${opening}\n\nThe queued answer.`;
      const reply = projectRegisteredGatewayEvent({ event: 'chat', payload: { sessionKey, runId: queuedRun, state: 'final', ...(timestamp ? { ts: timestamp } : {}), message: { content: text, ...(timestamp ? { timestamp } : {}) } } }, [{ sessionKey, path: '', agentRuntime: 'claude-cli' }])!.message;
      const buffer = new LiveMessagePublicationBuffer(); buffer.enqueue(reply);
      let next = rows;
      flushBufferedLiveMessages(buffer, (_key, action) => { next = action(next); });
      expect(next.find(row => row.id === `live-chat-${queuedRun}`)!.text).toBe(text);
    }
  });

  // Review (11 Nov): a window that starts at the prompt cannot show whether a
  // turn was still open before it. The copy keeps the older rules.
  it('leaves the copy whole when the window starts at its own prompt', () => {
    const a = app(true); a.refresh([first, s1, t1, s2, t2]);
    expect(shown(a.receive('chat', { state: 'final', message: { content: full } })).at(-1)).toBe(`live assistant: ${full}`);
  });

  // Review (11 Nov): most Claude threads save a run's answer as the Gateway's
  // positioned `cli-assistant:<runId>` row, written when the run ends. That
  // row closes the turn before the prompt, alone or after a delivery mirror.
  it('crops a turn that follows a run answer the Gateway saved', () => {
    const gatewayAnswer = (id: string, run: string, timestamp: number, rawSeq: number) => ({ role: 'assistant', content: [{ type: 'text', text: 'Earlier answer.' }], api: 'cli', provider: 'claude-cli', stopReason: 'stop', timestamp, idempotencyKey: `cli-assistant:${run}`,
      __openclaw: { id, runId: run, idempotencyKey: `cli-assistant:${run}`, recordTimestampMs: timestamp + 10, transcriptPosition: { source, rawSeq }, importedFrom: 'claude-cli', cliSessionId, externalId: id } });
    const mirror = { role: 'assistant', content: [{ type: 'text', text: 'Earlier answer.' }], api: 'openai-responses', provider: 'openclaw', model: 'delivery-mirror', stopReason: 'stop', timestamp: 1699999921000, idempotencyKey: 'mirror-1',
      __openclaw: { id: 'm1', runId: 'earlier-run', idempotencyKey: 'mirror-1', recordTimestampMs: 1699999921010, transcriptPosition: { source, rawSeq: 9 } } };
    const nativeEnd = native('s-1', 1699999920000, [{ type: 'text', text: 'Earlier answer.' }], 'end_turn');
    for (const before of [[earlier, gatewayAnswer('g0', 'earlier-run', 1699999922000, 9)], [earlier, nativeEnd, mirror, gatewayAnswer('g0', 'earlier-run', 1699999922000, 9)]]) {
      const a = app(true); a.refresh([...before, first, s1, t1, s2, t2]);
      expect(shown(a.receive('chat', { state: 'final', message: { content: full } })).at(-1)).toBe(`live assistant: ${answer}`);
      // This run's own answer arrives the same way and replaces the copy.
      const settled = a.refresh([...before, first, s1, t1, s2, t2, { ...gatewayAnswer('g2', runId, 1700000062000, 12), content: [{ type: 'text', text: full }] }]);
      expect(copy(settled)).toBeUndefined();
      expect(shown(settled).filter(line => line.includes(answer))).toHaveLength(1);
    }
    // A prompt queued during that run is saved before the run's answer, so a
    // step of the open run still precedes it.
    const queuedRun = 'queued-run';
    const queued = { role: 'user', content: 'And then?', timestamp: 1700000010000, idempotencyKey: `${queuedRun}:user`,
      __openclaw: { id: 'pq', idempotencyKey: `${queuedRun}:user`, recordTimestampMs: 1700000010050, transcriptPosition: { source, rawSeq: 11 }, importedFrom: 'claude-cli', cliSessionId, externalId: 'ext-pq' } };
    const rows = messagesFromPayload({ sessionKey, sessionId, messages: [...turnBefore, first, s1, t1, queued, s2, t2, gatewayAnswer('g1', runId, 1700000062000, 12)] });
    const text = `${c2}\n\nThe queued answer.`;
    const reply = projectRegisteredGatewayEvent({ event: 'chat', payload: { sessionKey, runId: queuedRun, state: 'final', message: { content: text } } }, [{ sessionKey, path: '', agentRuntime: 'claude-cli' }])!.message;
    const buffer = new LiveMessagePublicationBuffer(); buffer.enqueue(reply);
    let next = rows;
    flushBufferedLiveMessages(buffer, (_key, action) => { next = action(next); });
    expect(next.find(row => row.id === `live-chat-${queuedRun}`)!.text).toBe(text);
  });

  // The run already answered. Later native steps that open with its words
  // belong to a turn whose prompt is not saved yet.
  it('leaves the copy whole when a native answer already follows the own prompt', () => {
    const laterStep = native('s1b', 1700000110000, [{ type: 'text', text: c1 }]);
    const a = app(true); a.refresh([...turnBefore, first, savedNative, laterStep]);
    const text = `${c1}\n\nAnother answer.`;
    expect(shown(a.receive('chat', { state: 'final', message: { content: text } })).at(-1)).toBe(`live assistant: ${text}`);
  });

  // Review (11 Nov): without the run's footer only the whole saved answer
  // retires the copy. Saved rows also cover a truncated or shorter final
  // frame, a turn that so far ends on commentary, and a frame shorter than the
  // saved answer. Retiring on those could leave the turn with no answer.
  it('keeps a completed copy until its own saved turn holds exactly its text and ends in the answer', () => {
    const longerAnswer = native('s3', 1700000061156, [{ type: 'text', text: `${answer} And a third.` }], 'end_turn');
    const cases: Array<[unknown[], string]> = [
      [mid, `${c1}\n\n${c2.slice(0, 9)}...<truncated>`],
      [mid, `${c1}\n\n${c2}`],
      [[...turnBefore, first, s1, t1, s2], `${c1}\n\n${c2}`],
      [[...mid, longerAnswer], full],
    ];
    for (const [history, text] of cases) {
      const a = app(true); a.refresh(history);
      const final = a.receive('chat', { state: 'final', message: { content: text } });
      expect(claudeNativeLiveDiagnosis(final, copy(final)!)).toBe('footer=0 saved=0');
      // Until an answer is saved, a refresh keeps the copy too.
      if (history.at(-1) !== longerAnswer) expect(copy(a.refresh(history))).toBeDefined();
    }
  });

  it('keeps the words of a later turn that opens like an earlier turn', () => {
    const nextRun = 'next-run';
    const nextPrompt = { role: 'user', content: 'Again.', timestamp: 1700000110000, idempotencyKey: `${nextRun}:user`,
      __openclaw: { id: 'p3', idempotencyKey: `${nextRun}:user`, recordTimestampMs: 1700000110050, transcriptPosition: { source, rawSeq: 12 }, importedFrom: 'claude-cli', cliSessionId, externalId: 'ext-p3' } };
    for (const history of [[...done, nextPrompt], [...mid, nextPrompt], done, mid]) {
      const rows = messagesFromPayload({ sessionKey, sessionId, messages: history });
      const reply = projectRegisteredGatewayEvent({ event: 'chat', payload: { sessionKey, runId: nextRun, state: 'final', message: { content: `${c1}\n\n${c2}\n\nSecond answer.` } } }, [{ sessionKey, path: '', agentRuntime: 'claude-cli' }])!.message;
      const buffer = new LiveMessagePublicationBuffer(); buffer.enqueue(reply);
      let next = rows;
      flushBufferedLiveMessages(buffer, (_key, action) => { next = action(next); });
      expect(next.find(row => row.id === `live-chat-${nextRun}`)!.text).toBe(`${c1}\n\n${c2}\n\nSecond answer.`);
    }
  });
});
