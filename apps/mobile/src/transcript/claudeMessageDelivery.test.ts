import { describe, expect, it } from 'vitest';
import { messagesFromPayload } from '../workspace/historyMessageProjection';
import { projectTranscriptDisplayGroups } from './transcriptDisplayProjection';
import { buildVisibleTranscriptRenderRows } from './transcriptVisibleRows';
import { latestHistoryWindow, olderHistoryWindow } from '../gateway/historyWindow';
import { parsedTranscriptCache, serializedTranscriptCache } from '../gateway/persistentTranscriptCache';
import { sameTranscriptPublication } from '../gateway/transcriptPublicationEquality';
import { projectRegisteredGatewayEvent } from '../gateway/gatewayEventProjection';
import { flushBufferedLiveMessages, LiveMessagePublicationBuffer } from '../gateway/liveMessagePublication';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { projectClaudeHistoryDeliveries } from './claudeHistoryPresentation';

import fixture from './claudeMessageDeliveryFixture.json';
const { sessionKey, sessionId, cliSessionId, runId, answer, nativeAnswer, messages } = fixture;
const project = (raw: unknown[] = messages) => messagesFromPayload({ sessionKey, sessionId, messages: raw });
const answers = (rows: WorkspaceMessage[]) => projectTranscriptDisplayGroups(rows).filter(row => row.role === 'assistant').map(row => row.text);
const renderedAnswers = (rows: WorkspaceMessage[]) => [...new Map(buildVisibleTranscriptRenderRows(projectTranscriptDisplayGroups(rows), new Set())
  .filter(row => row.message.role === 'assistant').map(row => [row.message.id, row.message.text])).values()];
const restore = (rows: WorkspaceMessage[]) => parsedTranscriptCache(serializedTranscriptCache(rows));
const receive = (rows: WorkspaceMessage[], event: string, payload: Record<string, unknown>) => {
  const projected = projectRegisteredGatewayEvent({ event, payload: { sessionKey, runId, ...payload } }, [{ sessionKey, path: '', agentRuntime: 'claude-cli' }]);
  expect(projected).not.toBeNull();
  const buffer = new LiveMessagePublicationBuffer(); buffer.enqueue(projected!.message);
  flushBufferedLiveMessages(buffer, (_key, action) => { rows = action(rows); });
  return rows;
};

