import type { WorkspaceProject } from './workspaceTypes';

type StartupAuthority = {
  paired: boolean;
  registryReady: boolean;
  fixture: boolean;
};

/**
 * The project rail must not turn fallback/development data into believable
 * workspaces while the paired registry is still loading. Explicit UI fixtures
 * are the only caller allowed to present those rows without registry authority.
 */
export function projectRailStartupPresentation(projects: WorkspaceProject[], authority: StartupAuthority) {
  if (authority.fixture || (authority.paired && authority.registryReady)) {
    return { projects, emptyLabel: 'no projects found' };
  }
  return authority.paired
    ? { projects: [] as WorkspaceProject[], emptyLabel: 'loading projects…' }
    : { projects: [] as WorkspaceProject[], emptyLabel: 'pair to load projects' };
}
