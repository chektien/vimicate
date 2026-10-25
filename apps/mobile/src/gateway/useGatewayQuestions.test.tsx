// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useGatewayQuestions } from './useGatewayQuestions';
import { HistoryPublicationAuthority } from './historyPublicationAuthority';
import type { OpenClawClient } from './OpenClawClient';
import type { QuestionRecord } from '../questions/questionTypes';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
const record: QuestionRecord = { id: 'qa', sessionKey: 'qa', createdAtMs: 1, expiresAtMs: Date.now() + 90000, status: 'pending', questions: [{ questionId: 'pick', isOther: true, header: 'Pick', question: 'Which?', options: [{ label: 'A' }, { label: 'B' }] }] };
const noMessages: never[] = []; const noProjects: never[] = [];
function testOwner(request: ReturnType<typeof vi.fn>, messages: WorkspaceMessage[] = noMessages) {
  let currentMessages = messages;
  const client = { status: 'connected', connectionRevision: 1, hasOperatorScope: () => true, request } as unknown as OpenClawClient;
  const authority = { current: new HistoryPublicationAuthority(true) };
  let value!: ReturnType<typeof useGatewayQuestions>;
  const root = createRoot(document.createElement('div'));
  function Component() { value = useGatewayQuestions(client, client.status, authority, currentMessages, 'qa', noProjects, 'qa'); return null; }
  return { client, authority, root, setMessages: (next: WorkspaceMessage[]) => { currentMessages = next; }, render: () => act(async () => root.render(<Component />)), value: () => value };
}
it('requires Enter to interact and keeps navigation and Escape answer-neutral', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const test = testOwner(vi.fn(async () => ({ questions: [record] }))); await test.render();
  const press = async (key: string, expected = true) => act(async () => {
    expect(test.value().ui.handleKey(record, { key, shift: false, command: false, control: false, option: false })).toBe(expected);
  });
  await press('j', false); expect(test.value().ui.draft(record).selected).toEqual({});
  await press('enter'); await act(async () => test.value().ui.leave('another-question')); await press('j');
  expect(test.value().ui.draft(record)).toMatchObject({ cursor: 1, selected: {} });
  await press('escape'); await press('k', false);
  expect(test.value().messages[0]?.question?.status).toBe('pending');
  await act(async () => test.root.unmount());
});
it('sends the nested answer envelope once and waits for actual confirmation', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let finish!: (value: unknown) => void;
  const request = vi.fn((method: string) => method === 'question.list' ? Promise.resolve({ questions: [record] }) : new Promise(resolve => { finish = resolve; }));
  const test = testOwner(request); await test.render();
  await act(async () => { test.value().ui.handleKey(record, { key: 'enter', shift: false, command: false, control: false, option: false }); });
  await act(async () => { expect(test.value().ui.handleKey(record, { key: 'o', shift: false, command: false, control: false, option: false })).toBe(true); });
  expect(test.value().ui.otherFocus).toMatchObject({ id: 'qa', question: 0 });
  await act(async () => { test.value().ui.choose(record, 0, 1); });
  let task!: Promise<void>;
  await act(async () => { task = test.value().ui.resolve(record); });
  await act(async () => { await test.value().ui.resolve(record); });
  expect(request).toHaveBeenCalledWith('question.resolve', { id: 'qa', answers: { answers: { pick: ['B'] } }, resolvedBy: 'Vimicate' });
  expect(request.mock.calls.filter(([method]) => method === 'question.resolve')).toHaveLength(1);
  expect(test.value().messages[0]?.question?.status).toBe('pending');
  request.mockImplementation(() => Promise.resolve({ questions: [] }));
  await act(async () => { finish({ status: 'answered', answers: { answers: { pick: ['B'] } } }); await task; });
  expect(test.value().messages[0]?.text).toContain('Question answered · B');
  await act(async () => test.root.unmount());
});
it('refuses secret input and suppresses retired connection hydration', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let finish!: (value: unknown) => void;
  const request = vi.fn(() => new Promise(resolve => { finish = resolve; }));
  const test = testOwner(request); await test.render();
  (test.client as unknown as { connectionRevision: number }).connectionRevision++;
  await act(async () => finish({ questions: [record] }));
  expect(test.value().messages).toEqual([]);
  await act(async () => test.value().event({ event: 'question.requested', payload: { ...record, questions: [{ ...record.questions[0], isSecret: true }] } }));
  await act(async () => { await test.value().ui.resolve(record); });
  expect(request).toHaveBeenCalledTimes(1);
  await act(async () => test.root.unmount());
});
it('retires in-flight hydration when pairing clears the question owner without a transport change', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let finish!: (value: unknown) => void;
  const request = vi.fn(() => new Promise(resolve => { finish = resolve; }));
  const test = testOwner(request); await test.render();
  await act(async () => test.value().clear());
  await act(async () => finish({ questions: [record] }));
  expect(test.value().messages).toEqual([]);
  await act(async () => test.root.unmount());
});

