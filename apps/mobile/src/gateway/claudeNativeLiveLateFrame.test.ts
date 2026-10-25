import { describe, expect, it } from 'vitest';
import { type WorkspaceMessage } from '../workspace/workspaceTypes';
import { messagesFromPayload } from '../workspace/historyMessageProjection';
import { projectGatewayEvent } from './gatewayEventProjection';
import { mergeLatestHistory } from './historyPagination';
import { claudeNativeLiveDiagnosis } from './claudeNativeLiveConvergence';

// Physical notes turn: tool call, commentary, tool call, end-turn answer, and
// no later prompt. The live row carries its terminal frame time, 36s after the
// commentary, and it stayed beside the canonical answer.
const sessionKey = 'agent:main:direct:fixture-late';
const sessionId = '33333333-3333-4333-8333-333333333333';
const cliSessionId = '44444444-4444-4444-8444-444444444444';
const runId = 'run-late';
const source = 'fixture-late-source';
const T = 1_790_296_674_000;
const commentary = 'Checking both install methods. Upgrading now.';
const answer = 'Both tools are updated.\n\n| | a | b |\n|---|---|---|\n| x | 1 | 2 |\n\nRestart running sessions to pick them up.';

function native(id: string, content: unknown[], stopReason: string, at: number) {
  return { role: 'assistant', content, stopReason, timestamp: at,
    __openclaw: { id, importedFrom: 'claude-cli', cliSessionId, externalId: id } };
}
const history = messagesFromPayload({ sessionKey, sessionId, messages: [
  { role: 'assistant', content: [{ type: 'text', text: 'Injected brief.' }], timestamp: T - 2_000_000,
    __openclaw: { id: 'brief', transcriptPosition: { source, rawSeq: 10 } } },
  { role: 'user', content: 'Update the tools.', timestamp: T, idempotencyKey: 'late:user',
    __openclaw: { id: 'prompt', idempotencyKey: 'late:user', transcriptPosition: { source, rawSeq: 11 },
      importedFrom: 'claude-cli', cliSessionId, externalId: 'prompt-native' } },
  native('tool-a', [{ type: 'toolcall', id: 'ta', name: 'Bash', arguments: { command: 'a' } }], 'tool_use', T + 10_000),
  native('commentary', [{ type: 'text', text: commentary }], 'tool_use', T + 15_000),
  native('tool-b', [{ type: 'toolcall', id: 'tb', name: 'Bash', arguments: { command: 'b' } }], 'tool_use', T + 17_000),
  native('answer', [{ type: 'text', text: answer }], 'end_turn', T + 51_000),
] });

function liveAt(text: string, at: number) {
  const row = projectGatewayEvent({ event: 'chat', payload: { sessionKey, runId, state: 'final',
    message: { content: text, timestamp: at } } }, sessionKey)!.message;
  return { ...row, timestamp: String(at) };
}
const footer: WorkspaceMessage = { id: `live-run-${runId}`, role: 'run', text: '✓ done in 50s',
  source: 'live', sessionKey, runId, state: 'complete' };

