// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { AsyncQuestionOwner } from '../questions/asyncQuestionOwner';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import type { OpenClawClient } from './OpenClawClient';
vi.mock('../storage/workspaceStore', () => ({
  saveTranscriptCache: async () => {}, loadTranscriptCache: async () => [],
  saveHistoryReviewCache: async () => {}, loadHistoryReviewCache: async () => null,
}));
import { useGatewayHistory } from './useGatewayHistory';

it('uses retained question facts before reply-only history becomes visible or cached', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const key = 'agent:fixture:retained-question';
  const generation = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const question: WorkspaceMessage = {
    id: 'cropped-question', role: 'assistant', source: 'history', state: 'complete',
    sessionKey: key, transcriptSessionId: generation, text: 'Choose a location',
    asyncQuestion: { itemId: 'cropped-item', questions: [{ title: 'Location?', options: ['/Users/fixture/a', '/Users/fixture/b'] }] },
  };
  const questions = new AsyncQuestionOwner(); questions.observe([question]);
  const payload = { sessionKey: key, sessionId: generation, offset: 0, hasMore: false, nextOffset: null, totalMessages: 1,
    messages: [{ id: 'remote-answer', role: 'user', content: '> Location?\n\n/Users/fixture/a' }] };
  const client = { status: 'connected', history: vi.fn(async () => payload), followSession: async () => {},
    decorateMessages: (rows: WorkspaceMessage[]) => rows } as unknown as OpenClawClient;
  const host = document.createElement('div'); const root = createRoot(host);
  let history!: ReturnType<typeof useGatewayHistory>;
  function Probe() {
    history = useGatewayHistory(client, { current: key }, () => {}, key, true, undefined,
      (_key, rows) => questions.observe(rows), () => questions.projectionContext());
    return <div>{history.messages.map(row => row.text).join('\n')}</div>;
  }
  try {
    await act(async () => root.render(<Probe />));
    await act(async () => {
      history.resetHistory({ id: key, sessionKey: key, sessionId: generation, name: 'Synthetic', path: '', branch: '', starred: false, threadCount: 0, state: 'idle' }, null);
      await history.loadHistory(key);
    });
    expect(history.messages.some(row => row.id === question.id)).toBe(false);
    for (const rows of [history.messages, history.sessionMessages(key), history.visibleSessionMessages(key)]) {
      const reply = rows.find(row => row.id === 'remote-answer');
      expect(reply).toBeDefined();
      expect(reply!.text).not.toContain('/Users/fixture/a');
      expect(reply!.asyncQuestionAnswerText).toContain('/Users/fixture/a');
    }
    expect(questions.view(question)?.state).toBe('confirmed');
  } finally {
    await act(async () => root.unmount()); vi.unstubAllGlobals();
  }
});

it.each(['explicit', 'implicit'])('confirms restored question facts from a %s remote reply-only page without a local outbox', mode => {
  const question: WorkspaceMessage = { id: 'original-question', role: 'assistant', source: 'history', sessionKey: 'root',
    transcriptSessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', text: 'Which?',
    asyncQuestion: { itemId: 'restored-item', questions: [{ title: 'Which?', options: ['A', 'B'] }] } };
  const original = new AsyncQuestionOwner(); original.observe([question]);
  const restored = new AsyncQuestionOwner(); restored.restore(original.serialize());
  const reply: WorkspaceMessage = { id: 'remote', role: 'user', source: 'history', sessionKey: question.sessionKey!,
    transcriptSessionId: question.transcriptSessionId!, text: mode === 'explicit' ? 'Edited remote answer' : '> Which?\n\nA',
    ...(mode === 'explicit' ? { asyncQuestionReplyToId: question.id } : {}) };
  restored.observe([{ ...reply, transcriptSessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }]);
  expect(restored.view(question)?.state).toBe('pending');
  restored.observe([reply]);
  restored.observe([question]);
  expect(restored.view(question)?.state).toBe('confirmed');
});

it('retains a witnessed retirement when later failed runs exhaust the causal witness budget', () => {
  const question: WorkspaceMessage = { id: 'q-budget', role: 'assistant', source: 'history', sessionKey: 'root',
    transcriptSessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', runId: 'origin', displayPosition: { source: 'codex', rawSeq: 20 }, text: 'Which?',
    asyncQuestion: { itemId: 'budget-item', questions: [{ title: 'Which?', options: ['A', 'B'] }] } };
  const row = (id: string, seq: number, role: WorkspaceMessage['role'], outcome?: 'successful' | 'settled'): WorkspaceMessage => ({
    id, role, source: 'history', sessionKey: question.sessionKey!, transcriptSessionId: question.transcriptSessionId!,
    runId: id, text: id, displayPosition: { source: 'codex', rawSeq: seq }, ...(outcome ? { asyncQuestionRunOutcome: outcome } : {}),
  });
  const owner = new AsyncQuestionOwner();
  owner.observe([question, { ...row('origin-end', 30, 'assistant', 'successful'), runId: 'origin' },
    { ...row('success-start', 40, 'user'), runId: 'success' }, { ...row('success-end', 50, 'assistant', 'successful'), runId: 'success' }]);
  expect(owner.view(question)?.state).toBe('history');
  for (let i = 0; i < 20; i++) owner.observe([row(`failed-${i}`, 60 + i, 'assistant', 'settled')]);
  expect(owner.view(question)?.state).toBe('history');
});

it('classifies continuity bridge replies from retained facts without using those facts as rendered witnesses', async () => {
  const { completedNativeHistoryContinuity } = await import('./latestHistoryContinuity');
  const key = 'bridge-question'; const generation = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const row = (id: string, seq: number): WorkspaceMessage => ({ id, role: 'assistant', source: 'history', sessionKey: key,
    transcriptSessionId: generation, text: id, displayPosition: { source: 'codex', rawSeq: seq } });
  const edge = row('old-edge', 10); const fresh = row('fresh', 100);
  const question = { ...row('cropped-question', 20), asyncQuestion: { itemId: 'bridge-item', questions: [{ title: 'Location?', options: ['/Users/fixture/a', '/Users/fixture/b'] }] } };
  const questions = new AsyncQuestionOwner(); questions.observe([question]);
  const client = { decorateMessages: (rows: WorkspaceMessage[]) => rows,
    history: async (_key: string, _limit: number, offset: number) => ({ sessionKey: key, sessionId: generation,
      offset, totalMessages: 1000, hasMore: offset === 80, nextOffset: offset === 80 ? 160 : null,
      messages: offset === 80 ? [{ id: 'reply', role: 'user', content: '> Location?\n\n/Users/fixture/a', __openclaw: { transcriptPosition: { source: 'codex', rawSeq: 50 } } }]
        : [{ id: edge.id, role: 'assistant', content: edge.text, __openclaw: { transcriptPosition: edge.displayPosition } }] }),
  } as unknown as OpenClawClient;
  const completed = { messages: [fresh], cursor: { sessionKey: key, nextOffset: 80, totalMessages: 1000, hasMore: true } };
  const result = await completedNativeHistoryContinuity(client, key, completed, [edge], '', () => true, true, () => questions.projectionContext());
  expect(result?.messages.find(row => row.id === 'reply')?.text).not.toContain('/Users/fixture/a');
  expect(result?.messages.find(row => row.id === 'reply')?.asyncQuestionAnswerText).toContain('/Users/fixture/a');
  expect(result?.messages.some(row => row.id === question.id)).toBe(false);
  expect(result?.cursor.nextOffset).toBe(80);
});
