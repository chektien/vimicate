import { describe, expect, it } from 'vitest';
import { type WorkspaceMessage } from '../workspace/workspaceTypes';
import { mergeLatestHistory } from './historyPagination';

const sessionKey = 's';
const row = (id: string, role: WorkspaceMessage['role'], source: NonNullable<WorkspaceMessage['source']>, extra: Omit<WorkspaceMessage, 'id' | 'role' | 'source' | 'text'> = {}): WorkspaceMessage =>
  ({ id, role, source, text: id, sessionKey, ...extra });

describe('latest refresh places mounted local, assistant and detail rows from their publication', () => {
  it('keeps a composed pending turn stable across repeated refreshes', () => {
    const firstPrompt = row('p1', 'user', 'history', { timestamp: '1000', runId: 'r1' });
    const firstAnswer = row('a1', 'assistant', 'history', { timestamp: '1100', state: 'complete' });
    const latest = [firstPrompt, firstAnswer];
    const current: WorkspaceMessage[] = [
      firstPrompt,
      row('t1', 'tool', 'live', { runId: 'r1' }),
      firstAnswer,
      row('local-p2', 'user', 'local', { runId: 'r2', idempotencyKey: 'p2' }),
      row('n2', 'narration', 'live', { runId: 'r2' }),
      row('t2', 'tool', 'live', { runId: 'r2' }),
      row('live-chat-r2', 'assistant', 'live', { runId: 'r2', state: 'streaming' }),
      row('local-p3', 'user', 'local', { runId: 'r2', idempotencyKey: 'p3' }),
      row('t3', 'tool', 'live', { runId: 'r2' }),
    ];
    const once = mergeLatestHistory(latest, current, sessionKey);
    expect(once.map(message => message.id)).toEqual(['p1', 't1', 'a1', 'local-p2', 'n2', 't2', 'local-p3', 'live-chat-r2', 't3']);
    expect(mergeLatestHistory(latest, once, sessionKey).map(message => message.id)).toEqual(once.map(message => message.id));
  });

  it('keeps an untimed unowned live answer and its detail at their published slots', () => {
    const answer = row('a1', 'assistant', 'history', { state: 'complete' });
    const later = row('a2', 'assistant', 'history', { state: 'complete' });
    const current: WorkspaceMessage[] = [
      answer,
      row('local-p2', 'user', 'local'),
      row('live-answer', 'assistant', 'live', { state: 'streaming' }),
      row('live-tool', 'tool', 'live', { state: 'streaming' }),
      later,
    ];
    const once = mergeLatestHistory([answer, later], current, sessionKey);
    expect(once.map(message => message.id)).toEqual(['a1', 'local-p2', 'live-answer', 'live-tool', 'a2']);
    expect(mergeLatestHistory([answer, later], once, sessionKey)).toEqual(once);
  });
});
