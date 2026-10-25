import { expect, it } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { latestHistoryRefreshAction, olderPageHistoryPublication } from './historyReviewPublication';
import { mergeSharedNarration } from './sharedNarration';
import { narrationInsideHistoryWindow } from './sharedNarrationWindow';
const time = 1_788_000_000_000;
const row = (id: string, at: number): WorkspaceMessage => ({ id, role: 'user', text: id, timestamp: String(time + at), sessionKey: 'one', source: 'history', transcriptSessionId: 'generation' });
const narration = (id: string, at: number): WorkspaceMessage => ({ ...row(`live-item-${id}`, at), role: 'narration', narrationItemId: id });

it('repairs polluted latest caches without removing canonical older narration or live rows', () => {
  const latest = [row('current', 100)];
  const shared = narration('old', 1);
  const canonical: WorkspaceMessage = { ...narration('canonical', 2), displayPosition: { source: 'native', rawSeq: 2 } };
  const live: WorkspaceMessage = { ...narration('live', 3), source: 'live' };
  const current = [shared, canonical, live, ...latest];
  const next = latestHistoryRefreshAction(latest, 'one', () => current)(current);
  expect(next.map(row => row.id)).not.toContain(shared.id);
  expect(next.map(row => row.id)).toEqual(expect.arrayContaining([canonical.id, live.id, 'current']));
});
it('admits older shared preambles only when their canonical page is loaded', () => {
  const snapshot = [narration('previous', 10), narration('page', 55), narration('latest', 105)];
  const latest = mergeSharedNarration([row('latest-prompt', 100), row('tail', 110)], snapshot);
  expect(latest.map(row => row.id)).toEqual(['latest-prompt', 'live-item-latest', 'tail']);
  const older = olderPageHistoryPublication(latest, latest, [row('page-prompt', 50)], 'one', snapshot);
  expect(older.visible.map(row => row.id)).toEqual(['page-prompt', 'live-item-page', 'latest-prompt', 'live-item-latest', 'tail']);
  expect(older.latest).toBe(latest);
});
it('does not import a different session generation into an established page', () => {
  const wrong = { ...narration('wrong-generation', 200), transcriptSessionId: 'retired' };
  expect(narrationInsideHistoryWindow([wrong], [row('current', 100)])).toEqual([]);
});
it('preserves narration-only fallback when no dated canonical window is known', () => {
  const snapshot = [narration('fallback', 10)];
  expect(narrationInsideHistoryWindow(snapshot, [])).toBe(snapshot);
  expect(mergeSharedNarration([], snapshot)).toEqual(snapshot);
});
