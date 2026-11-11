import { expect, it } from 'vitest';
import { AsyncQuestionOwner } from './asyncQuestionOwner';
import { messagesFromPayload } from '../workspace/historyMessageProjection';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
const question: WorkspaceMessage = { id: 'question', role: 'assistant', source: 'history', sessionKey: 'root', transcriptSessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', runId: 'origin', displayPosition: { source: 'codex', rawSeq: 20 }, text: 'Which?', asyncQuestion: { itemId: 'item', questions: [{ title: 'Which?', options: ['A', 'B'] }] } };
const row = (id: string, seq: number, runId: string, role: WorkspaceMessage['role'] = 'assistant'): WorkspaceMessage => { const { asyncQuestion: _question, ...base } = question; return { ...base, id, role, runId, text: id, displayPosition: { source: 'codex', rawSeq: seq } }; };
it.each(['replyTo', 'key'])('confirms retained and restored deliveries from reply-only observations using %s identity', mode => {
  const owner = new AsyncQuestionOwner(); owner.observe([question]); owner.admit(question, 'submission');
  const restored = new AsyncQuestionOwner(); restored.restore(owner.serialize());
  const reply = { ...row('reply', 50, 'answer', 'user'), text: 'edited answer', ...(mode === 'replyTo' ? { asyncQuestionReplyToId: 'question' } : { idempotencyKey: 'submission:user' }) };
  for (const target of [owner, restored]) { target.observe([reply]); target.observe([question]); expect(target.view(question)?.state).toBe('confirmed'); }
});
it('rejects conflicting reply identities and concrete generations', () => {
  const owner = new AsyncQuestionOwner(); owner.observe([question]); owner.admit(question, 'submission');
  for (const reply of [{ ...row('reply', 50, 'answer', 'user'), transcriptSessionId: 'foreign', asyncQuestionReplyToId: 'question' }, { ...row('reply', 50, 'answer', 'user'), asyncQuestionReplyToId: 'different', idempotencyKey: 'submission:user' }]) owner.observe([question, reply]);
  expect(owner.view(question)?.state).toBe('queued');
});
it('retains origin settlement and successor start across bounded pages, but not terminal-only or overlapping runs', () => {
  const settled = { ...row('origin-end', 30, 'origin'), asyncQuestionRunOutcome: 'successful' as const };
  const end = { ...row('later-end', 60, 'later'), asyncQuestionRunOutcome: 'successful' as const };
  const owner = new AsyncQuestionOwner(); owner.observe([question, settled]); owner.observe([end]); expect(owner.view(question)?.state).toBe('pending');
  owner.observe([row('start', 40, 'later', 'user')]); expect(owner.view(question)?.state).toBe('history');
  for (const outcome of ['settled', 'settled'] as const) { const control = new AsyncQuestionOwner(); control.observe([question, settled]); control.observe([row('start', 40, 'later', 'user'), { ...end, asyncQuestionRunOutcome: outcome }]); expect(control.view(question)?.state).toBe('pending'); }
  const overlap = new AsyncQuestionOwner(); overlap.observe([question, row('start', 25, 'later', 'user'), settled]); overlap.observe([end]); expect(overlap.view(question)?.state).toBe('pending');
});
it('clears actionability on admission independently of delivery failure and discard', () => {
  const owner = new AsyncQuestionOwner(); owner.observe([question]); const record = owner.view(question)!.record;
  owner.admit(question, 'submission'); expect([...owner.pendingCounts(() => true)]).toEqual([]);
  owner.delivery(record.id, 'failed'); expect([...owner.pendingCounts(() => true)]).toEqual([]); expect(owner.view(question)?.state).toBe('failed');
  owner.discard(record.id); expect([...owner.pendingCounts(() => true)]).toEqual([['root', 1]]);
});
it('classifies implicit private replies with retained validated context before publication', () => {
  const retained = { ...question, asyncQuestion: { itemId: 'private', questions: [{ title: 'Which?', options: ['/Users/person/a', '/Users/person/b'] }] } };
  const payload = { sessionKey: 'root', sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', messages: [{ id: 'reply', role: 'user', content: '> Which?\n\n/Users/person/a' }] };
  const projected = messagesFromPayload(payload, '', [retained]); expect(projected[0]?.asyncQuestionAnswerText).toContain('/Users/person/a'); expect(projected[0]?.text).not.toContain('/Users/person/a');
  expect(messagesFromPayload({ ...payload, sessionId: 'foreign' }, '', [retained])[0]?.asyncQuestionAnswerText).toBeUndefined();
  expect(messagesFromPayload({ ...payload, messages: [{ id: 'quote', role: 'user', content: '> Unrelated?\n\nOrdinary quote' }] }, '', [retained])[0]?.asyncQuestionAnswerText).toBeUndefined();
});

it('confirms retained remotely answered questions without a local delivery', () => {
  const owner = new AsyncQuestionOwner(); owner.observe([question]); owner.observe([{ ...row('remote', 50, 'remote', 'user'), text: 'Remote answer', asyncQuestionReplyToId: 'question' }]);
  expect(owner.view(question)?.state).toBe('confirmed');
});
it('keeps causal retirement facts across restart and edited/reopened/queued precedence', () => {
  const owner = new AsyncQuestionOwner(); owner.observe([question, { ...row('origin-end', 30, 'origin'), asyncQuestionRunOutcome: 'successful' }]);
  const restored = new AsyncQuestionOwner(); restored.restore(owner.serialize()); restored.observe([question]);
  restored.observe([row('start', 40, 'later', 'user'), { ...row('end', 60, 'later'), asyncQuestionRunOutcome: 'successful' }]);
  expect(restored.view(question)?.state).toBe('history');
  restored.reopen(restored.view(question)!.record.id); restored.observe([row('end', 60, 'later')]); expect(restored.view(question)?.state).toBe('pending');
});

it('does not carry confirmation or retirement into a reset generation reusing the item identity', () => {
  const owner = new AsyncQuestionOwner(); owner.observe([question]); owner.observe([{ ...row('answer', 40, 'answer', 'user'), text: 'A', asyncQuestionReplyToId: question.id }]); expect(owner.view(question)?.state).toBe('confirmed');
  const reset = { ...question, transcriptSessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }; owner.observe([reset]); expect(owner.view(reset)?.state).toBe('pending'); expect(owner.view(question)).toBeUndefined();
});

it('requires a witnessed successor start even when the question appears in the terminal page', () => {
  const owner = new AsyncQuestionOwner(); owner.observe([question, { ...row('origin-end', 30, 'origin'), asyncQuestionRunOutcome: 'successful' }, { ...row('terminal-only', 60, 'later'), asyncQuestionRunOutcome: 'successful' }]);
  expect(owner.view(question)?.state).toBe('pending');
});
it('classifies edited reply-only submissions from retained outbox context without guessing prose', () => {
  const owner = new AsyncQuestionOwner(); owner.observe([question]); owner.admit(question, 'outbox');
  const payload = { sessionKey: question.sessionKey, sessionId: question.transcriptSessionId, messages: [{ id: 'edited', role: 'user', idempotencyKey: 'outbox:user', content: 'Edited private /Users/person/file' }] };
  expect(messagesFromPayload(payload, '', owner.projectionContext())[0]?.text).toBe('Edited private [local file]');
  const restored = new AsyncQuestionOwner(); restored.restore(owner.serialize()); expect(messagesFromPayload(payload, '', restored.projectionContext())[0]?.text).toBe('Edited private [local file]');
});
it('does not classify ambiguous heading-only matches or a foreign question in a mixed payload', () => {
  const duplicate = { ...question, id: 'other', asyncQuestion: { ...question.asyncQuestion!, itemId: 'other' } };
  const payload = { sessionKey: question.sessionKey, sessionId: question.transcriptSessionId, messages: [{ id: 'quote', role: 'user', content: '> Which?\n\nQuote' }] };
  expect(messagesFromPayload(payload, '', [question, duplicate])[0]?.asyncQuestionAnswerText).toBeUndefined();
  expect(messagesFromPayload({ ...payload, messages: [{ id: 'foreign-q', role: 'assistant', sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', openclawAsyncDelivery: question.asyncQuestion, content: 'Which?' }, ...payload.messages] })[1]?.asyncQuestionAnswerText).toBeUndefined();
});

it.each([false, true])('keeps retained heading ambiguity independent of repeated page questions after restore=%s', restore => {
  const duplicate: WorkspaceMessage = { ...question, id: 'other-question', asyncQuestion: { ...question.asyncQuestion!, itemId: 'other-item' } };
  let owner = new AsyncQuestionOwner(); owner.observe([question, duplicate]);
  if (restore) { const next = new AsyncQuestionOwner(); next.restore(owner.serialize()); owner = next; }
  const reply = { ...row('ambiguous-reply', 50, 'reply', 'user'), text: '> Which?\n\nA' };
  owner.observe([reply]);
  expect([owner.view(question)?.state, owner.view(duplicate)?.state]).toEqual(['pending', 'pending']);
  owner.observe([question, reply]);
  expect([owner.view(question)?.state, owner.view(duplicate)?.state]).toEqual(['pending', 'pending']);
  owner.observe([duplicate, reply]);
  expect([owner.view(question)?.state, owner.view(duplicate)?.state]).toEqual(['pending', 'pending']);
  owner.observe([{ ...reply, asyncQuestionReplyToId: duplicate.id }]);
  expect([owner.view(question)?.state, owner.view(duplicate)?.state]).toEqual(['pending', 'confirmed']);
});
