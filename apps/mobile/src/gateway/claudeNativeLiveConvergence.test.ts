import { describe, expect, it } from 'vitest';
import { type WorkspaceMessage } from '../workspace/workspaceTypes';
import { messagesFromPayload } from '../workspace/historyMessageProjection';
import { projectGatewayEvent, upsertLiveMessage } from './gatewayEventProjection';
import { mergeLatestHistory } from './historyPagination';
import { parsedTranscriptCache, serializedTranscriptCache } from './persistentTranscriptCache';
import { claudeNativeLiveDiagnosis, provenClaudeNativeLive } from './claudeNativeLiveConvergence';
import { withHistoryRunCompletions } from './historyRunCompletion';

const sessionKey = 'agent:main:direct:fixture';
const sessionId = '11111111-1111-4111-8111-111111111111';
const cliSessionId = '22222222-2222-4222-8222-222222222222';
const runId = 'run-claude';
const source = 'fixture-source';
const texts = ['Checking the files.', 'Running the focused checks.', 'Reviewing the result.'];

function history(withAnswer = false) {
  const rows: Record<string, unknown>[] = [
    { role: 'user', content: 'Check this change.', timestamp: 1000, idempotencyKey: 'submission:user',
      __openclaw: { id: 'prompt', idempotencyKey: 'submission:user', transcriptPosition: { source, rawSeq: 10 } } },
    { role: 'assistant', content: [{ type: 'text', text: 'Previous queued answer.' }], stopReason: 'end_turn',
      timestamp: 1400, __openclaw: { id: 'earlier-answer', importedFrom: 'claude-cli', cliSessionId, externalId: 'earlier-answer' } },
    ...texts.map((text, index) => ({ role: 'assistant', content: [
      { type: 'text', text }, { type: 'toolcall', id: `tool-${index}`, name: 'Read', arguments: { file_path: 'fixture' } },
    ], stopReason: 'tool_use',
      timestamp: 2000 + index * 100, __openclaw: { id: `step-${index}`, importedFrom: 'claude-cli', cliSessionId, externalId: `step-${index}` } })),
    ...(withAnswer ? [{ role: 'assistant', content: [{ type: 'text', text: 'The change is sound.' }], stopReason: 'end_turn',
      timestamp: 2350, __openclaw: { id: 'answer', importedFrom: 'claude-cli', cliSessionId, externalId: 'answer' } }] : []),
    { role: 'user', content: 'Next task.', timestamp: 3000, idempotencyKey: 'next:user',
      __openclaw: { id: 'next', idempotencyKey: 'next:user', transcriptPosition: { source, rawSeq: 12 } } },
  ];
  return messagesFromPayload({ sessionKey, sessionId, messages: rows });
}

function live(text: string, state: 'delta' | 'final' = 'final') {
  return projectGatewayEvent({ event: 'chat', payload: { sessionKey, runId, state, message: { content: text } } }, sessionKey)!.message;
}

function footer(): WorkspaceMessage {
  return { id: `live-run-${runId}`, role: 'run', text: '✓ done in 4m 1s',
    source: 'live', sessionKey, runId, state: 'complete' };
}

function current(text: string, canonical = history()) {
  return [...canonical.slice(0, -1), live(text), footer(), canonical.at(-1)!];
}

