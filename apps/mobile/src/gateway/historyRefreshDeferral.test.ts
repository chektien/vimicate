import { describe, expect, it } from 'vitest';
import { HistoryRefreshDeferral } from './historyRefreshDeferral';

describe('canonical history refresh deferral', () => {
  it('coalesces repeated terminal refreshes for the selected session', () => {
    const deferred = new HistoryRefreshDeferral();
    deferred.request('A');
    deferred.request('A');
    expect(deferred.consume('A')).toBe('A');
    expect(deferred.consume('A')).toBe('');
  });

  it('does not carry an old-session refresh across a selection change', () => {
    const deferred = new HistoryRefreshDeferral();
    deferred.request('A');
    expect(deferred.consume('B')).toBe('');
    expect(deferred.consume('A')).toBe('');
  });

  it('retires deferred work when archive authority changes', () => {
    const deferred = new HistoryRefreshDeferral();
    deferred.request('A');
    deferred.retire();
    expect(deferred.consume('A')).toBe('');
  });
});
