import { describe, expect, it } from 'vitest';
import { type WorkspaceMessage } from '../workspace/workspaceTypes';
import { messagesFromPayload } from '../workspace/historyMessageProjection';
import { buildVisibleTranscriptRenderRows } from '../transcript/transcriptVisibleRows';
import { transcriptGutterLabel } from '../transcript/transcriptGutter';
import { mergeLatestHistory, mergeOlderHistory } from './historyPagination';
import { parsedTranscriptCache, serializedTranscriptCache } from './persistentTranscriptCache';
import { upsertLiveMessage } from './gatewayEventProjection';

const sessionKey = 'agent:main:direct:queued-fixture';
const sessionId = '11111111-1111-4111-8111-111111111111';
const cliSessionId = '22222222-2222-4222-8222-222222222222';
const runId = 'long-run';
const parts = Array.from({ length: 28 }, (_, index) => `Progress paragraph ${index + 1}. ${'Native output remains independently visible. '.repeat(3).trim()}`);
const joined = parts.join('\n\n');

function history(count: number, nextNativeUser = false) {
  const prompt = (id: string, timestamp: number, rawSeq: number) => ({
    role: 'user', content: id, timestamp, idempotencyKey: `${id}:user`,
    __openclaw: { id, transcriptPosition: { source: 'one-source', rawSeq } },
  });
  const native = (id: string, timestamp: number, content: string, role = 'assistant') => ({
    role, content, timestamp, stopReason: role === 'assistant' ? 'tool_use' : undefined,
    __openclaw: { id, importedFrom: 'claude-cli', cliSessionId, externalId: id },
  });
  const raw = [prompt('origin', 1000, 10),
    ...parts.slice(0, count).map((part, index) => native(`step-${index + 1}`, 2000 + index * 1000, part)),
    prompt('queued-1', 3500, 12), prompt('queued-2', 5500, 14),
    ...(nextNativeUser ? [native('native-next-user', 40000, 'Next native input.', 'user')] : []),
  ];
  return messagesFromPayload({ sessionKey, sessionId, messages: raw });
}
function live(text: string, state: 'streaming' | 'complete'): WorkspaceMessage {
  return { id: `live-chat-${runId}`, role: 'assistant', text, source: 'live', sessionKey,
    runId, state, timestamp: '2100', transcriptSessionId: sessionId };
}
function footer(): WorkspaceMessage {
  return { id: `live-run-${runId}`, role: 'run', text: '✓ done in 16m 45s', source: 'live', sessionKey,
    runId, state: 'complete', timestamp: '39000', transcriptSessionId: sessionId };
}
function ids(rows: WorkspaceMessage[]) { return rows.map(row => row.id); }
/** A steered prompt (Gateway position, no native provenance) keeps its send
 * position among the timed rows around it, as a fresh history load shows it. */
function keepsSendPosition(rows: WorkspaceMessage[], id: string) {
  const timed = rows.filter(row => row.timestamp && row.source === 'history');
  const index = timed.findIndex(row => row.id === id);
  const at = Number(timed[index]!.timestamp);
  expect(index).toBeGreaterThanOrEqual(0);
  if (index > 0) expect(Number(timed[index - 1]!.timestamp)).toBeLessThanOrEqual(at);
  if (index < timed.length - 1) expect(Number(timed[index + 1]!.timestamp)).toBeGreaterThanOrEqual(at);
}
function misplaced(rows: WorkspaceMessage[], copy: WorkspaceMessage, completion?: WorkspaceMessage) {
  const without = rows.filter(row => row !== copy && row !== completion);
  const index = without.findIndex(row => row.id === 'queued-2');
  return [...without.slice(0, index + 1), copy, ...(completion ? [completion] : []), ...without.slice(index + 1)];
}

