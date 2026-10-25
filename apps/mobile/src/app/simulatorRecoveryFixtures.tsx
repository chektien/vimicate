import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from './AppShell';
import { completedLatestHistoryPage } from '../gateway/completedLatestHistoryPage';
import { HistoryPublicationAuthority } from '../gateway/historyPublicationAuthority';
import { authorizedHistoryStatePublication } from '../gateway/historyReviewPublication';
import type { OpenClawClient } from '../gateway/OpenClawClient';
import { PendingFinalAnswerRegistry } from '../gateway/pendingFinalAnswerRegistry';
import { SessionRunMonitorOwners } from '../gateway/sessionRunMonitorOwners';
import { SessionRunRegistry } from '../gateway/sessionRunRegistry';
import { useGatewayFinalAnswerRecovery } from '../gateway/useGatewayFinalAnswerRecovery';
import { useGatewayMessageRecovery } from '../gateway/useGatewayMessageRecovery';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import {
  PAGINATION_PROBE, RETIREMENT_PROBE, SCENE_STALE_FINAL, SELECTION_STALE_FINAL,
  paginationLatestPayload, recoveryBacklogSession, recoverySceneMessageID, recoverySceneSession,
  recoverySelectionMessageID, recoverySelectionSession, simulatorRecoveryProject, simulatorRecoveryRows,
} from './simulatorRecoveryFixtureData';

class SimulatorRecoveryFakeIO {
  status = 'connected' as const;
  private timers = new Set<ReturnType<typeof setTimeout>>();

  history() {
    return this.schedule<Record<string, unknown>>(4_000, (_resolve, reject) => reject(new Error('optional context unavailable')));
  }

  getMessage(_sessionKey: string, messageID: string) {
    const text = messageID === recoverySelectionMessageID ? SELECTION_STALE_FINAL : SCENE_STALE_FINAL;
    return this.schedule<Record<string, unknown>>(12_000, resolve => resolve({ message: { id: messageID, text } }));
  }

  decorateMessages(messages: WorkspaceMessage[]) { return messages; }
  dispose() { for (const timer of this.timers) clearTimeout(timer); this.timers.clear(); }

  private schedule<T>(delay: number, work: (resolve: (value: T) => void, reject: (error: Error) => void) => void) {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.timers.delete(timer); work(resolve, reject); }, delay);
      this.timers.add(timer);
    });
  }
}

const marker = (id: string, text: string): WorkspaceMessage => ({ id, role: 'vimicate', text, source: 'history', state: 'complete' });

