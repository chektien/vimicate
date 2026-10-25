import { describe, expect, it } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { withHistoryRunCompletions } from './historyRunCompletion';

const message = (id: string, role: WorkspaceMessage['role'], timestamp: number, text = id): WorkspaceMessage => ({ id, role, text, timestamp: String(timestamp), source: 'history', sessionKey: 'one' });
const epoch = 1_800_000_000_000;

describe('historical run completion projection', () => {
  it('adds one native-like completion after the final assistant in a timestamped turn', () => {
    const result = withHistoryRunCompletions([
      message('prompt', 'user', epoch),
      message('narration', 'assistant', epoch + 1_000),
      message('tool', 'tool', epoch + 2_000),
      message('answer', 'assistant', epoch + 75_000),
    ]);
    expect(result.map((row) => row.text)).toEqual(['prompt', 'narration', 'tool', 'answer', '✓ done in 1m 15s']);
  });

  it('does not claim completion for an unfinished turn or duplicate an existing footer', () => {
    const existing: WorkspaceMessage = { ...message('done', 'run', epoch + 3_000, '✓ done in 3s'), state: 'complete' };
    expect(withHistoryRunCompletions([message('prompt', 'user', epoch), message('tool', 'tool', epoch + 1_000)])).toHaveLength(2);
    expect(withHistoryRunCompletions([message('prompt', 'user', epoch), message('answer', 'assistant', epoch + 3_000), existing])).toHaveLength(3);
  });

  it('removes an orphaned streaming start row restored from an old cache', () => {
    const start: WorkspaceMessage = { ...message('start', 'run', epoch, 'start'), state: 'streaming', source: 'live' };
    expect(withHistoryRunCompletions([start, message('prompt', 'user', epoch + 1_000), message('answer', 'assistant', epoch + 2_000)]).map((row) => row.text)).toEqual(['prompt', 'answer', '✓ done in 1s']);
  });
});

it('does not turn an optional async question into a completed-run footer', () => {
  const q = { ...message('question', 'assistant', epoch + 1_000), asyncMessage: true, asyncQuestion: { itemId: 'q', questions: [{ title: 'Which?' }] } };
  expect(withHistoryRunCompletions([message('prompt', 'user', epoch), q])).toHaveLength(2);
});

it.each([
  { boundary: true, scope: { transcriptSessionId: 'g2' } },
  { boundary: true, scope: { transcriptSessionId: 'g1' } },
  { boundary: false, scope: { transcriptSessionId: 'g2' } },
  { boundary: false, scope: { sessionKey: 'other', transcriptSessionId: 'g1' } },
])('does not synthesize completion across a boundary or concrete scope change: %j', ({ boundary, scope }) => {
  const prompt: WorkspaceMessage = { id: 'p', role: 'user', text: 'request', source: 'history',
    sessionKey: 's', transcriptSessionId: 'g1', timestamp: '1788265860000' };
  const answer: WorkspaceMessage = { id: 'a', role: 'assistant', text: 'answer', source: 'history', state: 'complete',
    sessionKey: 's', timestamp: '1788265861000', ...scope };
  const rows = [prompt, ...(boundary ? [{ ...answer, id: 'boundary', role: 'boundary' as const, text: 'new generation' }] : []), answer];
  expect(withHistoryRunCompletions(rows)).toEqual(rows);
});

it('keeps the saved-answer footer identity and concrete generation within an ordinary turn', () => {
  const prompt = { ...message('p', 'user', epoch), transcriptSessionId: 'g1' };
  const answer = { ...message('a', 'assistant', epoch + 1_000), transcriptSessionId: 'g1', state: 'complete' as const };
  expect(withHistoryRunCompletions([prompt, answer]).at(-1)).toMatchObject({
    id: 'history-run-a', transcriptSessionId: 'g1', sessionKey: 'one', text: '✓ done in 1s',
  });
});

// Physical claude-cli turn (6 Oct): the first-words live row merged into a
// history window produced "✓ done in 18s" while the run was still working.
it('does not synthesize a completion footer from a still-streaming live answer', () => {
  const prompt = { id: 'prompt', role: 'user' as const, text: 'Check steering.', source: 'history' as const, sessionKey: 's', timestamp: '1791268502000' };
  const streaming = { id: 'live-chat-r', role: 'assistant' as const, text: 'Both of', source: 'live' as const, sessionKey: 's', runId: 'r', state: 'streaming' as const, timestamp: '1791268520600' };
  expect(withHistoryRunCompletions([prompt, streaming]).filter(row => row.role === 'run')).toEqual([]);
  const finished = { ...streaming, state: 'complete' as const, text: 'Both of your messages arrived together.' };
  expect(withHistoryRunCompletions([prompt, finished]).filter(row => row.role === 'run').map(row => row.id)).toEqual(['history-run-live-chat-r']);
});
