import { describe, expect, it } from 'vitest';
import { applyStarOverrides, parseStarOverrides, presentWorkspaceProjects, updatedStarOverrides, visibleWorkspaceProjects } from './workspacePresentation';
import type { WorkspaceProject } from './workspaceTypes';

const project = (sessionKey: string, updatedAt: number, extra: Partial<WorkspaceProject> = {}): WorkspaceProject => ({
  id: sessionKey, sessionKey, name: sessionKey, path: '', branch: '—', starred: false, threadCount: 1, state: 'idle', kind: 'project', updatedAt, ...extra,
});

describe('workspace presentation', () => {
  it('presents activity as the native flat reverse-chronological attention feed', () => {
    const alpha = project('alpha', 1);
    const alphaThread = project('alpha-thread', 50, { kind: 'thread', rootSessionKey: 'alpha', threadCount: 0 });
    const beta = project('beta', 20);
    const betaThread = project('beta-thread', 10, { kind: 'thread', rootSessionKey: 'beta', threadCount: 0 });
    expect(presentWorkspaceProjects([beta, betaThread, alpha, alphaThread], 'activity').map(({ sessionKey }) => sessionKey))
      .toEqual(['alpha-thread', 'beta', 'beta-thread', 'alpha']);
  });

  it('persists explicit false overrides and migrates the old true-only array', () => {
    expect(parseStarOverrides('["alpha"]')).toEqual({ alpha: true });
    const gatewayStar = project('alpha', 1, { starred: true });
    const overrides = updatedStarOverrides({}, gatewayStar);
    expect(overrides).toEqual({ alpha: false });
    expect(applyStarOverrides([gatewayStar], overrides)[0]?.starred).toBe(false);
    expect(applyStarOverrides([gatewayStar], parseStarOverrides(JSON.stringify(overrides)))[0]?.starred).toBe(false);
  });

  it('moves starred roots and their threads into one exclusive leading section', () => {
    const alpha = project('alpha', 1);
    const alphaThread = project('alpha-thread', 2, { kind: 'thread', rootSessionKey: 'alpha' });
    const notes = project('notes', 3, { starred: true });
    const child = project('example-thread', 4, { kind: 'thread', rootSessionKey: 'notes' });
    const research = project('research', 5, { kind: 'thread', rootSessionKey: 'notes' });
    expect(presentWorkspaceProjects([alpha, alphaThread, notes, child, research], 'manual').map(({ sessionKey }) => sessionKey))
      .toEqual(['notes', 'example-thread', 'research', 'alpha', 'alpha-thread']);
  });

  it('hides only descendants of collapsed roots in manual mode', () => {
    const alpha = project('alpha', 1);
    const alphaThread = project('alpha-thread', 2, { kind: 'thread', rootSessionKey: 'alpha' });
    const beta = project('beta', 3);
    expect(visibleWorkspaceProjects([alpha, alphaThread, beta], 'manual', new Set(['alpha'])).map(({ sessionKey }) => sessionKey)).toEqual(['alpha', 'beta']);
    expect(visibleWorkspaceProjects([alpha, alphaThread, beta], 'activity', new Set(['alpha']))).toHaveLength(3);
  });
});