/** Simulator-only owner probe with fake local I/O and no Gateway restoration. */
export function SimulatorRecoveryFixtureApp() {
  const client = useMemo(() => new SimulatorRecoveryFakeIO(), []);
  const [messages, setMessages] = useState(() => simulatorRecoveryRows(false));
  const messagesRef = useRef(messages); messagesRef.current = messages;
  const selectionRef = useRef(recoverySelectionSession);
  const sceneSelectionRef = useRef(recoverySceneSession);
  const selectionScene = useRef(new HistoryPublicationAuthority());
  const retiredScene = useRef(new HistoryPublicationAuthority());
  const backlogScene = useRef(new HistoryPublicationAuthority());
  const runRegistry = useRef(new SessionRunRegistry());
  const pendingFinals = useRef(new PendingFinalAnswerRegistry());
  const recoveryOwners = useRef(new SessionRunMonitorOwners());
  const initialized = useRef(false);
  if (!initialized.current) {
    for (const [index, runId] of ['backlog-old', 'backlog-tracked', 'backlog-new'].entries()) pendingFinals.current.register(recoveryBacklogSession, runId, index + 1);
    runRegistry.current.registerRun(recoveryBacklogSession, 'backlog-tracked');
    initialized.current = true;
  }

  const publish = useCallback((sessionKey: string, action: WorkspaceMessage[] | ((current: WorkspaceMessage[]) => WorkspaceMessage[]), selected: { current: string }, scene: { current: HistoryPublicationAuthority }) => {
    const revision = scene.current.capture();
    setMessages(current => authorizedHistoryStatePublication(sessionKey, selected.current, sessionKey,
      () => scene.current.owns(revision), current, action).messages);
  }, []);
  const recoverSelection = useGatewayMessageRecovery({
    client: client as unknown as OpenClawClient, selectedRef: selectionRef, messagesRef,
    messageSessionKey: recoverySelectionSession, projectsRef: { current: [simulatorRecoveryProject] },
    updateSessionMessages: (key, action) => publish(key, action, selectionRef, selectionScene),
    setDetail: () => undefined, scenePublicationAuthority: selectionScene,
  });
  const recoverScene = useGatewayMessageRecovery({
    client: client as unknown as OpenClawClient, selectedRef: sceneSelectionRef, messagesRef,
    messageSessionKey: recoverySceneSession, projectsRef: { current: [simulatorRecoveryProject] },
    updateSessionMessages: (key, action) => publish(key, action, sceneSelectionRef, retiredScene),
    setDetail: () => undefined, scenePublicationAuthority: retiredScene,
  });
  const finalRecovery = useGatewayFinalAnswerRecovery({
    client: client as unknown as OpenClawClient, selectedRef: { current: recoveryBacklogSession },
    runRegistry, pendingFinalAnswers: pendingFinals, recoveryTasks: recoveryOwners,
    hasPublishedFinalForRun: () => false, loadHistory: async () => [],
    updateSessionMessages: (_key, action) => setMessages(current => typeof action === 'function' ? action(current) : action),
    persistPendingFinalAnswers: () => undefined, persistRuns: () => undefined, publishSelectedRun: () => undefined,
    setDetail: () => undefined, scenePublicationAuthority: backlogScene,
  });
  const finalRecoveryRef = useRef(finalRecovery); finalRecoveryRef.current = finalRecovery;
  const selectionRecoveryRef = useRef(recoverSelection); selectionRecoveryRef.current = recoverSelection;
  const sceneRecoveryRef = useRef(recoverScene); sceneRecoveryRef.current = recoverScene;

  useEffect(() => {
    const alive = { current: true };
    const timers = [
      setTimeout(() => void completedLatestHistoryPage(client as unknown as OpenClawClient,
        'fixture:recovery:pagination', paginationLatestPayload(), '', () => alive.current).then(completed => {
        if (!completed || !alive.current) return;
        const result = completed.lookbackProblem && completed.cursor.nextOffset === 80 ? PAGINATION_PROBE
          : `RECOVERY PROBE unexpected cursor ${String(completed.cursor.nextOffset)}`;
        setMessages(current => [...current, ...completed.messages, marker('pagination-probe', result)]);
      }), 6_000),
      setTimeout(() => { void selectionRecoveryRef.current(recoverySelectionMessageID); void sceneRecoveryRef.current(recoverySceneMessageID); }, 12_000),
      setTimeout(() => { selectionRef.current = 'fixture:recovery:other-selection'; retiredScene.current.suspend(); }, 15_000),
      setTimeout(() => setMessages(current => [
        ...simulatorRecoveryRows(true).filter(row => row.id !== recoverySelectionMessageID && row.id !== recoverySceneMessageID),
        ...current.filter(row => row.id === recoverySelectionMessageID || row.id === recoverySceneMessageID
          || row.id === 'recovery-pagination-latest' || row.id === 'pagination-probe' || row.role === 'run'),
        marker('retirement-probe', RETIREMENT_PROBE),
      ]), 28_000),
    ];
    finalRecoveryRef.current.recoverPendingFinalAnswers();
    return () => {
      alive.current = false; timers.forEach(clearTimeout); selectionScene.current.suspend(); retiredScene.current.suspend();
      backlogScene.current.suspend(); recoveryOwners.current.clear(); client.dispose();
    };
  }, [client]);

  return <AppShell fixtureMessages={messages} fixtureGatewayStatus="connected"
    fixtureProjectRail={{ projects: [simulatorRecoveryProject], selectedKey: simulatorRecoveryProject.sessionKey }} />;
}