describe('Claude queued input inside one native turn', () => {
  it('keeps parallel native tool-result carriers inside the terminal run window', () => {
    const native = (id: string, timestamp: number, role: string, content: unknown, stopReason?: string) => ({
      role, content, timestamp, ...(stopReason ? { stopReason } : {}),
      __openclaw: { id, importedFrom: 'claude-cli', cliSessionId, externalId: id },
    });
    const canonical = messagesFromPayload({ sessionKey, sessionId, messages: [
      native('prior-answer', 1000, 'assistant', 'Prior answer.', 'end_turn'),
      native('parallel-intro', 10000, 'assistant', 'Checking both sources.', 'tool_use'),
      { ...native('queued-during-tools', 11000, 'user', 'Queued follow-up.'),
        idempotencyKey: 'queued-during-tools:user',
        __openclaw: { id: 'queued-during-tools', importedFrom: 'claude-cli', cliSessionId,
          externalId: 'queued-during-tools', transcriptPosition: { source: 'one-source', rawSeq: 12 } } },
      native('parallel-calls', 12000, 'assistant', [
        { type: 'text', text: 'Waiting for both results.' },
        { type: 'toolcall', id: 'bash-call', name: 'Bash', arguments: { command: 'check' } },
        { type: 'toolcall', id: 'send-call', name: 'mcp__openclaw__sessions_send', arguments: { message: 'check' } },
      ], 'tool_use'),
      native('bash-result', 13000, 'user', [{ type: 'tool_result', tool_use_id: 'bash-call', content: 'ok' }]),
      native('send-result', 13001, 'user', [{ type: 'tool_result', tool_use_id: 'send-call', content: 'ok' }]),
      native('parallel-answer', 14000, 'assistant', 'Both checks completed.', 'end_turn'),
      { ...native('next-native-prompt', 16000, 'user', 'Start the next turn.'),
        idempotencyKey: 'next-native-prompt:user',
        __openclaw: { id: 'next-native-prompt', importedFrom: 'claude-cli', cliSessionId,
          externalId: 'next-native-prompt', transcriptPosition: { source: 'one-source', rawSeq: 14 } } },
      native('next-turn-step', 17000, 'assistant', 'Next turn progress.', 'tool_use'),
    ] });
    expect(canonical.filter(row => row.id === 'bash-result' || row.id === 'send-result').map(row => row.role))
      .toEqual(['tool', 'tool']);
    const copy = { ...live('Checking both sources.\n\nWaiting for both results.\n\nBoth checks completed.', 'complete'), timestamp: '10001' };
    const rows = mergeLatestHistory(canonical, [...canonical, copy, footer()], sessionKey);
    expect(ids(rows)).not.toContain(copy.id);
    expect(rows.filter(row => row.text === 'Both checks completed.')).toHaveLength(1);
    expect(ids(rows).indexOf('bash-result')).toBeLessThan(ids(rows).indexOf('send-result'));
    expect(ids(rows).indexOf('send-result')).toBeLessThan(ids(rows).indexOf('parallel-answer'));
    expect(ids(rows).indexOf('parallel-answer')).toBeLessThan(ids(rows).indexOf(`live-run-${runId}`));
    expect(ids(rows).indexOf(`live-run-${runId}`)).toBeLessThan(ids(rows).indexOf('queued-during-tools'));
    expect(ids(rows).indexOf('queued-during-tools')).toBeLessThan(ids(rows).indexOf('next-native-prompt'));
    expect(ids(rows).indexOf('next-native-prompt')).toBeLessThan(ids(rows).indexOf('next-turn-step'));
  });

  it('keeps only the uncovered tail when an image-started run has no positioned prompt', () => {
    const canonical = imageStartedHistory(false);
    const copy = imageStartedLive([...imageParts, 'Uncovered tail.'].join('\n\n'), 'streaming');
    const rows = mergeLatestHistory(canonical, [...canonical, copy], sessionKey);
    expect(rows.find(row => row.id === copy.id)?.text).toBe('Uncovered tail.');
    expect(ids(rows).indexOf('image-step-3')).toBeLessThan(ids(rows).indexOf(copy.id));
    expect(ids(rows).indexOf(copy.id)).toBeLessThan(ids(rows).indexOf('image-queued'));
    const covered = mergeLatestHistory(canonical, [...canonical, imageStartedLive(imageParts.join('\n\n'), 'streaming')], sessionKey);
    expect(ids(covered)).not.toContain(copy.id);
    const caughtUp = mergeLatestHistory(imageStartedHistory(false, true), parsedTranscriptCache(serializedTranscriptCache(rows)), sessionKey);
    expect(ids(caughtUp)).not.toContain(copy.id);
    expect(caughtUp.filter(row => row.text === 'Uncovered tail.')).toHaveLength(1);
  });

  it('retires the terminal image-started copy after native end-turn and keeps steered input at its send position', () => {
    const canonical = imageStartedHistory(true);
    const copy = imageStartedLive([...imageParts, 'Final answer.'].join('\n\n'), 'complete');
    const rows = mergeLatestHistory(canonical, [...canonical, copy, imageStartedFooter()], sessionKey);
    expect(ids(rows)).not.toContain(copy.id);
    expect(ids(rows).indexOf('image-final')).toBeLessThan(ids(rows).indexOf('live-run-image-run'));
    keepsSendPosition(rows, 'image-queued');
    expect(ids(rows).indexOf('image-queued')).toBeLessThan(ids(rows).indexOf('image-next-user'));
    expect(rows.filter(row => row.text === 'Final answer.')).toHaveLength(1);
  });

  it('keeps an unanchored or out-of-tolerance image-started copy intact', () => {
    const canonical = imageStartedHistory(false);
    const text = imageParts.join('\n\n');
    for (const [page, copy] of [
      [canonical.filter(row => row.id !== 'previous-final'), imageStartedLive(text, 'streaming')],
      [canonical, { ...imageStartedLive(text, 'streaming'), transcriptSessionId: '33333333-3333-4333-8333-333333333333' }],
    ] as const) {
      const rows = mergeLatestHistory(page, [...page, copy], sessionKey);
      expect(rows.find(row => row.id === copy.id)?.text).toBe(text);
    }
    // Seven seconds after the turn's last native text part (12000), before the
    // queued prompt. History still shows this turn open, so the late stamp is a
    // reconnect's, not another turn's: the covered copy retires.
    const late = { ...imageStartedLive(text, 'streaming'), timestamp: '19000' };
    expect(mergeLatestHistory(canonical, [...canonical, late], sessionKey).some(row => row.id === late.id)).toBe(false);
    const priorAnswer = { ...canonical.find(row => row.id === 'previous-final')!, text: 'Repeated sentence.', timestamp: '7000' };
    const priorCopy = imageStartedLive('Repeated sentence.', 'streaming');
    expect(mergeLatestHistory([priorAnswer], [priorAnswer, priorCopy], sessionKey)
      .find(row => row.id === priorCopy.id)?.text).toBe('Repeated sentence.');
  });

  it('shows only the uncovered streaming tail after the last merged native row', () => {
    const canonical = history(5);
    const copy = live(parts.slice(0, 8).join('\n\n'), 'streaming');
    const rows = mergeLatestHistory(canonical, misplaced(canonical, copy), sessionKey);
    const tail = rows.find(row => row.id === copy.id);
    expect(tail?.text).toBe(parts.slice(5, 8).join('\n\n'));
    expect(tail?.state).toBe('streaming');
    expect(ids(rows).indexOf('step-5')).toBeLessThan(ids(rows).indexOf(copy.id));
    keepsSendPosition(rows, 'queued-1'); keepsSendPosition(rows, 'queued-2');
    expect(ids(rows).indexOf('queued-1')).toBeLessThan(ids(rows).indexOf(copy.id));
    const nextFrame = upsertLiveMessage(rows, { ...live(parts.slice(0, 9).join('\n\n'), 'streaming'), timestamp: '8000' });
    expect(nextFrame.find(row => row.id === copy.id)).toMatchObject({
      text: parts.slice(5, 9).join('\n\n'), timestamp: '2100',
    });
    const fullyMerged = mergeLatestHistory(history(8), rows, sessionKey);
    expect(ids(fullyMerged)).not.toContain(copy.id);
  });

  it.each([joined.slice(0, 2000) + '...<truncated>', joined])('retires a covered terminal copy and keeps steered prompts at their send position', (text) => {
    const canonical = history(28, true);
    expect(canonical.filter(row => row.role === 'user' && row.displayPosition)
      .every(row => !row.runId && !row.inputReceiptRunId)).toBe(true);
    expect(canonical.filter(row => row.cliProvenance?.kind === 'claude-native')
      .every(row => !row.runId)).toBe(true);
    expect(canonical.find(row => row.id === 'native-next-user')).toMatchObject({
      role: 'user', cliProvenance: { kind: 'claude-native' },
    });
    const copy = live(text, 'complete');
    const previous = misplaced(history(5), copy, footer());
    for (const current of [previous, parsedTranscriptCache(serializedTranscriptCache(previous))]) {
      const rows = mergeLatestHistory(canonical, current, sessionKey);
      expect(ids(rows)).not.toContain(copy.id);
      expect(ids(rows).indexOf('step-28')).toBeLessThan(ids(rows).indexOf(`live-run-${runId}`));
      keepsSendPosition(rows, 'queued-1'); keepsSendPosition(rows, 'queued-2');
      expect(ids(rows).indexOf('queued-1')).toBeLessThan(ids(rows).indexOf('queued-2'));
      expect(ids(rows).indexOf('queued-2')).toBeLessThan(ids(rows).indexOf('native-next-user'));
      expect(rows.filter(row => row.text.includes(parts[0]!))).toHaveLength(1);
      const paged = mergeOlderHistory([], rows, sessionKey);
      keepsSendPosition(paged, 'queued-1');
      const visible = buildVisibleTranscriptRenderRows(rows, new Set());
      const cursor = visible.findIndex(row => row.message.id === 'step-28');
      expect(cursor).toBeGreaterThanOrEqual(0);
      expect(visible.slice(cursor - 3, cursor + 1).map((row, index) =>
        transcriptGutterLabel(row.sourceRow, visible[cursor]!.sourceRow, cursor - 3 + index, cursor)))
        .toEqual(['3', '2', '1', '0']);
    }
  });

  it('keeps an unproven or wrong-generation copy intact', () => {
    const canonical = history(28, true);
    for (const candidate of [
      live('Different output.', 'complete'),
      { ...live(joined, 'complete'), transcriptSessionId: '33333333-3333-4333-8333-333333333333' },
    ]) {
      const rows = mergeLatestHistory(canonical, [...history(5), candidate, footer()], sessionKey);
      expect(ids(rows)).toContain(`live-chat-${runId}`);
    }
  });
});

