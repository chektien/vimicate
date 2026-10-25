import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { launchGuardedBackgroundTask } from '../async/guardedBackgroundTask';
import { saveValue } from '../storage/workspaceStore';
import { reconcileRegistryPayload } from '../workspace/registryProjection';
import { applyStarOverrides, type StarOverrides } from '../workspace/workspacePresentation';
import { projectsFromPayload, sessionEntriesFromPayload, type WorkspaceProject } from '../workspace/workspaceTypes';
import { projectsWithRunPhases } from '../workspace/runProjectPresentation';
import { acceptSessionCensusAttention, type WorkspaceAttentionLedger } from '../workspace/workspaceAttention';
import type { WorkspaceActivityLedger } from '../workspace/workspaceActivityLedger';
import { resolveProjectRegistryAuthority } from '../workspace/projectRegistryAuthority';
import type { ProjectRegistryRetryOwner } from '../workspace/projectRegistryRetry';
import { applySessionRegistryCensus, captureSessionCensusRequests } from './sessionRegistryLifecycle';
import { reconcileAuthoritativeActiveRunLifecycle } from './runCompletionMessage';
import { upsertLiveMessage } from './gatewayEventProjection';
import { sessionFailureNotices } from './sessionFailureNotice';
import { shouldHydrateSelectedHistory } from './historyRefreshPolicy';
import { sessionSelectionAfterRefresh } from './sessionRefreshSelection';
import { SessionRefreshOwner } from './sessionRefreshOwner';
import { gatewaySessionGeneration } from './registrySessionIdentity';
import { WORKSPACE_ATTENTION_KEY } from './gatewayWorkspaceStorageKeys';
import type { OpenClawClient } from './OpenClawClient';
import type { SessionRunRegistry } from './sessionRunRegistry';
import type { HistoryPublicationAuthority } from './historyPublicationAuthority';
import type { useGatewayHistory } from './useGatewayHistory';

type History = ReturnType<typeof useGatewayHistory>;
type Options = Pick<History, 'configureArchive' | 'resetHistory' | 'ownsSession' | 'loadHistory' | 'visibleSessionMessages' | 'updateSessionMessages'> & {
  client: OpenClawClient;
  scenePublicationAuthority: MutableRefObject<HistoryPublicationAuthority>;
  runRegistry: MutableRefObject<SessionRunRegistry>;
  attentionLedger: MutableRefObject<WorkspaceAttentionLedger>;
  activityLedger: MutableRefObject<WorkspaceActivityLedger>;
  starOverrides: MutableRefObject<StarOverrides>;
  registrySnapshot: MutableRefObject<Record<string, unknown> | null>;
  registryRetryOwner: MutableRefObject<ProjectRegistryRetryOwner>;
  appActive: MutableRefObject<boolean>;
  suspendedByBackground: MutableRefObject<boolean>;
  selectedRef: MutableRefObject<string>;
  selectedProjectIDRef: MutableRefObject<string>;
  projectsRef: MutableRefObject<WorkspaceProject[]>;
  setProjects: Dispatch<SetStateAction<WorkspaceProject[]>>;
  setProjectsReady: Dispatch<SetStateAction<boolean>>;
  setSelectedKey: Dispatch<SetStateAction<string>>;
  setDetail: Dispatch<SetStateAction<string>>;
  recordLocalInteraction: (key: string, timestamp?: number, unread?: boolean) => void;
  persistRuns: () => void;
  persistWorkspaceSelection: (key: string, projectID: string) => void;
  publishSelectedRun: (key?: string) => void;
  refreshRunTruth: (key: string, follow?: boolean, ownsGeneration?: () => boolean) => Promise<void>;
};

