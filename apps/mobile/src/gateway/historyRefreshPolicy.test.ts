import { describe, expect, it } from 'vitest';
import { shouldHydrateSelectedHistory, shouldRefreshCanonicalHistory } from './historyRefreshPolicy';

describe('canonical history refresh authority', () => {
  it('gives live subscribed rows exclusive ownership during an active run', () => {
    expect(shouldRefreshCanonicalHistory(true, false)).toBe(false);
    expect(shouldRefreshCanonicalHistory(true, true)).toBe(true);
    expect(shouldRefreshCanonicalHistory(false, false)).toBe(true);
  });
});

describe('selected history hydration after the authoritative session census', () => {
  const realHistory = [{ id: 'history-1', role: 'assistant' as const, text: 'Restored', source: 'history' as const }];
  const startup = [{ id: 'startup-1', role: 'system' as const, text: 'MVP terminal chat ready.' }];

  it('does not let a retained run owner strand an empty or startup-only transcript', () => {
    expect(shouldHydrateSelectedHistory(false, true, [])).toBe(true);
    expect(shouldHydrateSelectedHistory(false, true, startup)).toBe(true);
  });

  it('retains the existing generation/run refresh policy once real history is mounted', () => {
    expect(shouldHydrateSelectedHistory(true, true, realHistory)).toBe(true);
    expect(shouldHydrateSelectedHistory(false, false, realHistory)).toBe(true);
    expect(shouldHydrateSelectedHistory(false, true, realHistory)).toBe(false);
  });

  it('fills the restart event gap once after a fresh Gateway connection', () => {
    expect(shouldHydrateSelectedHistory(false, true, realHistory, true)).toBe(true);
    expect(shouldHydrateSelectedHistory(false, true, realHistory, false)).toBe(false);
  });
});
