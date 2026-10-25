import { expect, it, vi } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { DeferredPromptRefusals, RefusalFilteredHistoryCache } from './deferredPromptRefusals';

const local = (id = 'local-send-one', sessionKey = 'notes'): WorkspaceMessage => ({
  id, sessionKey, source: 'local', role: 'user', text: 'unsent task', timestamp: '100', idempotencyKey: 'send-one',
});

it('records a suspended rejection without mutating cached rows or notifying subscribers', async () => {
  const refusals = new DeferredPromptRefusals();
  const cache = new RefusalFilteredHistoryCache(refusals);
  const initial = [local()]; cache.store('notes', initial);
  const listener = vi.fn(); cache.subscribe(listener);
  refusals.reject('notes', 'local-send-one');
  await Promise.resolve();
  expect(cache.restore('notes')).toEqual(initial);
  expect(listener).not.toHaveBeenCalled();
  // The foreground history owner explicitly flushes existing caches on resume.
  cache.store('notes', cache.restore('notes')!);
  await Promise.resolve();
  expect(cache.restore('notes')).toEqual([]);
  expect(listener).toHaveBeenCalledOnce();
});

it('keeps refusal identity after pruning so stale asynchronous snapshots cannot resurrect the row', () => {
  const refusals = new DeferredPromptRefusals(); const cache = new RefusalFilteredHistoryCache(refusals);
  const stale = [local()]; cache.store('notes', stale);
  refusals.reject('notes', 'local-send-one');
  cache.store('notes', cache.restore('notes')!);
  cache.store('notes', [...stale, local('local-later')]);
  expect(cache.restore('notes')?.map(row => row.id)).toEqual(['local-later']);
  expect(refusals.filterVisible(stale)).toEqual([]);
});

it('removes only the exact local optimistic user row in its source session', () => {
  const refusals = new DeferredPromptRefusals(); refusals.reject('notes', 'local-send-one');
  const keep: WorkspaceMessage[] = [
    local('local-send-two'), local('local-send-one', 'other'),
    { ...local(), source: 'history' }, { ...local(), source: 'live' }, { ...local(), role: 'assistant' },
    { ...local(), transcriptSessionId: 'another-generation' },
    { ...local(), displayPosition: { source: 'sqlite', rawSeq: 8 } }, { ...local(), narrationItemId: 'canonical-row' },
  ];
  expect(refusals.filter('notes', [local(), ...keep])).toEqual(keep);
  expect(refusals.filterVisible([local(), ...keep])).toEqual(keep);
});

it('cleans an unsent followup identity without guessing from its prompt text or other receipt fields', () => {
  const refusals = new DeferredPromptRefusals(); refusals.reject('notes', 'local-send-one');
  expect(refusals.filter('notes', [{ ...local(), idempotencyKey: 'send-one:followup', inputReceiptRunId: 'send-one:followup' }])).toEqual([]);
  const other = [{ ...local('local-other'), text: 'unsent task', idempotencyKey: 'send-one:followup' }];
  expect(refusals.filter('notes', other)).toBe(other);
});

it('returns stable unchanged snapshots and bounds retained exact identities', () => {
  const refusals = new DeferredPromptRefusals(2);
  refusals.reject('first', 'local-first'); refusals.reject('second', 'local-second'); refusals.reject('third', 'local-third');
  expect(refusals.sessionKeys()).toEqual(['second', 'third']);
  const rows = [local()]; expect(refusals.filter('notes', rows)).toBe(rows); expect(refusals.filterVisible(rows)).toBe(rows);
  expect(refusals.reject('', 'local-send')).toBe(false); expect(refusals.reject('notes', 'canonical-row')).toBe(false);
});
