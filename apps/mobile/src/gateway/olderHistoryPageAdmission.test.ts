import { expect, it, vi } from 'vitest';
import { loadPresentationBoundedOlderPage } from './olderHistoryPageAdmission';
it('bounds attempts and admits an indivisible raw record without looping', async () => {
  const load = vi.fn(async (limit: number) => limit);
  expect(await loadPresentationBoundedOlderPage(128, load, () => true, () => false)).toBe(1);
  expect(load.mock.calls.flat()).toEqual([128, 64, 32, 16, 8, 4, 2, 1]);
});
it('retires before a narrower retry can publish or issue another request', async () => {
  let owned = true;
  const load = vi.fn(async (limit: number) => { owned = false; return limit; });
  expect(await loadPresentationBoundedOlderPage(80, load, () => owned, () => false)).toBeNull();
  expect(load).toHaveBeenCalledOnce();
});