describe('Claude native turn with a terminal-frame live timestamp', () => {
  it.each([false, true])('keeps an untimed completed answer when only an older equal-text turn has reached history (timed footer=%s)', (timedFooter) => {
    const repeated = 'The checks passed.';
    const currentPromptAt = T + 60_000;
    const rows = messagesFromPayload({ sessionKey, sessionId, messages: [
      { role: 'user', content: 'Check the first change.', timestamp: T, idempotencyKey: 'old:user',
        __openclaw: { id: 'old-prompt', idempotencyKey: 'old:user', transcriptPosition: { source, rawSeq: 40 },
          importedFrom: 'claude-cli', cliSessionId, externalId: 'old-prompt-native' } },
      native('old-answer', [{ type: 'text', text: repeated }], 'end_turn', T + 10_000),
      { role: 'user', content: 'Check the second change.', timestamp: currentPromptAt, idempotencyKey: 'current:user',
        __openclaw: { id: 'current-prompt', idempotencyKey: 'current:user', transcriptPosition: { source, rawSeq: 41 },
          importedFrom: 'claude-cli', cliSessionId, externalId: 'current-prompt-native' } },
    ] });
    const live = projectGatewayEvent({ event: 'chat', payload: { sessionKey, runId, state: 'final',
      message: { content: repeated } } }, sessionKey)!.message;
    const completed: WorkspaceMessage = { ...footer, ...(timedFooter ? { timestamp: String(currentPromptAt + 10_000) } : {}) };
    expect(live.timestamp).toBeUndefined();
    expect(claudeNativeLiveDiagnosis([...rows, live, completed], live)).not.toBe('match');
    expect(mergeLatestHistory(rows, [...rows, live, completed], sessionKey).some(row => row.id === live.id)).toBe(true);
  });

  it('retires a streaming copy timed at a later commentary segment because its first frame was untimed', () => {
    const second = 'Second commentary segment.';
    const rows = messagesFromPayload({ sessionKey, sessionId, messages: [
      ...[1, 2].map(index => ({ role: 'user', content: index === 1 ? 'Update the tools.' : 'x', timestamp: T, idempotencyKey: 'seg:user',
        __openclaw: { id: 'seg-prompt', idempotencyKey: 'seg:user', transcriptPosition: { source, rawSeq: 20 } } })).slice(0, 1),
      native('seg-1', [{ type: 'text', text: commentary }], 'tool_use', T + 10_000),
      native('seg-tool', [{ type: 'toolcall', id: 'st', name: 'Bash', arguments: { command: 's' } }], 'tool_use', T + 20_000),
      native('seg-2', [{ type: 'text', text: second }], 'tool_use', T + 45_000),
    ] });
    const live = { ...liveAt(`${commentary}\n${second}`, T + 45_005), state: 'streaming' as const };
    const merged = mergeLatestHistory(rows, [...rows, live], sessionKey);
    expect(claudeNativeLiveDiagnosis([...rows, live], live)).toBe('match');
    expect(merged.filter(row => row.text === second)).toHaveLength(1);
    expect(merged.some(row => row.id === live.id)).toBe(false);
  });


  it.each(['\n\n', '\n'])('retires the cumulative live copy joined by %j', (joiner) => {
    const live = liveAt(`${commentary}${joiner}${answer}`, T + 51_500);
    const rows = mergeLatestHistory(history, [...history, live, footer], sessionKey);
    expect(rows.some(row => row.id === `live-chat-${runId}`)).toBe(false);
    expect(rows.filter(row => row.text === answer)).toHaveLength(1);
    expect(rows.at(-1)?.id).toBe(`live-run-${runId}`);
  });

  it('retires a completed copy whose footer a refresh re-derived as history-run-<live id>', () => {
    const live = { ...liveAt(`${commentary}\n${answer}`, T + 51_001), state: 'complete' as const };
    const derived: WorkspaceMessage = { id: `history-run-${live.id}`, role: 'run', text: '✓ done in 50s',
      source: 'history', sessionKey, runId, state: 'complete', timestamp: String(T + 51_001) };
    expect(claudeNativeLiveDiagnosis([...history, live, derived], live)).toBe('match');
    const rows = mergeLatestHistory(history, [...history, live, derived], sessionKey);
    expect(rows.some(row => row.id === live.id)).toBe(false);
    expect(rows.filter(row => row.text === answer)).toHaveLength(1);
  });

  it('retires a completed copy timed inside a tool interval between text parts', () => {
    const live = liveAt(`${commentary}\n\n${answer}`, T + 30_000);
    expect(claudeNativeLiveDiagnosis([...history, live, footer], live)).toBe('match');
    expect(mergeLatestHistory(history, [...history, live, footer], sessionKey).some(row => row.id === live.id)).toBe(false);
  });

  it('keeps one completion row for a turn that ends in commentary when its live copy retires', () => {
    const rows = messagesFromPayload({ sessionKey, sessionId, messages: [
      { role: 'user', content: 'Update the tools.', timestamp: T, idempotencyKey: 'only:user',
        __openclaw: { id: 'only-prompt', idempotencyKey: 'only:user', transcriptPosition: { source, rawSeq: 30 } } },
      native('only-tool', [{ type: 'toolcall', id: 'ot', name: 'Bash', arguments: { command: 'a' } }], 'tool_use', T + 10_000),
      native('only-text', [{ type: 'text', text: commentary }], 'tool_use', T + 15_000),
    ] });
    const live = { ...liveAt(commentary, T + 15_001), state: 'complete' as const };
    const derived: WorkspaceMessage = { id: `history-run-${live.id}`, role: 'run', text: '✓ done in 20s',
      source: 'history', sessionKey, runId, state: 'complete', timestamp: String(T + 20_000) };
    const merged = mergeLatestHistory(rows, [...rows, live, derived], sessionKey);
    expect(merged.some(row => row.id === live.id)).toBe(false);
    expect(merged.filter(row => row.role === 'run' && row.state === 'complete')).toHaveLength(1);
  });

  it('keeps a live copy timed after the turn it would claim', () => {
    const live = liveAt(`${commentary}\n\n${answer}`, T + 120_000);
    expect(claudeNativeLiveDiagnosis([...history, live, footer], live)).toMatch(/^candidates=0 .*late:1/);
    expect(claudeNativeLiveDiagnosis([...history, liveAt(`${commentary}\n\n${answer}`, T + 51_500), footer],
      liveAt(`${commentary}\n\n${answer}`, T + 51_500))).toBe('match');
    const rows = mergeLatestHistory(history, [...history, live, footer], sessionKey);
    expect(rows.some(row => row.id === `live-chat-${runId}`)).toBe(true);
  });
});