it('retires connection permission notices when access returns or the owner is cleared', async () => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const test = testOwner(vi.fn(async () => ({ questions: [] })));
  test.client.hasOperatorScope = () => false;
  test.client.questionScopeNotice = 'Question cards await device approval. Normal chat still works.';
  try {
    await test.render(); expect(test.value().notice).toContain('await device approval');
    test.client.hasOperatorScope = () => true; test.client.questionScopeNotice = '';
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(test.value().notice).toBe('');
    test.client.hasOperatorScope = () => false; test.client.questionScopeNotice = 'Question cards unavailable';
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(test.value().notice).toBe('Question cards unavailable');
    await act(async () => test.value().clear()); expect(test.value().notice).toBe('');
  } finally { await act(async () => test.root.unmount()); vi.useRealTimers(); }
});
it('does not display connection permission notices while disconnected or erase question-list errors', async () => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const test = testOwner(vi.fn(async () => { throw new Error('list temporarily unavailable'); }));
  try {
    await test.render(); expect(test.value().notice).toContain('Question cards could not be loaded');
    test.client.questionScopeNotice = '';
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(test.value().notice).toContain('Question cards could not be loaded');
    test.client.status = 'disconnected'; await test.render(); expect(test.value().notice).toBe('');
  } finally { await act(async () => test.root.unmount()); vi.useRealTimers(); }
});


it('preserves the interacting question through older-window loading, resolution and stale reconnect hydration', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const createdAtMs = Date.now() - 1000;
  const pending = { ...record, runId: 'review-run', createdAtMs };
  const later: WorkspaceMessage = { id: 'later', role: 'assistant', text: 'Synthetic later continuation', sessionKey: 'qa', runId: 'review-run', timestamp: new Date(createdAtMs + 100).toISOString() };
  const review: WorkspaceMessage = { ...later, id: 'review', text: 'Synthetic supporting review', timestamp: String(createdAtMs - 100) };
  const request = vi.fn(async (method: string) => method === 'question.list' ? { questions: [pending, pending] }
    : { status: 'answered', answers: { answers: { pick: ['B'] } } });
  const test = testOwner(request, [later]);
  const key = (key: string) => ({ key, shift: false, command: false, control: false, option: false });
  try {
    await test.render();
    expect(test.value().messages.map(m => m.id)).toEqual(['question:qa:qa', 'later']);
    await act(async () => {
      expect(test.value().ui.handleKey(pending, key('j'))).toBe(false);
      expect(test.value().ui.handleKey(pending, key('enter'))).toBe(true);
    });
    await act(async () => { test.value().ui.handleKey(pending, key('j')); });
    expect(test.value().ui.draft(pending).cursor).toBe(1);
    test.setMessages([review, later]); await test.render();
    expect(test.value().messages.map(m => m.id)).toEqual(['review', 'question:qa:qa', 'later']);
    expect(test.value().ui.interaction).toBe('qa');
    await act(async () => { expect(test.value().ui.handleKey(pending, key('k'))).toBe(true); });
    expect(test.value().ui.draft(pending).cursor).toBe(0);
    await act(async () => test.value().ui.choose(pending, 0, 1));
    await act(async () => test.value().ui.resolve(pending));
    await act(async () => test.value().hydrate());
    expect(test.value().messages.map(m => m.id)).toEqual(['review', 'question:qa:qa', 'later']);
    expect(test.value().messages[1]?.question?.status).toBe('answered');
    expect(test.value().pendingSessions.size).toBe(0);
    expect(test.value().ui.handleKey(test.value().messages[1]!.question!, key('j'))).toBe(false);
    expect(request.mock.calls.filter(([method]) => method === 'question.resolve')).toHaveLength(1);
  } finally { await act(async () => test.root.unmount()); }
});
