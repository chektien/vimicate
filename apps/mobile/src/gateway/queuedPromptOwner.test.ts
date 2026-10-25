import { expect, it } from 'vitest';
import { QueuedPromptOwner, type QueuedPromptPreparation } from './queuedPromptOwner';
import { messagesFromPayload } from '../workspace/historyMessageProjection';
import { mergeLatestHistory } from './historyPagination';
import { completePendingInputSnapshot, pendingInputCustodyCandidates } from './pendingInputSnapshot';
import { parsedTranscriptCache, serializedTranscriptCache } from './persistentTranscriptCache';
const preparation = (id = 'followup'): QueuedPromptPreparation => ({ runId: id, originalSubmissionId: `original-${id}`, sessionKey: 'route', sessionId: 'generation', predecessorRunId: 'predecessor', createdAt: 100, text: 'Please continue' });
const row = { id: 'local', role: 'user' as const, sessionKey: 'route', text: 'Please continue', idempotencyKey: 'followup' };
it('separates action failure from custody and retires it at terminal state or reopening', () => {
  const owner = new QueuedPromptOwner(); owner.prepare(preparation());
  owner.recordActionFailure('followup', 'Cancel was refused');
  owner.update('followup', 'queued'); owner.update('followup', 'unknown'); owner.update('followup', 'queued');
  expect(owner.get('followup')?.actionFailure).toBe('Cancel was refused');
  const restored = new QueuedPromptOwner(); restored.restore(owner.serialize(), 200);
  expect(restored.get('followup')?.actionFailure).toBeUndefined();
  owner.update('followup', 'cancelled'); owner.recordActionFailure('followup', 'late failure');
  expect(owner.get('followup')?.actionFailure).toBeUndefined();
});
it.each(['cancelled', 'interrupted'] as const)('retains the matching local row and %s status after pending custody disappears and the app reopens', state => {
  const sessionId = '00000000-0000-4000-8000-000000000117';
  const owner = new QueuedPromptOwner(); owner.prepare({ ...preparation(), sessionId });
  const payload = { sessionKey: 'route', sessionId, messages: [], pendingInputs: { total: 1, items: [{
    id: 'pending', runId: 'followup', state: 'queued', acceptedAt: 100,
    message: { role: 'user', content: 'Please continue' },
  }] } };
  const current = mergeLatestHistory(messagesFromPayload(payload), [{ ...row, source: 'local', runId: 'followup', timestamp: '90' }], 'route');
  expect(current.filter(message => message.role === 'user')).toHaveLength(1);
  owner.update('followup', state);
  const empty = { ...payload, pendingInputs: { total: 0, items: [] } };
  const retained = mergeLatestHistory([], current, 'route', {
    snapshot: completePendingInputSnapshot(empty, [], 'route')!, candidates: pendingInputCustodyCandidates(current, 'route'),
  });
  const restored = new QueuedPromptOwner(); restored.restore(owner.serialize(), 200);
  const visible = parsedTranscriptCache(serializedTranscriptCache(retained));
  expect(visible.filter(message => message.role === 'user')).toHaveLength(1);
  expect(restored.view(visible.find(message => message.role === 'user')!)?.state).toBe(state);
});
it('restores lost acknowledgments as unconfirmed and never creates a resend operation', () => {
  const owner = new QueuedPromptOwner(); owner.prepare(preparation());
  const restored = new QueuedPromptOwner(); restored.restore(owner.serialize(), 200);
  expect(restored.view(row)?.state).toBe('unknown');
  expect(() => restored.prepare(preparation())).toThrow('already');
  expect(restored.pending('route', 'generation')).toHaveLength(1);
  expect(restored.pending('route', 'next-generation')).toEqual([]);
});
it('matches only explicit user receipt identity, route and available concrete generation', () => {
  const owner = new QueuedPromptOwner(); owner.prepare(preparation());
  expect(owner.view({ ...row, idempotencyKey: 'other' })).toBeUndefined();
  expect(owner.view({ ...row, idempotencyKey: undefined, inputReceiptRunId: 'followup' } as never)?.runId).toBe('followup');
  expect(owner.view({ ...row, role: 'assistant' })).toBeUndefined();
  expect(owner.view({ ...row, sessionKey: 'another' })).toBeUndefined();
  expect(owner.view({ ...row, transcriptSessionId: 'another' })).toBeUndefined();
});
it('maps the committed user submission suffix only in the exact concrete generation', () => {
  const owner = new QueuedPromptOwner(); owner.prepare(preparation()); owner.update('followup', 'consumed', undefined, 'canonical');
  const canonical = { ...row, source: 'history' as const, transcriptSessionId: 'generation', idempotencyKey: 'followup:user' };
  expect(owner.view(canonical)).toMatchObject({ state: 'consumed', consumedByEventId: 'canonical' });
  for (const change of [{ transcriptSessionId: undefined }, { transcriptSessionId: 'other' },
    { idempotencyKey: 'followup:assistant' }, { idempotencyKey: 'followup:user:user' }, { role: 'assistant' as const }]) {
    expect(owner.view({ ...canonical, ...change } as never)).toBeUndefined();
  }
});
it('separates acceptance, custody and consumption, ignoring late queued/ack/failure races', () => {
  const owner = new QueuedPromptOwner(); owner.prepare(preparation()); owner.update('followup', 'accepted');
  expect(owner.view(row)?.state).toBe('accepted');
  owner.update('followup', 'queued'); owner.update('followup', 'accepted');
  expect(owner.view(row)?.state).toBe('queued');
  owner.update('followup', 'unknown'); expect(owner.view(row)?.state).toBe('unknown');
  owner.update('followup', 'consumed', undefined, 'event');
  owner.update('followup', 'queued'); owner.update('followup', 'cancelled');
  expect(owner.view(row)).toMatchObject({ state: 'consumed', consumedByEventId: 'event' });
});
it('keeps interrupted and cancelled terminal and evicts only aged terminal records', () => {
  const owner = new QueuedPromptOwner(); owner.prepare(preparation()); owner.prepare(preparation('other'));
  owner.update('followup', 'interrupted'); owner.update('followup', 'queued');
  const restored = new QueuedPromptOwner(); restored.restore(owner.serialize(), 8 * 24 * 60 * 60 * 1000);
  expect(restored.get('followup')).toBeUndefined(); expect(restored.get('other')?.state).toBe('unknown');
});
it('rejects duplicate original identities and caps unresolved records without deleting unknown custody', () => {
  const owner = new QueuedPromptOwner(); owner.prepare(preparation());
  expect(() => owner.prepare({ ...preparation('another'), originalSubmissionId: preparation().originalSubmissionId })).toThrow('already');
  for (let i = 1; i < 64; i++) owner.prepare({ ...preparation(`id-${i}`), sessionKey: `route-${Math.floor(i / 16)}` });
  expect(() => owner.prepare({ ...preparation('overflow'), sessionKey: 'fifth' })).toThrow('Too many');
  const restored = new QueuedPromptOwner(); restored.restore(owner.serialize());
  expect(restored.get('followup')).toBeDefined(); expect(restored.serialize()).toEqual(owner.serialize().replaceAll('preparing', 'unknown'));
});
it('bounds stored text and strips arbitrary or malformed restored application state', () => {
  const owner = new QueuedPromptOwner(); owner.prepare({ ...preparation(), text: 'x'.repeat(5000) });
  const payload = JSON.parse(owner.serialize()); payload[0].attachments = [{ dataBase64: 'secret' }];
  const restored = new QueuedPromptOwner(); restored.restore(JSON.stringify(payload));
  expect(restored.get('followup')?.text).toHaveLength(4096); expect(restored.serialize()).not.toContain('attachments');
  const invalid = new QueuedPromptOwner(); invalid.restore(JSON.stringify([{ ...payload[0], sessionId: '' }])); expect(invalid.serialize()).toBe('[]');
  invalid.restore(JSON.stringify([...payload, ...payload])); expect(invalid.serialize()).toBe('[]');
});
it('applies the serialized byte bound before admission even for heavily escaped prompt text', () => {
  const owner = new QueuedPromptOwner(); let admitted = 0;
  for (let index = 0; index < 64; index++) {
    try { owner.prepare({ ...preparation(`escaped-${index}`), sessionKey: `route-${Math.floor(index / 16)}`, text: '\u0000'.repeat(4096) }); admitted++; }
    catch { break; }
  }
  expect(admitted).toBeGreaterThan(0); expect(admitted).toBeLessThan(64); expect(owner.serialize().length).toBeLessThanOrEqual(512_000);
  const restored = new QueuedPromptOwner(); restored.restore(owner.serialize()); expect(JSON.parse(restored.serialize())).toHaveLength(admitted);
});

it('discards transient action details on restore but retains terminal cancellation evidence', () => {
  const owner = new QueuedPromptOwner(); owner.prepare(preparation());
  owner.update('followup', 'queued', 'Stopping the current task. Your message remains queued.');
  owner.prepare(preparation('cancelled')); owner.update('cancelled', 'cancelled', 'Cancelled by request.');
  const restored = new QueuedPromptOwner(); restored.restore(owner.serialize(), 200);
  expect(restored.get('followup')).toMatchObject({ state: 'unknown' });
  expect(restored.get('followup')?.detail).toBeUndefined();
  expect(restored.get('cancelled')?.detail).toBe('Cancelled by request.');
});
