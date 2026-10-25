import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { launchGuardedBackgroundTask } from '../async/guardedBackgroundTask';
import { saveValue } from '../storage/workspaceStore';
import type { WorkspaceProject } from '../workspace/workspaceTypes';
import { applyStarOverrides, type StarOverrides } from '../workspace/workspacePresentation';
import { WorkspaceActivityLedger } from '../workspace/workspaceActivityLedger';
import { WorkspaceAttentionLedger } from '../workspace/workspaceAttention';
import { projectsWithRunPhases } from '../workspace/runProjectPresentation';
import { SessionRunRegistry } from './sessionRunRegistry';
import { SELECTED_SESSION_KEY } from './gatewayWorkspaceStorageKeys';
import { immediateThreadRegistryMutationProjection } from './threadRegistryMutationProjection';
import { serializedPersistedWorkspaceSelection } from './persistedWorkspaceSelection';

type Options = {
  projectsRef: MutableRefObject<WorkspaceProject[]>;
  registrySnapshot: MutableRefObject<Record<string, unknown> | null>;
  selectedRef: MutableRefObject<string>;
  selectedProjectIDRef: MutableRefObject<string>;
  activityLedger: MutableRefObject<WorkspaceActivityLedger>;
  attentionLedger: MutableRefObject<WorkspaceAttentionLedger>;
  starOverrides: MutableRefObject<StarOverrides>;
  runRegistry: MutableRefObject<SessionRunRegistry>;
  setProjects: Dispatch<SetStateAction<WorkspaceProject[]>>;
  setProjectsReady: Dispatch<SetStateAction<boolean>>;
  setSelectedKey: Dispatch<SetStateAction<string>>;
  resetHistory: (project: WorkspaceProject | undefined, registry: Record<string, unknown> | null) => unknown;
  publishSelectedRun: (sessionKey?: string) => void;
};

export function useGatewayThreadRegistryMutation(options: Options) {
  const { projectsRef, registrySnapshot, selectedRef, selectedProjectIDRef, activityLedger, attentionLedger, starOverrides, runRegistry, setProjects, setProjectsReady, setSelectedKey, resetHistory, publishSelectedRun } = options;
  return useCallback((payload: Record<string, unknown>, preferredKey: string) => {
    const accepted = immediateThreadRegistryMutationProjection(projectsRef.current, registrySnapshot.current, payload, selectedRef.current, preferredKey);
    registrySnapshot.current = accepted.registrySnapshot;
    const withAttention = accepted.projects.map((project) => attentionLedger.current.isUnread(project.sessionKey) ? { ...project, unread: true } : project);
    const next = projectsWithRunPhases(activityLedger.current.reconcile(applyStarOverrides(withAttention, starOverrides.current)), runRegistry.current);
    const selectedProject = next.find((project) => project.sessionKey === accepted.selectedKey);
    projectsRef.current = next; setProjects(next); setProjectsReady(true);
    resetHistory(selectedProject, accepted.registrySnapshot);
    selectedRef.current = accepted.selectedKey; selectedProjectIDRef.current = selectedProject?.id ?? ''; setSelectedKey(accepted.selectedKey); publishSelectedRun(accepted.selectedKey);
    launchGuardedBackgroundTask(() => saveValue(
      SELECTED_SESSION_KEY,
      serializedPersistedWorkspaceSelection(accepted.selectedKey, selectedProjectIDRef.current),
    ));
  }, [activityLedger, attentionLedger, projectsRef, publishSelectedRun, registrySnapshot, resetHistory, runRegistry, selectedProjectIDRef, selectedRef, setProjects, setProjectsReady, setSelectedKey, starOverrides]);
}
