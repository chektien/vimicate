import { expect, it } from 'vitest';
import { AsyncQuestionOwner } from './asyncQuestionOwner';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
const message: WorkspaceMessage = { id: 'source', role: 'assistant' as const, sessionKey: 'a', text: 'Which?', source: 'history', runId: 'origin', asyncQuestion: { itemId: 'item', questions: [{ title: 'Which?', options: ['One', 'Two'] }] } };
it('retains one outbox identity on duplicate submit and retry, and confirms only canonical saved replies', () => {
  const owner = new AsyncQuestionOwner(); owner.observe([message]); const record = owner.view(message)!.record;
  owner.choose(record, 0, 1);
  const first = owner.admit(message, 'uuid-1')!;
  expect(first.text).toBe('> Which?\n\nTwo'); expect(owner.admit(message, 'uuid-2')).toBeNull();
  owner.delivery(record.id, 'failed'); expect(owner.retry(record.id)).toMatchObject({ id: 'uuid-1', text: first.text });
  owner.delivery(record.id, 'accepted'); expect(owner.view(message)?.state).toBe('unconfirmed');
  owner.observe([message, { id: 'saved', role: 'user' as const, text: first.text, source: 'history', sessionKey: 'a', idempotencyKey: 'uuid-1' }]);
  expect(owner.view(message)?.state).toBe('confirmed'); expect(owner.retry(record.id)).toBeNull();
});
it('keeps drafts across virtualization, history retirement, reopening, reload, discard and other sessions', () => {
  const owner = new AsyncQuestionOwner(); owner.observe([message]); const record = owner.view(message)!.record;
  owner.text(record, 0, 'a note'); owner.collapse(record.id); owner.observe([]);
  expect(owner.view(message)?.collapsed).toBe(true);
  const later: WorkspaceMessage[] = [message, { id: 'end', role: 'assistant' as const, text: 'done', runId: 'origin', asyncQuestionRunOutcome: 'successful' as const }, { id: 'u', role: 'user' as const, text: 'continue', runId: 'later' }, { id: 'end2', role: 'assistant' as const, text: 'done', runId: 'later', asyncQuestionRunOutcome: 'successful' as const }];
  owner.observe(later.map(row => ({ sessionKey: 'a', ...row }))); expect(owner.view(message)?.state).toBe('pending'); owner.skip(record.id); owner.reopen(record.id); expect(owner.view(message)?.state).toBe('pending');
  const saved = owner.serialize(); const restored = new AsyncQuestionOwner(); restored.restore(saved); restored.observe(later.map(row => ({ sessionKey: 'a', ...row })));
  expect(restored.draft(record).text['0']).toBe('a note'); expect(restored.view(message)?.state).toBe('pending');
  const other = { ...message, sessionKey: 'b' }; restored.observe([other]); expect(restored.draft(restored.view(other)!.record).text).toEqual({});
  restored.admit(message, 'uuid'); restored.delivery(record.id, 'failed'); restored.discard(record.id); expect(restored.draft(record).text['0']).toBe('a note'); expect(restored.view(message)?.state).toBe('pending');
});
it('refuses secrets, skips without a send, preserves selections, and has a bounded disposal owner', () => {
  const owner = new AsyncQuestionOwner(); owner.observe([message]); const record = owner.view(message)!.record; owner.choose(record, 0, 1); owner.skip(record.id);
  expect(owner.view(message)?.state).toBe('skipped'); expect(owner.admit(message, 'uuid')).toBeNull(); owner.reopen(record.id); expect(owner.draft(record).selected['0']).toEqual(['Two']);
  const secret = { ...message, asyncQuestion: { itemId: 'secret', questions: [{ title: 'Private input', isSecret: true }] } }; owner.observe([secret]); expect(owner.admit(secret, 'secret-uuid')).toBeNull();
  for (let i = 0; i < 140; i++) owner.observe([{ ...message, asyncQuestion: { ...message.asyncQuestion!, itemId: `item-${i}` } }]);
  expect(JSON.parse(owner.serialize()).length).toBeLessThanOrEqual(128); owner.clear(); expect(owner.view(message)).toBeUndefined();
});

