import { reconcileRegistryPayload } from '../workspace/registryProjection';
import type { WorkspaceProject } from '../workspace/workspaceTypes';
import { sessionSelectionAfterRefresh } from './sessionRefreshSelection';

export function immediateThreadRegistryMutationProjection(
  currentProjects: WorkspaceProject[],
  acceptedRegistry: Record<string, unknown> | null,
  mutationPayload: Record<string, unknown>,
  currentSelection: string,
  requestedSelection: string,
) {
  const registrySnapshot = { ...(acceptedRegistry ?? {}), ...mutationPayload };
  const projects = reconcileRegistryPayload(currentProjects, registrySnapshot, currentProjects);
  const currentProjectID = currentProjects.find((project) => project.sessionKey === currentSelection)?.id ?? '';
  return {
    registrySnapshot,
    projects,
    selectedKey: sessionSelectionAfterRefresh(projects, currentSelection, requestedSelection, currentProjectID),
  };
}
