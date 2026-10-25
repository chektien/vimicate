// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import type { useGatewaySubmission } from './useGatewaySubmission';
import { HistoryPublicationAuthority } from './historyPublicationAuthority';
import { AsyncQuestionOwner } from '../questions/asyncQuestionOwner';
vi.mock('expo-crypto', () => { let sequence = 0; return { randomUUID: () => `async-answer-${++sequence}` }; });
vi.mock('../storage/workspaceStore', () => ({ loadValue: vi.fn(async () => null), saveValue: vi.fn(async () => {}) }));
import { loadValue, saveValue } from '../storage/workspaceStore';
import { useAsyncGatewayQuestions } from './useAsyncGatewayQuestions';
const message: WorkspaceMessage = { id: 'question', role: 'assistant', source: 'history', sessionKey: 'original', runId: 'run', text: 'Which?', asyncQuestion: { itemId: 'item', questions: [{ title: 'Which?', options: ['One', 'Two'] }, { title: 'Notes?' }] } };
const key = (key: string) => ({ key, shift: false, command: false, control: false, option: false });
function harness(sender: ReturnType<typeof vi.fn>, endpoint = 'ws://fixture:18789') {
  const root = createRoot(document.createElement('div')); let value!: ReturnType<typeof useAsyncGatewayQuestions>; let messages = [message]; let status: 'connected' | 'disconnected' = 'connected'; let address = endpoint;
  const authority = { current: new HistoryPublicationAuthority(true) }; const submit = { current: sender as unknown as ReturnType<typeof useGatewaySubmission> };
  function Component() { value = useAsyncGatewayQuestions({ messages, endpoint: address, status, authority, submit }); return null; }
  const render = () => act(async () => root.render(<Component />));
  return { root, render, authority, value: () => value, history: (rows: WorkspaceMessage[]) => { messages = rows; }, status: (next: typeof status) => { status = next; }, endpoint: (next: string) => { address = next; } };
}
it('hands reading keys back until Enter and exits on Escape without changing answers', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const sender = vi.fn(); const test = harness(sender); await test.render();
  const record = test.value().view(message)!.record; const before = test.value().ui.draft(record);
  await act(async () => { expect(test.value().handleKey(message, key('j'))).toBe(false); });
  expect(test.value().ui.draft(record)).toEqual(before);
  await act(async () => { expect(test.value().handleKey(message, key('enter'))).toBe(true); });
  expect(sender).not.toHaveBeenCalled();
  await act(async () => test.value().ui.leave('another-question'));
  expect(test.value().ui.interaction).toBe(record.id);
  await act(async () => { expect(test.value().handleKey(message, key('j'))).toBe(true); });
  expect(test.value().ui.draft(record)).toMatchObject({ cursor: 1, selected: before.selected });
  await act(async () => { expect(test.value().handleKey(message, key('escape'))).toBe(true); });
  expect(test.value().view(message)?.collapsed).toBe(false);
  await act(async () => { expect(test.value().handleKey(message, key('k'))).toBe(false); });
  expect(sender).not.toHaveBeenCalled(); await act(async () => test.root.unmount());
});
it('uses the original session, preserves one durable outbox key and distinguishes ack from saved confirmation', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); let finish!: (result: boolean) => void;
  const sender = vi.fn((_text, _attachments, _session, _previews, delivery) => { delivery.onState('sending'); return new Promise<boolean>(resolve => { finish = result => { delivery.onState('accepted'); resolve(result); }; }); });
  const test = harness(sender); await test.render(); const view = test.value().view(message)!;
  await act(async () => { test.value().ui.choose(view.record, 0, 1); test.value().ui.text(view.record, 1, 'note'); });
  expect(sender).not.toHaveBeenCalled(); expect(test.value().ui.textEditing).toBeNull();
  await act(async () => { test.value().ui.activate(view.record, 2); test.value().handleKey(message, key('enter')); });
  const args = sender.mock.calls[0]!; expect(args[0]).toBe('> Which?\n\nTwo\n\n> Notes?\n\nnote'); expect(args[2]).toBe('original'); expect(args[4].replyToId).toBe('question');
  expect(test.value().view(message)?.state).toBe('sending'); expect(saveValue).toHaveBeenCalled();
  await act(async () => { test.value().handleKey(message, key('enter')); }); expect(sender).toHaveBeenCalledOnce();
  await act(async () => { finish(true); }); expect(test.value().view(message)?.state).toBe('unconfirmed');
  await act(async () => { test.value().action(view.record.id, 'retry'); }); expect(sender.mock.calls[1]?.[4].idempotencyKey).toBe(args[4].idempotencyKey);
  await act(async () => { finish(true); });
  test.history([message, { id: 'saved', role: 'user', text: args[0], source: 'history', sessionKey: 'original', idempotencyKey: args[4].idempotencyKey }]); await test.render();
  expect(test.value().view(message)?.state).toBe('confirmed'); await act(async () => test.root.unmount());
});
it('restores drafts before submission, collapses without sending, and suppresses completion after endpoint retirement', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const owner = new AsyncQuestionOwner(); owner.observe([message]); const record = owner.view(message)!.record; owner.text(record, 1, 'saved draft');
  vi.mocked(loadValue).mockResolvedValueOnce(owner.serialize()); let finish!: (result: boolean) => void;
  const sender = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; })); const test = harness(sender); await test.render();
  expect(test.value().ui.draft(record).text['1']).toBe('saved draft');
  await act(async () => { test.value().action(record.id, 'collapse'); }); expect(test.value().view(message)?.collapsed).toBe(true); expect(sender).not.toHaveBeenCalled();
  await act(async () => { test.value().action(record.id, 'expand'); test.value().handleKey(message, key('enter')); test.value().handleKey(message, key('tab')); test.value().handleKey(message, key('tab')); test.value().handleKey(message, key('enter')); });
  expect(sender).toHaveBeenCalledOnce(); test.endpoint('ws://another:18789'); await test.render(); await act(async () => { finish(false); });
  expect(test.value().view(message)?.state).toBe('pending'); expect(test.value().ui.draft(record).text).toEqual({}); await act(async () => test.root.unmount());
});
it('queues offline, resumes exactly once after reconnect, and refuses a retired hydration', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.mocked(loadValue).mockResolvedValue(null);
  const sender = vi.fn(async (_text, _attachments, _session, _previews, delivery) => { delivery.onState('sending'); delivery.onState('accepted'); return true; });
  const test = harness(sender); test.status('disconnected'); await test.render(); const record = test.value().view(message)!.record;
  await act(async () => { test.value().ui.text(record, 1, 'offline note'); test.value().ui.resolve(record); });
  expect(sender).not.toHaveBeenCalled(); expect(test.value().view(message)?.state).toBe('queued'); test.status('connected'); await test.render();
  expect(sender).toHaveBeenCalledOnce(); expect(test.value().view(message)?.state).toBe('unconfirmed'); await act(async () => test.root.unmount());
});