it('retires untouched reminders, preserves a reopened draft until a subsequent successful boundary', () => {
  const owner = new AsyncQuestionOwner(); const later: WorkspaceMessage[] = [message, { id: 'end', role: 'assistant' as const, text: 'done', runId: 'origin', asyncQuestionRunOutcome: 'successful' as const }, { id: 'u', role: 'user' as const, text: 'continue', runId: 'later' }, { id: 'end2', role: 'assistant' as const, text: 'done', runId: 'later', asyncQuestionRunOutcome: 'successful' as const }];
  owner.observe(later.map(row => ({ sessionKey: 'a', ...row }))); const record = owner.view(message)!.record; expect(owner.view(message)?.state).toBe('history'); owner.reopen(record.id); expect(owner.view(message)?.state).toBe('pending');
  owner.observe([...later, { id: 'u2', role: 'user' as const, text: 'continue', runId: 'last' }, { id: 'end3', role: 'assistant' as const, text: 'done', runId: 'last', asyncQuestionRunOutcome: 'successful' as const }].map(row => ({ sessionKey: 'a', ...row }))); expect(owner.view(message)?.state).toBe('history');
});

it('restores the twelve-question action row and its exact outbox identity', () => {
  const tall = { ...message, asyncQuestion: { itemId: 'tall', questions: Array.from({ length: 12 }, (_, i) => ({ title: `Question ${i}`, options: ['A', 'B', 'C', 'D'] })) } };
  const owner = new AsyncQuestionOwner(); owner.observe([tall]); const record = owner.view(tall)!.record;
  owner.text(record, 11, 'Custom answer');
  owner.update(record, { ...owner.draft(record), active: 11, cursor: 4 });
  const other = new AsyncQuestionOwner(); other.restore(owner.serialize()); other.observe([tall]);
  expect(other.draft(record)).toMatchObject({ active: 11, cursor: 4, text: { 11: 'Custom answer' } });
  owner.update(record, { ...owner.draft(record), active: 12, cursor: 0 });
  owner.admit(tall, 'retained-id'); owner.delivery(record.id, 'failed');
  const restored = new AsyncQuestionOwner(); restored.restore(owner.serialize()); restored.observe([tall]);
  expect(restored.draft(record)).toMatchObject({ active: 12, cursor: 0, text: { 11: 'Custom answer' } });
  expect(restored.view(tall)?.delivery).toMatchObject({ id: 'retained-id', state: 'failed' });
  expect(restored.retry(record.id)?.id).toBe('retained-id');
});

it('persists an empty selected Other without restoring the old default answer', async () => {
  const { chooseQuestionOther, questionOtherSelected } = await import('./questionDraft');
  const owner = new AsyncQuestionOwner(); owner.observe([message]); const record = owner.view(message)!.record;
  owner.update(record, chooseQuestionOther(record, owner.draft(record), 0));
  const restored = new AsyncQuestionOwner(); restored.restore(owner.serialize()); restored.observe([message]);
  expect(questionOtherSelected(restored.draft(record), '0')).toBe(true);
  expect(restored.draft(record).selected['0']).toEqual([]);
  expect(restored.admit(message, 'must-not-send-default')).toBeNull();
  restored.text(record, 0, 'Custom');
  expect(restored.admit(message, 'custom')?.text).toBe('> Which?\n\nCustom');
});
it('rejects malformed persisted Other selection flags', () => {
  const owner = new AsyncQuestionOwner(); owner.observe([message]);
  for (const other of [{ 0: 'true' }, { 12: true }, [], 'selected']) {
    const raw = JSON.parse(owner.serialize()); raw[0].draft.other = other;
    const restored = new AsyncQuestionOwner(); restored.restore(JSON.stringify(raw));
    expect(restored.serialize()).toBe('[]');
  }
});
