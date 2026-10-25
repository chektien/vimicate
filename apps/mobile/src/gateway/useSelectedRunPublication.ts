import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { WorkspaceProject } from '../workspace/workspaceTypes';
import { projectsWithRunPhases } from '../workspace/runProjectPresentation';
import { selectedRunPresentation, type SessionRunRegistry } from './sessionRunRegistry';

/** Publish lifecycle changes, including confirmed Stops, through existing UI state. */
export function useSelectedRunPublication(
  registry: { current: SessionRunRegistry }, selected: { current: string },
  setSending: Dispatch<SetStateAction<boolean>>, setProjects: Dispatch<SetStateAction<WorkspaceProject[]>>,
) {
  return useCallback((_changedSessionKey = selected.current) => {
    setSending(selectedRunPresentation(registry.current, selected.current).sending);
    setProjects(current => projectsWithRunPhases(current, registry.current));
  }, [registry, selected, setSending, setProjects]);
}