describe('Claude message-tool delivery and saved CLI result', () => {
  it('shows the delivered reply once while keeping the different native end-turn reply', () => {
    const rows = messagesFromPayload({ sessionKey, sessionId, messages });
    const projected = projectTranscriptDisplayGroups(rows);
    expect(projected.filter(row => row.role === 'assistant').map(row => row.text)).toEqual([answer, nativeAnswer]);
    expect(rows.filter(row => row.text === answer)).toHaveLength(2);
    expect(renderedAnswers(rows)).toEqual([answer, nativeAnswer]);
    expect(projected.find(row => row.id === 'mirror')).toBe(rows.find(row => row.id === 'mirror'));
    const delivered = projectClaudeHistoryDeliveries(rows);
    expect(projectClaudeHistoryDeliveries(delivered)).toBe(delivered);
  });

  it.each(['older', 'latest', 'cache'] as const)('converges split pages through %s and keeps a result without its mirror', mode => {
    const before = project(messages.slice(0, 3)); const result = project(messages.slice(3));
    expect(answers(before)).toEqual([answer, nativeAnswer]);
    expect(answers(result)).toEqual([answer]);
    const merged = mode === 'older' ? olderHistoryWindow(before, result, sessionKey)
      : latestHistoryWindow(mode === 'cache' ? restore(result) : result, mode === 'cache' ? restore(before) : before, sessionKey);
    expect(renderedAnswers(merged)).toEqual([answer, nativeAnswer]);
    expect(renderedAnswers(restore(merged))).toEqual([answer, nativeAnswer]);
    expect(renderedAnswers(latestHistoryWindow(project(), merged, sessionKey))).toEqual([answer, nativeAnswer]);
  });

  it.each(['older', 'latest', 'cache'] as const)('retains the result for split-page legacy progress through %s and refresh', mode => {
    const progress = structuredClone(messages);
    const call = progress[0]!.content[0] as unknown as { arguments: { final?: boolean } };
    call.arguments.final = false;
    const before = project(progress.slice(0, 1));
    const after = project(progress.slice(1));
    let merged = mode === 'older' ? olderHistoryWindow(before, after, sessionKey)
      : latestHistoryWindow(mode === 'cache' ? restore(after) : after, mode === 'cache' ? restore(before) : before, sessionKey);
    for (let refresh = 0; refresh < 3; refresh++) {
      expect(merged.find(row => row.id === 'mirror')?.role).toBe('narration');
      expect(renderedAnswers(merged)).toEqual([nativeAnswer, answer]);
      expect(projectTranscriptDisplayGroups(merged).some(row => row.id === 'result')).toBe(true);
      merged = latestHistoryWindow(after, restore(merged), sessionKey);
    }
  });

  it.each(['history-first', 'final-first', 'mirror-first', 'cache-first'] as const)('stays singular through %s, late final replay and foreground refresh', mode => {
    let rows: WorkspaceMessage[] = mode === 'history-first' ? latestHistoryWindow(project(), [], sessionKey)
      : mode === 'cache-first' ? restore(project()) : mode === 'mirror-first' ? project(messages.slice(0, 3)) : [];
    rows = receive(rows, 'chat', { state: 'final', message: { content: answer, timestamp: 1700000004000 } });
    rows = latestHistoryWindow(project(), rows, sessionKey);
    expect(renderedAnswers(rows)).toEqual([answer, nativeAnswer]);
    rows = receive(rows, 'agent', { stream: 'lifecycle', ts: 1700000004100, data: { phase: 'end' } });
    expect(renderedAnswers(rows)).toEqual([answer, nativeAnswer]);
    expect(projectTranscriptDisplayGroups(rows).at(-1)?.role).toBe('run');
    rows = restore(rows);
    rows = receive(rows, 'chat', { state: 'final', message: { content: answer, timestamp: 1700000004000 } });
    expect(renderedAnswers(rows)).toEqual([answer, nativeAnswer]);
    for (let i = 0; i < 3; i++) rows = latestHistoryWindow(project(), rows, sessionKey);
    expect(renderedAnswers(rows)).toEqual([answer, nativeAnswer]);
    expect(rows.some(row => row.role === 'tool')).toBe(true);
    expect(projectTranscriptDisplayGroups(rows).at(-1)?.role).toBe('run');
  });

  it('preserves equal delivered answers in distinct runs, including a later queued turn', () => {
    const first = project();
    const secondRun = 'different-run';
    const second = first.map(row => ({ ...row, id: `second-${row.id}`,
      ...(row.runId ? { runId: secondRun } : {}),
      ...(row.idempotencyKey ? { idempotencyKey: row.idempotencyKey.replace(runId, secondRun) } : {}),
      ...(row.deliveryProvenance ? { deliveryProvenance: { ...row.deliveryProvenance, runId: secondRun } } : {}),
      ...(row.displayPosition ? { displayPosition: { ...row.displayPosition, rawSeq: row.displayPosition.rawSeq + 20 } } : {}) }));
    const queued: WorkspaceMessage = { id: 'queued', role: 'user', text: 'Repeat the answer.', source: 'history', sessionKey, transcriptSessionId: sessionId,
      runId: secondRun, idempotencyKey: `${secondRun}:user`, displayPosition: { source: 'fixture', rawSeq: 12 } };
    expect(answers([...first, queued, ...second])).toEqual([answer, nativeAnswer, answer, nativeAnswer]);
  });

  it('binds a generation-less live final only to one concrete typed result, never across conflicts', () => {
    const result = project(messages.slice(3));
    const final = { state: 'final', message: { content: answer } };
    const bound = receive(result, 'chat', final);
    expect(bound.filter(row => row.role === 'assistant')).toHaveLength(1);
    expect(bound[0]?.transcriptSessionId).toBe(sessionId);
    expect(bound[0]?.absorbedLiveIdentity?.runId).toBe(runId);
    const foreign = receive(result, 'chat', { ...final, sessionId: cliSessionId });
    expect(foreign.filter(row => row.role === 'assistant')).toHaveLength(2);
    const prompt: WorkspaceMessage = { id: 'prompt', role: 'user', text: 'Do the task.', source: 'history', sessionKey,
      transcriptSessionId: sessionId, idempotencyKey: `${runId}:user`, runId };
    const conflictingAfterPrompt = receive([prompt, ...result], 'chat', { ...final, sessionId: cliSessionId });
    expect(conflictingAfterPrompt.some(row => row.source === 'live' && row.role === 'assistant')).toBe(true);
    const ambiguous = receive([...result, { ...result[0]!, id: 'other-result', transcriptSessionId: cliSessionId }], 'chat', final);
    expect(ambiguous.some(row => row.source === 'live' && row.role === 'assistant')).toBe(true);
    const controls: Array<(row: WorkspaceMessage) => WorkspaceMessage> = [
      ({ transcriptSessionId: _, ...row }) => row,
      ({ deliveryProvenance: _, ...row }) => row,
      row => ({ ...row, attachments: [{ id: 'image', filename: 'image.png', mimeType: 'image/png' }] }),
      row => ({ ...row, asyncMessage: true }),
    ];
    for (const change of controls) expect(receive(result.map(change), 'chat', final).some(row => row.source === 'live' && row.role === 'assistant')).toBe(true);
  });

  const controls: Array<[string, (row: WorkspaceMessage) => WorkspaceMessage]> = [
    ['different run', row => ({ ...row, runId: 'other' })],
    ['conflicting typed run', row => ({ ...row, deliveryProvenance: { kind: 'cli-result', runId: 'other' } })],
    ['missing typed provenance', ({ deliveryProvenance: _, ...row }) => row],
    ['different stable session', row => ({ ...row, sessionKey: 'other' })],
    ['unknown stable session', ({ sessionKey: _, ...row }) => row],
    ['different concrete generation', row => ({ ...row, transcriptSessionId: cliSessionId })],
    ['unknown concrete generation', ({ transcriptSessionId: _, ...row }) => row],
    ['different position source', row => ({ ...row, displayPosition: { source: 'other', rawSeq: 11 } })],
    ['result precedes mirror', row => ({ ...row, displayPosition: { source: 'fixture', rawSeq: 9 } })],
    ['missing position', ({ displayPosition: _, ...row }) => row],
    ['changed payload', row => ({ ...row, text: `${row.text} Additional answer.` })],
    ['result-only media', row => ({ ...row, attachments: [{ id: 'image', filename: 'fixture.png', mimeType: 'image/png', uri: 'https://example.invalid/image.png' }] })],
    ['recoverable content', row => ({ ...row, recovery: { state: 'available', sourceMessageId: row.id } })],
    ['async delivery', row => ({ ...row, asyncMessage: true })],
    ['async question', row => ({ ...row, asyncQuestion: { itemId: 'question', questions: [{ title: 'Continue?' }] } })],
    ['restart recovery', row => ({ ...row, asyncQuestionRestartRecovery: true })],
    ['internal event', row => ({ ...row, internalEvent: 'exec' })],
    ['streaming content', row => ({ ...row, state: 'streaming' })],
    ['error content', row => ({ ...row, state: 'error' })],
    ['live content', row => ({ ...row, source: 'live' })],
  ];
  it.each(controls)('retains a result with %s', (_name, change) => {
    const rows = project().map(row => row.id === 'result' ? change(row) : row);
    expect(projectTranscriptDisplayGroups(rows).some(row => row.id === 'result')).toBe(true);
  });

  it('refuses ambiguous repeated sends and repeated results in the same run', () => {
    const rows = project();
    for (const id of ['mirror', 'result']) {
      const original = rows.find(row => row.id === id)!;
      const repeat = { ...original, id: `repeat-${id}`, ...(original.idempotencyKey ? { idempotencyKey: `${original.idempotencyKey}-repeat` } : {}) };
      expect(projectTranscriptDisplayGroups([...rows, repeat]).some(row => row.id === 'result')).toBe(true);
    }
  });

  it.each([false, 'invalid'])('does not use a mirror marked final %s outside the call page', final => {
    const mirror = { ...messages[1], openclawDeliveryMirror: { kind: 'message-tool-source-reply', final } };
    expect(answers(project([mirror, messages[3]]))).toEqual([answer, answer]);
  });

  it('honors a completed descriptor and refuses commentary proven by the saved send', () => {
    expect(answers(project([{ ...messages[1], openclawDeliveryMirror: { kind: 'message-tool-source-reply', final: true } }, messages[3]]))).toEqual([answer]);
    const call = { ...messages[0], content: [{ type: 'toolcall', id: 'send', name: 'mcp__openclaw__message', arguments: { action: 'send', message: answer, final: false } }] };
    const rows = project([call, messages[1], messages[3]]);
    expect(projectTranscriptDisplayGroups(rows).find(row => row.id === 'mirror')?.role).toBe('narration');
    expect(projectTranscriptDisplayGroups(rows).some(row => row.id === 'result')).toBe(true);
  });

  it.each(['api', 'provider', 'model', 'idempotencyKey'] as const)('requires the typed mirror protocol %s', field => {
    const mirror = { ...messages[1], [field]: 'unrelated' };
    expect(answers(project([mirror, messages[3]]))).toEqual([answer, answer]);
  });

  it('does not upgrade old or truncated cache facts into delivery proof', () => {
    const rows = project();
    const restored = restore(rows);
    expect(sameTranscriptPublication(rows, restored)).toBe(true);
    const old = rows.map(({ deliveryProvenance: _, ...row }) => row);
    expect(answers(restore(old))).toHaveLength(3);
    expect(sameTranscriptPublication(rows, old)).toBe(false);
    const truncated = parsedTranscriptCache(serializedTranscriptCache(rows, { textLimit: 16 }));
    expect(truncated.every(row => !row.deliveryProvenance)).toBe(true);
    expect(answers(truncated)).toHaveLength(3);
    const malformed = parsedTranscriptCache(JSON.stringify(rows.map(row => ({ ...row, deliveryProvenance: { kind: 'message-tool', runId: 42 } }))));
    expect(malformed.every(row => !row.deliveryProvenance)).toBe(true);
  });
});