it.each([false, true])('retires a discarded answer during durable admission without blocking its replacement (%s)', async replace => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const sender = vi.fn(async (_text, _attachments, _session, _previews, delivery) => {
    delivery.onState('sending'); delivery.onState('accepted'); return true;
  });
  const test = harness(sender); await test.render(); const record = test.value().view(message)!.record;
  let releaseStorage!: () => void;
  vi.mocked(saveValue).mockImplementationOnce(() => new Promise<void>(resolve => { releaseStorage = resolve; }));
  try {
    await act(async () => { test.value().ui.text(record, 1, 'discarded note'); test.value().ui.resolve(record); });
    expect(test.value().view(message)?.state).toBe('queued'); expect(sender).not.toHaveBeenCalled();
    const discardedID = test.value().view(message)!.delivery!.id;
    await act(async () => { test.value().action(record.id, 'discard'); });
    expect(test.value().view(message)?.state).toBe('pending');
    if (replace) {
      await act(async () => { test.value().ui.text(record, 1, 'replacement note'); test.value().ui.resolve(record); });
    }
    await act(async () => { releaseStorage(); });
    if (replace) {
      expect(sender).toHaveBeenCalledOnce();
      expect(sender.mock.calls[0]![0]).toContain('replacement note');
      expect(sender.mock.calls[0]![4].idempotencyKey).not.toBe(discardedID);
      expect(test.value().view(message)?.state).toBe('unconfirmed');
    } else {
      expect(sender).not.toHaveBeenCalled(); expect(test.value().view(message)?.state).toBe('pending');
    }
  } finally { releaseStorage(); await act(async () => test.root.unmount()); }
});

it('does not send an answer confirmed by canonical history during durable admission', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const sender = vi.fn(); const test = harness(sender); await test.render();
  const record = test.value().view(message)!.record; let releaseStorage!: () => void;
  vi.mocked(saveValue).mockImplementationOnce(() => new Promise<void>(resolve => { releaseStorage = resolve; }));
  try {
    await act(async () => { test.value().ui.text(record, 1, 'saved elsewhere'); test.value().ui.resolve(record); });
    const delivery = test.value().view(message)!.delivery!;
    test.history([message, { id: 'saved', role: 'user', text: delivery.text, source: 'history', sessionKey: 'original', idempotencyKey: delivery.id }]);
    await test.render(); expect(test.value().view(message)?.state).toBe('confirmed');
    await act(async () => releaseStorage());
    expect(sender).not.toHaveBeenCalled(); expect(test.value().view(message)?.state).toBe('confirmed');
  } finally { releaseStorage(); await act(async () => test.root.unmount()); }
});
