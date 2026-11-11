import { expect, it } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import type { OpenClawClient } from './OpenClawClient';
import type { ArchivedHistoryState } from './archivedHistory';
import { loadVisibleOlderHistoryBatch } from './loadVisibleOlderHistoryBatch';
import { loadVisibleNewerHistoryBatch } from './loadVisibleNewerHistoryBatch';

it.each(['older', 'newer'])('classifies retained private question context on %s archive pages before publication', async direction => {
  const key = 'archive-question';
  const old = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const current = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const segment = { sessionId: old, order: 0, state: 'archived' as const, sourceRevision: 'immutable' };
  const archive: ArchivedHistoryState = { identity: { sessionKey: key, currentSessionId: current, currentSessionStartedAtMs: 100, contract: 'sqlite-family-v1' },
    familyToken: 'family', segments: [segment, { sessionId: current, order: 1, state: 'current', sourceRevision: 'current' }],
    nextArchivedIndex: 0, exhausted: false, pageCursor: { segmentIndex: 0, nextOffset: direction === 'older' ? 0 : 2, totalRawRecords: 2 } };
  const context: WorkspaceMessage = { id: `archive:${old}:question`, sessionKey: key, transcriptSessionId: old,
    role: 'assistant', source: 'history', text: '', asyncQuestion: { itemId: 'private', questions: [{ title: 'Location?', options: ['/Users/fixture/a', '/Users/fixture/b'] }] } };
  const edge: WorkspaceMessage = { id: `archive:${old}:edge`, sessionKey: key, transcriptSessionId: old, role: 'assistant', source: 'history', text: 'Edge' };
  const raw = [{ id: 'edge', role: 'assistant', content: 'Edge' }, { id: 'reply', role: 'user', content: '> Location?\n\n/Users/fixture/a' }];
  const client = { status: 'connected', history: async () => ({ sessionKey: key, sessionId: current, offset: 0, totalMessages: 0, messages: [], hasMore: false, nextOffset: null }), decorateMessages: (rows: WorkspaceMessage[]) => rows,
    archivedHistoryRequest: async (params: Record<string, unknown>) => {
      const offset = params.offset as number;
      const rows = raw.slice(Math.max(0, 2 - offset - (params.limit as number)), 2 - offset);
      const next = offset + rows.length;
      return { contract: 'sqlite-family-v1', proof: 'verified-import+sqlite-ownership-v1', stableSessionKey: key,
        currentSessionId: current, currentSessionStartedAtMs: 100, familyToken: 'family', sessionId: old, segment,
        offset, messages: rows, totalMessages: 2, hasMore: next < 2, nextOffset: next < 2 ? next : null };
    },
  } as unknown as OpenClawClient;
  const input = { client, sessionKey: key, path: '', visible: [edge], cursor: null, archive, context: {},
    narration: [], owns: () => true, projectionContext: () => [context], scan: null };
  const rows = direction === 'older' ? (await loadVisibleOlderHistoryBatch(input)).older : (await loadVisibleNewerHistoryBatch(input)).newer;
  const reply = rows.find(row => row.id === `archive:${old}:reply`);
  expect(reply).toBeDefined();
  expect(reply!.text).not.toContain('/Users/fixture/a');
  expect(reply!.asyncQuestionAnswerText).toContain('/Users/fixture/a');
});
