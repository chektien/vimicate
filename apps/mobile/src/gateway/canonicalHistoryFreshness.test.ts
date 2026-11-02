import { expect, it } from 'vitest';
import { CanonicalHistoryFreshness, canonicalHistoryToken } from './canonicalHistoryFreshness';
import type { WorkspaceProject } from '../workspace/workspaceTypes';

const project: WorkspaceProject = { id: 'a', sessionKey: 'a', name: 'A', path: '', branch: '', starred: false, threadCount: 1, state: 'idle', sessionId: 's1', updatedAt: 100 };
const { updatedAt: _omitted, ...undated } = project;

it('reuses only while event revision, activity time, phase and generation are unchanged', () => {
  const owner = new CanonicalHistoryFreshness(); let current = project; let revision = '0:1';
  owner.tokenFor = () => canonicalHistoryToken(revision, current, null);
  owner.record('a', owner.token('a')!, 1000);
  expect(owner.isFresh('a', 2000)).toBe(true);
  revision = '0:2'; expect(owner.isFresh('a', 2000)).toBe(false); revision = '0:1';
  current = { ...project, updatedAt: 200 }; expect(owner.isFresh('a', 2000)).toBe(false); current = project;
  current = { ...project, state: 'running', runPhase: 'running' }; expect(owner.isFresh('a', 2000)).toBe(false); current = project;
  current = { ...project, sessionId: 's2' }; expect(owner.isFresh('a', 2000)).toBe(false); current = project;
  expect(owner.isFresh('a', 1000 + 10 * 60_000 + 1)).toBe(false);
});

it('never reuses without a census activity time or a prior canonical read', () => {
  const owner = new CanonicalHistoryFreshness();
  owner.tokenFor = key => canonicalHistoryToken('0:0', key === 'a' ? project : { ...undated, sessionKey: 'b' }, null);
  expect(owner.isFresh('a')).toBe(false);
  expect(canonicalHistoryToken('0:0', undated, null)).toBeUndefined();
  expect(canonicalHistoryToken('0:0', undefined, null)).toBeUndefined();
});
