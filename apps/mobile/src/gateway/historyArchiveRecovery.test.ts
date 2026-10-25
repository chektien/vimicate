import { describe, expect, it } from 'vitest';
import { archivedFamilyAuthorityInvalidated } from './archivedHistory';
import { HistoryArchiveRecovery } from './historyArchiveRecovery';

describe('obsolete archived-family recovery', () => {
  it.each([
    'vimicate history family failed: vimicate archived-family: current session generation changed or is not ledger-complete',
    'vimicate history family failed: vimicate archived-family: family token is stale',
    'vimicate archived-family: current session generation changed during census',
    'vimicate archived-family: current session generation changed or is unavailable',
    'vimicate history family failed: vimicate archived-family: stable session family is not audited in the ledger',
  ])('recognizes host authority rejection without classifying ordinary transport failures: %s', (message) => {
    expect(archivedFamilyAuthorityInvalidated(new Error(message))).toBe(true);
  });

  it('does not swallow a retryable network or canonical page-integrity failure', () => {
    expect(archivedFamilyAuthorityInvalidated(new Error('WebSocket closed'))).toBe(false);
    expect(archivedFamilyAuthorityInvalidated(new Error('Archived history returned a non-monotonic raw page cursor.'))).toBe(false);
  });

  it('keeps recovery owned by the exact session until canonical latest history consumes it', () => {
    const recovery = new HistoryArchiveRecovery();

    recovery.request('example-research');
    expect(recovery.pendingFor('example-research')).toBe(true);
    expect(recovery.consume('other')).toBe(false);
    expect(recovery.pendingFor('example-research')).toBe(true);
    expect(recovery.consume('example-research')).toBe(true);
    expect(recovery.pendingFor('example-research')).toBe(false);
  });

  it('retires a pending successor-tail recovery across project selection changes', () => {
    const recovery = new HistoryArchiveRecovery();
    recovery.request('example-research');
    recovery.retire();

    expect(recovery.consume('example-research')).toBe(false);
  });
});
