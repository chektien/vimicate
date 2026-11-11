import { expect, it } from 'vitest';
import { latestPresentationWindow, olderHistoryWindow } from './historyWindow';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
const rows: WorkspaceMessage[] = Array.from({ length: 20 }, (_, i) => ({ id: `r${i}`, role: i ? 'assistant' : 'user', text: String(i), sessionKey: 'route', source: 'history', displayPosition: { source: 'sqlite', rawSeq: i * 10 }, transcriptSessionId: 'generation' }));
it('marks a detached real prompt and tail without inventing an omitted count', () => {
  const next = latestPresentationWindow(rows, 5);
  expect(next.map(row => row.id)).toEqual(['r0', 'r16', 'r17', 'r18', 'r19']);
  expect(next[1]?.historyOmission).toEqual({ promptMessageId: 'r0', firstTailMessageId: 'r16' });
  expect(next[0]?.historyOmission).toBeUndefined();
});
it('converges a detached prompt into contiguous older recovery without duplication', () => {
  const tail = latestPresentationWindow(rows, 5);
  const next = olderHistoryWindow(rows.slice(0, 16), tail, 'route', 100);
  expect(next.map(row => row.id)).toEqual(rows.map(row => row.id));
  expect(next.every(row => !row.historyOmission)).toBe(true);
});
it('does not erase an earlier gap merely because a newer steering prompt is recovered', () => {
  const tail = latestPresentationWindow(rows, 5);
  const steer = { ...rows[10]!, role: 'user' as const };
  const next = olderHistoryWindow([steer, ...rows.slice(11, 16)], tail, 'route', 100);
  expect(next.find(row => row.id === steer.id)?.historyOmission).toEqual({ promptMessageId: 'r0', firstTailMessageId: 'r10' });
});
it('prefers a complete newer turn over a detached partial predecessor', () => {
  const newer = [...rows, { ...rows[0]!, id: 'next-prompt' }, { ...rows[19]!, id: 'next-answer' }];
  const next = latestPresentationWindow(newer, 5);
  expect(next.map(row => row.id)).toEqual(['next-prompt', 'next-answer']);
  expect(next.every(row => !row.historyOmission)).toBe(true);
});
