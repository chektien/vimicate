import { describe, expect, it } from 'vitest';
import { OlderHistoryRequestAuthority } from './historyRequestAuthority';

describe('older-history request authority', () => {
  it('does not let stale A completion retire a replacement B request', () => {
    const owner = new OlderHistoryRequestAuthority();
    const a = owner.begin('A', 1)!;

    owner.retire();
    const b = owner.begin('B', 2)!;

    expect(owner.owns(a, 'B', 2)).toBe(false);
    expect(owner.finish(a)).toBe(false);
    expect(owner.isActive()).toBe(true);
    expect(owner.owns(b, 'B', 2)).toBe(true);
    expect(owner.finish(b)).toBe(true);
    expect(owner.isActive()).toBe(false);
  });

  it('rejects an A page after A to B to A selection or revision changes', () => {
    const owner = new OlderHistoryRequestAuthority();
    const staleA = owner.begin('A', 7)!;

    expect(owner.owns(staleA, 'B', 7)).toBe(false);
    expect(owner.owns(staleA, 'A', 8)).toBe(false);

    owner.retire();
    const currentA = owner.begin('A', 9)!;
    expect(owner.owns(staleA, 'A', 9)).toBe(false);
    expect(owner.owns(currentA, 'A', 9)).toBe(true);
  });

  it('permits only one page request until its exact ticket finishes', () => {
    const owner = new OlderHistoryRequestAuthority();
    const request = owner.begin('A', 1)!;
    expect(owner.begin('A', 2)).toBeNull();
    expect(owner.finish(request)).toBe(true);
    expect(owner.begin('A', 2)).not.toBeNull();
  });
});
