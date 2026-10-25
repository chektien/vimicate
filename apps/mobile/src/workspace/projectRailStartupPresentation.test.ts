import { describe, expect, it } from 'vitest';
import { projectRailStartupPresentation } from './projectRailStartupPresentation';
import type { WorkspaceProject } from './workspaceTypes';

const realProject: WorkspaceProject = {
  id: 'real',
  sessionKey: 'agent:main:direct:real',
  name: 'real project',
  path: '~/repos/real',
  branch: 'main',
  starred: false,
  threadCount: 1,
  state: 'idle',
};

describe('project rail startup presentation', () => {
  it('never presents fixture-like project cards before paired registry authority is ready', () => {
    expect(projectRailStartupPresentation([realProject], { paired: false, registryReady: false, fixture: false })).toEqual({
      projects: [],
      emptyLabel: 'pair to load projects',
    });
    expect(projectRailStartupPresentation([realProject], { paired: true, registryReady: false, fixture: false })).toEqual({
      projects: [],
      emptyLabel: 'loading projects…',
    });
  });

  it('publishes only authoritative projects, while explicit UI fixtures remain available to tests', () => {
    expect(projectRailStartupPresentation([realProject], { paired: true, registryReady: true, fixture: false })).toEqual({
      projects: [realProject],
      emptyLabel: 'no projects found',
    });
    expect(projectRailStartupPresentation([realProject], { paired: false, registryReady: false, fixture: true })).toEqual({
      projects: [realProject],
      emptyLabel: 'no projects found',
    });
  });
});
