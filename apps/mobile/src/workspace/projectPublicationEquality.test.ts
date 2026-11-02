import { expect, it } from 'vitest';
import { sameProjectPublication } from './projectPublicationEquality';
import type { WorkspaceProject } from './workspaceTypes';

const project: WorkspaceProject = { id: 'one', sessionKey: 'one', name: 'One', path: '', branch: '', starred: false, threadCount: 1, state: 'idle', pendingQuestions: { own: 0, total: 1, threads: 1 } };
it('accepts equal projected values including independently allocated pending counts', () => {
  expect(sameProjectPublication([project], [{ ...project, pendingQuestions: { ...project.pendingQuestions! } }])).toBe(true);
});
it.each<Partial<WorkspaceProject>>([
  { unread: true }, { markedUnreadAt: 200 }, { updatedAt: 300 }, { state: 'running', runPhase: 'running' },
  { sessionId: 'replacement' }, { sessionStartedAtMs: 400 }, { model: 'new-model' }, { totalTokens: 2000 },
  { pendingQuestions: { own: 1, total: 1, threads: 0 } }, { name: 'Renamed' },
])('preserves real census changes %j', change => {
  expect(sameProjectPublication([project], [{ ...project, ...change }])).toBe(false);
});
it('does not hide membership or ordering changes', () => {
  const other = { ...project, id: 'two', sessionKey: 'two' };
  expect(sameProjectPublication([project], [project, other])).toBe(false);
  expect(sameProjectPublication([project, other], [other, project])).toBe(false);
});