const imageParts = ['First image commentary.', 'Second image commentary.', 'Third image commentary.'];
function imageStartedHistory(terminal: boolean, caughtUp = false) {
  const native = (id: string, timestamp: number, content: string, stopReason: string, role = 'assistant') => ({
    role, content, timestamp, ...(role === 'assistant' ? { stopReason } : {}),
    __openclaw: { id, importedFrom: 'claude-cli', cliSessionId, externalId: id },
  });
  return messagesFromPayload({ sessionKey, sessionId, messages: [
    native('previous-final', 1000, 'Previous answer.', 'end_turn'),
    ...imageParts.map((part, index) => native(`image-step-${index + 1}`, 10000 + index * 1000, part, 'tool_use')),
    ...(caughtUp ? [native('image-step-4', 13000, 'Uncovered tail.', 'tool_use')] : []),
    { role: 'user', content: 'Queued follow-up.', timestamp: 20000, idempotencyKey: 'image-queued:user',
      __openclaw: { id: 'image-queued', transcriptPosition: { source: 'one-source', rawSeq: 20 } } },
    ...(terminal ? [native('image-final', 30000, 'Final answer.', 'end_turn'),
      native('image-next-user', 40000, 'Next native input.', '', 'user')] : []),
  ] });
}
function imageStartedLive(text: string, state: 'streaming' | 'complete'): WorkspaceMessage {
  return { id: 'live-chat-image-run', role: 'assistant', text, source: 'live', sessionKey,
    runId: 'image-run', state, timestamp: '10001', transcriptSessionId: sessionId };
}
function imageStartedFooter(): WorkspaceMessage {
  return { id: 'live-run-image-run', role: 'run', text: '✓ done', source: 'live', sessionKey,
    runId: 'image-run', state: 'complete', timestamp: '30001', transcriptSessionId: sessionId };
}
