import { expect, it } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { newerHistoryWindow } from './newerHistoryWindow';
import { olderReviewBytes, OLDER_REVIEW_BYTE_LIMIT } from './historyWindowBudget';
const key = 'thread';
const row = (index: number, length = 20000): WorkspaceMessage => ({ id: `r${index}`, role: 'tool', text: 'x'.repeat(length), source: 'history', sessionKey: key,
  timestamp: new Date(1800000000000 + index).toISOString() });
it('makes forward progress from a byte-full tool review while preserving its reader edge', () => {
  const visible = Array.from({ length: 100 }, (_, index) => row(index));
  expect(olderReviewBytes(visible)).toBeGreaterThan(OLDER_REVIEW_BYTE_LIMIT * .9);
  const next = newerHistoryWindow(visible, [row(100), row(101)], key);
  expect(next.some(message => message.id === 'r99')).toBe(true);
  expect(next.at(-1)?.id).toBe('r101');
  expect(olderReviewBytes(next)).toBeLessThan(OLDER_REVIEW_BYTE_LIMIT);
});
it('retains the irreducible reader-to-successor overlap instead of retrying one large record forever', () => {
  const next = newerHistoryWindow([row(0, 3000000)], [row(1, 3000000), row(2)], key);
  expect(next.map(message => message.id)).toEqual(['r0', 'r1']);
});
it('retains the actual measured viewport boundary even when the byte-preferred suffix would evict it', () => {
  const visible = Array.from({ length: 100 }, (_, index) => row(index));
  const next = newerHistoryWindow(visible, [row(100)], key, 'r50');
  expect(next[0]?.id).toBe('r50');
  expect(next.at(-1)?.id).toBe('r100');
});