export function useGatewaySessionRefresh(options: Options) {
  const { client, scenePublicationAuthority, runRegistry, attentionLedger, activityLedger, starOverrides, registrySnapshot, registryRetryOwner, appActive, suspendedByBackground, selectedRef, selectedProjectIDRef, projectsRef, setProjects, setProjectsReady, setSelectedKey, setDetail, recordLocalInteraction, persistRuns, persistWorkspaceSelection, publishSelectedRun, refreshRunTruth, configureArchive, resetHistory, ownsSession, loadHistory, visibleSessionMessages, updateSessionMessages } = options;
  const owner = useRef(new SessionRefreshOwner());
  const loadSessionsRef = useRef<(refreshRegistry?: boolean, preferredKey?: string, requireRegistry?: boolean) => Promise<void>>(async () => undefined);
  useEffect(() => () => owner.current.clear(), []);
  const loadSessions = useCallback(async (refreshRegistry = false, preferredKey = '', requireRegistry = false, requireSelectedHistoryHydration: boolean | string = false) => {
    if (client.status !== 'connected' || !scenePublicationAuthority.current.isActive) return;
    const activityRevision = scenePublicationAuthority.current.capture();
    const connectionRevision = client.connectionRevision;
    const requestedProject = projectsRef.current.find(project => project.sessionKey === requireSelectedHistoryHydration);
    return owner.current.request({
      refreshRegistry, requireRegistry, preferredKey, selectionKey: selectedRef.current,
      hydrateSelected: requireSelectedHistoryHydration === true,
      requiredHistory: new Map(requestedProject ? [[requestedProject.sessionKey, JSON.stringify(gatewaySessionGeneration(requestedProject, registrySnapshot.current))]] : []),
    }, { connection: connectionRevision, signal: scenePublicationAuthority.current.signal, historyGeneration: key => { const project = projectsRef.current.find(project => project.sessionKey === key); return project ? JSON.stringify(gatewaySessionGeneration(project, registrySnapshot.current)) : undefined; } }, async (intent, ownsRefresh) => {
      const { refreshRegistry, requireRegistry } = intent;
      const ownsPublication = () => ownsRefresh() && client.status === 'connected' && client.connectionRevision === connectionRevision && scenePublicationAuthority.current.owns(activityRevision);
      if (!ownsPublication()) return;
      const censusRequests = captureSessionCensusRequests(runRegistry.current);
      try {
        const payload = await client.listSessions();
        if (!ownsPublication()) return;
        if (acceptSessionCensusAttention(attentionLedger.current, payload, selectedRef.current, recordLocalInteraction)) launchGuardedBackgroundTask(() => saveValue(WORKSPACE_ATTENTION_KEY, attentionLedger.current.serialized()));
        const registryLifecycleChanged = applySessionRegistryCensus(runRegistry.current, payload, censusRequests, (sessionKey, runId) => {
          updateSessionMessages(sessionKey, current => reconcileAuthoritativeActiveRunLifecycle(current, sessionKey, runId));
        });
        if (registryLifecycleChanged) persistRuns();
        let registryCandidate: Record<string, unknown> | null = null;
        if (refreshRegistry || !registrySnapshot.current) {
          try { registryCandidate = await client.readRegistry(); }
          catch (error) {
            if (!ownsPublication()) return;
            // A typed registry read is deterministic authority. Never erase a
            // previously accepted snapshot or replace it with session guesses
            // merely because this round trip failed.
            if (requireRegistry) {
              const detail = error instanceof Error ? error.message : 'typed registry read failed';
              throw new Error(`project registry unchanged: ${detail}; no model fallback used`);
            }
          }
        }
        if (!ownsPublication()) return;
        const registryAuthority = resolveProjectRegistryAuthority(registrySnapshot.current, registryCandidate);
        registrySnapshot.current = registryAuthority.snapshot;
        if (!registryAuthority.ready) {
          setProjectsReady(false);
          setDetail('project registry unavailable; refresh to retry');
          registryRetryOwner.current.schedule(() => {
            if (client.status !== 'connected' || !appActive.current || suspendedByBackground.current || registrySnapshot.current) return;
            void loadSessionsRef.current(true, '', false);
          });
          return;
        }
        if (registryRetryOwner.current.acceptAuthority()) setDetail('projects ready');
        const sessionProjection = projectsFromPayload(payload);
        const registryProjection = reconcileRegistryPayload(sessionProjection, registryAuthority.snapshot, sessionEntriesFromPayload(payload));
        const withAttention = registryProjection.map((project) => attentionLedger.current.isUnread(project.sessionKey) ? { ...project, unread: true } : project);
        const next = projectsWithRunPhases(activityLedger.current.reconcile(applyStarOverrides(withAttention, starOverrides.current)), runRegistry.current); setProjectsReady(true);
        if (next.length) {
          const currentProjectID = selectedProjectIDRef.current || projectsRef.current.find((project) => project.sessionKey === selectedRef.current)?.id || '';
          // Subscription frames can arrive before React commits this registry.
          projectsRef.current = next;
          setProjects(next);
          const preferredKey = selectedRef.current === intent.selectionKey ? intent.preferredKey : '';
          const key = sessionSelectionAfterRefresh(next, selectedRef.current, preferredKey, currentProjectID);
          const selectedProject = next.find((project) => project.sessionKey === key);
          const previousKey = selectedRef.current;
          const previousProjectID = selectedProjectIDRef.current;
          let generationChanged = false;
          if (selectedRef.current !== key || !ownsSession(key)) resetHistory(selectedProject, registrySnapshot.current);
          else generationChanged = configureArchive(selectedProject, registrySnapshot.current) === 'generation';
          selectedRef.current = key;
          selectedProjectIDRef.current = selectedProject?.id ?? '';
          setSelectedKey(key);
          if (key && (key !== previousKey || selectedProjectIDRef.current !== previousProjectID)) persistWorkspaceSelection(key, selectedProjectIDRef.current);
          publishSelectedRun(key);
          for (const notice of sessionFailureNotices(payload, next)) updateSessionMessages(notice.sessionKey!, current => upsertLiveMessage(current, notice));
          if (key) {
            const generationKey = JSON.stringify(gatewaySessionGeneration(selectedProject, registrySnapshot.current));
            const ownsGeneration = () => generationKey === JSON.stringify(gatewaySessionGeneration(projectsRef.current.find(project => project.sessionKey === key), registrySnapshot.current));
            const requiredHistory = intent.requiredHistory.get(key) === generationKey;
            await refreshRunTruth(key, true, ownsGeneration);
            if (!ownsPublication() || !ownsGeneration() || selectedRef.current !== key) return;
            if (shouldHydrateSelectedHistory(
              generationChanged,
              Boolean(runRegistry.current.runFor(key)),
              visibleSessionMessages(key), intent.hydrateSelected || requiredHistory,
            )) await loadHistory(key, 'preserve-review', requiredHistory);
          }
        }
      } catch (error) {
        if (!ownsPublication()) return;
        setDetail(error instanceof Error ? error.message : 'sessions failed');
        if (requireRegistry) throw error;
      }
    });
  }, [client, configureArchive, loadHistory, ownsSession, persistRuns, publishSelectedRun, refreshRunTruth, recordLocalInteraction, resetHistory, updateSessionMessages, visibleSessionMessages]);
  loadSessionsRef.current = loadSessions;
  const retireSessionRefresh = useCallback(() => owner.current.clear(), []);
  return { loadSessions, retireSessionRefresh };
}