describe('Claude native steps and terminal cumulative live chat', () => {
  it('retires the exact cumulative commentary copy and keeps native order and the run footer', () => {
    const text = texts.join('\n\n');
    const canonical = history();
    const first = live(texts[0]!, 'delta');
    const second = upsertLiveMessage([first], live(texts.slice(0, 2).join('\n\n'), 'delta'));
    const terminal = upsertLiveMessage(second, live(text));
    expect(terminal).toHaveLength(1);
    expect(terminal[0]).toMatchObject({ id: `live-chat-${runId}`, text, state: 'complete' });
    const rows = mergeLatestHistory(canonical, current(text, canonical), sessionKey);
    expect(live(text)).toMatchObject({ id: `live-chat-${runId}`, role: 'assistant', state: 'complete', source: 'live', runId });
    expect(rows.map(row => row.id)).toEqual(['prompt', 'earlier-answer',
      'step-0#tool-1', 'step-0', 'step-1#tool-1', 'step-1', 'step-2#tool-1', 'step-2', `live-run-${runId}`, 'next']);
    expect(rows.filter(row => row.id.startsWith('step-')).map(row => row.role))
      .toEqual(['tool', 'narration', 'tool', 'narration', 'tool', 'narration']);
    expect(mergeLatestHistory(canonical, parsedTranscriptCache(serializedTranscriptCache(current(text, canonical))), sessionKey)
      .some(row => row.id === `live-chat-${runId}`)).toBe(false);
    expect(upsertLiveMessage(rows, live(text)).some(row => row.id === `live-chat-${runId}`)).toBe(false);
  });

  it('retires an exact cumulative commentary and end-turn answer copy', () => {
    const text = [...texts, 'The change is sound.'].join('\n\n');
    const canonical = history(true);
    const rows = mergeLatestHistory(canonical, current(text, canonical), sessionKey);
    expect(rows.map(row => row.id)).toEqual(['prompt', 'earlier-answer',
      'step-0#tool-1', 'step-0', 'step-1#tool-1', 'step-1', 'step-2#tool-1', 'step-2',
      'answer', `live-run-${runId}`, 'next']);
    expect(rows.find(row => row.id === 'answer')?.role).toBe('assistant');
  });

  it('retires a completed copy whose live footer was replaced by the answer history footer', () => {
    // Physical example-slides turn: narration and the end-turn answer streamed as
    // one live text stamped at the first narration. Sorted above the tool rows,
    // it left the saved answer last, so the rebuilt footer is
    // `history-run-answer`, not `history-run-<live id>`.
    const text = [...texts, 'The change is sound.'].join('\n\n');
    const canonical = withHistoryRunCompletions(history(true));
    expect(canonical.filter(row => row.role === 'run').map(row => row.id)).toEqual(['history-run-answer']);
    const stamped: WorkspaceMessage = { ...live(text), timestamp: canonical.find(row => row.id === 'step-0')!.timestamp! };
    const promptIndex = canonical.findIndex(row => row.id === 'earlier-answer') + 1;
    const shown = [...canonical.slice(0, promptIndex), stamped, ...canonical.slice(promptIndex)];
    const rows = mergeLatestHistory(canonical, shown, sessionKey);
    expect(rows.some(row => row.id === `live-chat-${runId}`)).toBe(false);
    expect(rows.filter(row => row.role === 'assistant' && row.text === 'The change is sound.')).toHaveLength(1);
    expect(rows.filter(row => row.role === 'run').map(row => row.id)).toEqual(['history-run-answer']);
    expect(provenClaudeNativeLive(shown)).toHaveLength(1);
    expect(claudeNativeLiveDiagnosis(shown, stamped)).toBe('match');
    // A turn without a completed saved answer still has no footer authority.
    const unfinished = withHistoryRunCompletions(history(false));
    const partial: WorkspaceMessage = { ...live(texts.join('\n\n')), timestamp: unfinished.find(row => row.id === 'step-0')!.timestamp! };
    expect(provenClaudeNativeLive([...unfinished, partial])).toHaveLength(0);
  });

  it('retires canonical-first cumulative Claude copies through repeated late finals', () => {
    const canonical = withHistoryRunCompletions(history(true));
    const text = [...texts, 'The change is sound.'].join('\n\n');
    const incoming = { ...live(text), timestamp: canonical.find(row => row.id === 'step-0')!.timestamp! };
    // No previous live/absorption receipt: the saved parts and answer footer
    // arrive first. Raw first-final conversion precedes the outer matcher.
    let rows = canonical;
    for (let replay = 0; replay < 3; replay += 1) {
      rows = upsertLiveMessage(rows, { ...incoming });
      expect(rows).toEqual(canonical);
      expect(rows.some(row => row.id === incoming.id)).toBe(false);
      expect(rows.find(row => row.id === 'answer')?.text).toBe('The change is sound.');
    }
    // An answer-only first final can be absorbed into its canonical row.
    // A later cumulative envelope must not escape that conversion receipt.
    const owned = canonical.map(row => row.id === 'prompt' ? { ...row, runId } : row);
    const adopted = upsertLiveMessage(owned, { ...incoming, text: 'The change is sound.', chatCumulativeText: 'The change is sound.' });
    expect(adopted.find(row => row.id === 'answer')?.absorbedLiveIdentity).toEqual({ messageId: incoming.id, runId });
    const late = upsertLiveMessage(adopted, incoming);
    expect(late.map(row => row.id)).toEqual(canonical.map(row => row.id));
    expect(late.find(row => row.id === 'answer')?.text).toBe('The change is sound.');
  });

  it('keeps streaming, partial, cross-scope and ambiguous copies', () => {
    const canonical = history();
    const exact = texts.join('\n\n');
    expect(provenClaudeNativeLive([...canonical, live(exact), footer()])).toHaveLength(1);
    expect(provenClaudeNativeLive([...canonical, live(texts.slice(0, 2).join('\n\n')), footer()])).toHaveLength(1);
    for (const candidate of [live(exact, 'delta'),
      { ...live(exact), transcriptSessionId: '33333333-3333-4333-8333-333333333333' },
      { ...live(exact), attachments: [{ id: 'image', filename: 'image.png', mimeType: 'image/png' }] }]) {
      expect(provenClaudeNativeLive([...canonical, candidate, footer()])).toEqual([]);
    }
    const otherRoute = canonical.map(row => ({ ...row, sessionKey: 'another-route' }));
    expect(provenClaudeNativeLive([...otherRoute, live(exact), footer()])).toEqual([]);
    const otherCliSession = '44444444-4444-4444-8444-444444444444';
    const duplicate = canonical.filter(row => row.role === 'narration').map((row, index) => ({
      ...row, id: `second-${index}`, cliProvenance: {
        kind: 'claude-native' as const, sessionId: otherCliSession, externalId: `second-${index}`,
      },
    }));
    expect(provenClaudeNativeLive([...canonical, ...duplicate, live(exact), footer()])).toEqual([]);
    expect(provenClaudeNativeLive([...canonical.map(row => {
      if (row.id !== 'step-1') return row;
      const { cliProvenance: _provenance, ...withoutProvenance } = row;
      return withoutProvenance;
    }), live(exact), footer()])).toEqual([]);
    expect(provenClaudeNativeLive([...canonical, live(exact)])).toEqual([]);
    const boundary: WorkspaceMessage = { id: 'boundary', role: 'boundary', text: '--- compaction ---',
      timestamp: '2150', source: 'history', sessionKey, transcriptSessionId: sessionId };
    expect(provenClaudeNativeLive([...canonical, boundary, live(exact), footer()])).toEqual([]);
    expect(provenClaudeNativeLive([...canonical.map(row => row.id.startsWith('step-')
      ? { ...row, transcriptSessionId: '33333333-3333-4333-8333-333333333333' } : row), live(exact), footer()])).toEqual([]);
    const otherRun = { ...live(exact), id: 'live-chat-other-run', runId: 'other-run' };
    const otherFooter = { ...footer(), id: 'live-run-other-run', runId: 'other-run' };
    expect(provenClaudeNativeLive([...canonical, otherRun, otherFooter])).toHaveLength(1);
  });
});
