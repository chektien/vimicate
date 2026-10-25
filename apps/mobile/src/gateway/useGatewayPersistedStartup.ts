import * as SecureStore from 'expo-secure-store';
import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { loadValue } from '../storage/workspaceStore';
import { applyStarOverrides, parseStarOverrides, type StarOverrides } from '../workspace/workspacePresentation';
import type { WorkspaceProject } from '../workspace/workspaceTypes';
import { WorkspaceActivityLedger } from '../workspace/workspaceActivityLedger';
import { WorkspaceAttentionLedger } from '../workspace/workspaceAttention';
import { gatewayProfileRestorePlan, settledSharedGatewayProfile, type SettledSharedGatewayProfile } from './gatewayProfileRestore';
import { loadSharedGatewayProfile } from './sharedPairing';
import type { GatewayProfile } from './setupCode';
import type { PendingFinalAnswerRegistry } from './pendingFinalAnswerRegistry';
import type { SessionRunRegistry } from './sessionRunRegistry';
import { ACTIVE_RUNS_KEY, LEGACY_LAB_PROFILE_KEY, PENDING_FINAL_ANSWERS_KEY, PROFILE_KEY, SELECTED_SESSION_KEY, STARRED_SESSION_KEYS, WORKSPACE_ACTIVITY_KEY, WORKSPACE_ATTENTION_KEY } from './gatewayWorkspaceStorageKeys';
import { launchGuardedBackgroundTask } from '../async/guardedBackgroundTask';
import { parsedPersistedWorkspaceSelection } from './persistedWorkspaceSelection';

type PersistedWorkspaceRestore = [SettledSharedGatewayProfile, string | null, string | null, string | null, string | null, string | null, string | null, string | null, string | null];

type Dependencies = {
  enabled?: boolean;
  canPublish: () => boolean;
  runRegistry: MutableRefObject<SessionRunRegistry>;
  starOverrides: MutableRefObject<StarOverrides>;
  activityLedger: MutableRefObject<WorkspaceActivityLedger>;
  attentionLedger: MutableRefObject<WorkspaceAttentionLedger>;
  pendingFinalAnswers: MutableRefObject<PendingFinalAnswerRegistry>;
  setProjects: Dispatch<SetStateAction<WorkspaceProject[]>>;
  selectedRef: MutableRefObject<string>;
  selectedProjectIDRef: MutableRefObject<string>;
  setSelectedKey: Dispatch<SetStateAction<string>>;
  profileRef: MutableRefObject<GatewayProfile | null>;
  reconnectEnabled: MutableRefObject<boolean>;
  setProfile: Dispatch<SetStateAction<GatewayProfile | null>>;
  setDetail: Dispatch<SetStateAction<string>>;
  establishConnection: (profile: GatewayProfile) => Promise<void>;
};

/**
 * Local pairing/selection restore may finish while iOS is inactive. Retain the
 * immutable snapshot without touching React, then apply it once the root scene
 * owner resumes. This keeps cold startup recoverable without a second AppState
 * listener or an inactive Keychain continuation.
 */
export function useGatewayPersistedStartup(dependencies: Dependencies) {
  const {
    enabled = true, canPublish, runRegistry, starOverrides, activityLedger, attentionLedger,
    pendingFinalAnswers, setProjects, selectedRef, selectedProjectIDRef, setSelectedKey, profileRef,
    reconnectEnabled, setProfile, setDetail, establishConnection,
  } = dependencies;
  const pending = useRef<PersistedWorkspaceRestore | null>(null);
  const problem = useRef('');
  const applied = useRef(false);
  const mounted = useRef(true);
  const loadRevision = useRef(0);
  const apply = useCallback(() => {
    if (!mounted.current || applied.current || !pending.current || !canPublish()) return;
    applied.current = true;
    const [sharedResult, current, legacy, restoredSelection, restoredStars, restoredRuns, restoredActivity, restoredAttention, restoredPendingFinalAnswers] = pending.current;
    pending.current = null;
    runRegistry.current.restore(restoredRuns);
    starOverrides.current = parseStarOverrides(restoredStars);
    activityLedger.current.restore(restoredActivity);
    attentionLedger.current.restore(restoredAttention);
    pendingFinalAnswers.current.restore(restoredPendingFinalAnswers);
    setProjects((projects) => activityLedger.current.reconcile(applyStarOverrides(projects.map((project) => attentionLedger.current.isUnread(project.sessionKey) ? { ...project, unread: true } : project), starOverrides.current)));
    const selection = parsedPersistedWorkspaceSelection(restoredSelection);
    if (selection.sessionKey) {
      selectedRef.current = selection.sessionKey;
      selectedProjectIDRef.current = selection.projectID;
      setSelectedKey(selection.sessionKey);
    }
    const plan = gatewayProfileRestorePlan(sharedResult.profile, current, legacy);
    if (!plan) { if (sharedResult.problem) setDetail(sharedResult.problem); return; }
    try {
      const restored = JSON.parse(plan.serialized) as GatewayProfile;
      profileRef.current = restored; reconnectEnabled.current = true;
      setProfile(restored); setDetail(plan.source === 'shared' ? 'shared native device pairing restored' : 'paired profile restored');
      if (plan.shouldPersistPrivate) launchGuardedBackgroundTask(() => SecureStore.setItemAsync(PROFILE_KEY, plan.serialized, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY }));
      if (plan.shouldConnect) void establishConnection(restored).catch((error: unknown) => {
        if (canPublish()) setDetail(error instanceof Error ? error.message : 'paired profile connection failed');
      });
    } catch { setDetail('stored profile invalid'); }
  }, [activityLedger, attentionLedger, canPublish, establishConnection, pendingFinalAnswers, profileRef, reconnectEnabled, runRegistry, selectedProjectIDRef, selectedRef, setDetail, setProfile, setProjects, setSelectedKey, starOverrides]);

  useEffect(() => {
    // Explicit local UI fixtures must not restore shared pairing or real runs.
    if (!enabled) return;
    mounted.current = true;
    const revision = ++loadRevision.current;
    void loadPersistedWorkspaceRestore().then((restored) => {
      if (!mounted.current || loadRevision.current !== revision) return;
      pending.current = restored; apply();
    }).catch((error: unknown) => {
      if (!mounted.current || loadRevision.current !== revision) return;
      problem.current = error instanceof Error ? error.message : 'shared Keychain read failed';
      if (canPublish()) { setDetail(problem.current); problem.current = ''; }
    });
    return () => { mounted.current = false; if (loadRevision.current === revision) loadRevision.current += 1; };
  }, [apply, canPublish, enabled, setDetail]);

  return useCallback(() => {
    apply();
    if (problem.current && canPublish()) { setDetail(problem.current); problem.current = ''; }
  }, [apply, canPublish, setDetail]);
}

function loadPersistedWorkspaceRestore(): Promise<PersistedWorkspaceRestore> {
  return Promise.all([
    settledSharedGatewayProfile(loadSharedGatewayProfile),
    SecureStore.getItemAsync(PROFILE_KEY), SecureStore.getItemAsync(LEGACY_LAB_PROFILE_KEY),
    loadValue(SELECTED_SESSION_KEY).catch(() => null), loadValue(STARRED_SESSION_KEYS).catch(() => null),
    loadValue(ACTIVE_RUNS_KEY).catch(() => null), loadValue(WORKSPACE_ACTIVITY_KEY).catch(() => null),
    loadValue(WORKSPACE_ATTENTION_KEY).catch(() => null), loadValue(PENDING_FINAL_ANSWERS_KEY).catch(() => null),
  ]);
}
