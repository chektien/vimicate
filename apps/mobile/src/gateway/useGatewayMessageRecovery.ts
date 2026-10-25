import { useCallback, useEffect, useRef, type SetStateAction } from 'react';
import type { WorkspaceMessage, WorkspaceProject } from '../workspace/workspaceTypes';
import type { OpenClawClient } from './OpenClawClient';
import { inactiveMessageRecovery, messageByApplyingRecovery, recoveredAssistantContent, recoveredToolRows, terminalRecoveryDetail } from './messageRecovery';
import { sessionOwnsDetailPublication } from './sessionPublicationOwnership';
import type { HistoryPublicationAuthority } from './historyPublicationAuthority';
import { BoundedSessionCache } from '../workspace/boundedSessionCache';
import type { SessionMessagePublicationIntent } from './historyReviewPublication';

type MessageRecoveryDependencies = {
  client: OpenClawClient;
  selectedRef: { current: string };
  messagesRef: { current: WorkspaceMessage[] };
  messageSessionKey: string;
  projectsRef: { current: WorkspaceProject[] };
  updateSessionMessages: (sessionKey: string, action: SetStateAction<WorkspaceMessage[]>, intent?: SessionMessagePublicationIntent) => void;
  setDetail: (detail: string) => void;
  scenePublicationAuthority: { current: HistoryPublicationAuthority };
};

const RECOVERY_LIMIT = 64;
type RecoveryTask = { promise: Promise<void>; cancel: () => void };

export function useGatewayMessageRecovery({ client, selectedRef, messagesRef, messageSessionKey, projectsRef, updateSessionMessages, setDetail, scenePublicationAuthority }: MessageRecoveryDependencies) {
  const tasks = useRef(new Map<string, RecoveryTask>());
  const attempts = useRef(new BoundedSessionCache<number>(RECOVERY_LIMIT));
  const visibleMessages = messagesRef.current;
  const sceneSignal = scenePublicationAuthority.current.signal;

  useEffect(() => {
    if (!scenePublicationAuthority.current.isActive || !messageSessionKey || selectedRef.current !== messageSessionKey) return;
    const revision = scenePublicationAuthority.current.capture();
    const orphaned = new Map(visibleMessages.filter(message => message.recovery?.state === 'loading'
      && !tasks.current.has(recoveryKey(messageSessionKey, message.recovery.sourceMessageId)))
      .map(message => [message.id, message.recovery!.sourceMessageId]));
    if (!orphaned.size) return;
    updateSessionMessages(messageSessionKey, current => {
      if (!scenePublicationAuthority.current.owns(revision)) return current;
      return current.map(message => message.recovery?.state === 'loading'
        && orphaned.get(message.id) === message.recovery.sourceMessageId
        && !tasks.current.has(recoveryKey(messageSessionKey, message.recovery.sourceMessageId))
        ? { ...message, recovery: inactiveMessageRecovery(message.recovery)! } : message);
    }, 'message-recovery');
  }, [messageSessionKey, sceneSignal, scenePublicationAuthority, selectedRef, updateSessionMessages, visibleMessages]);

  useEffect(() => () => {
    for (const task of tasks.current.values()) task.cancel();
    attempts.current.clear();
  }, []);

  return useCallback(async (messageID: string) => {
    if (!scenePublicationAuthority.current.isActive || selectedRef.current !== messageSessionKey) return;
    const activityRevision = scenePublicationAuthority.current.capture();
    const sessionKey = selectedRef.current;
    const message = messagesRef.current.find((candidate) => candidate.id === messageID);
    const recovery = message?.recovery;
    if (!sessionKey || !message || !recovery?.sourceMessageId || recovery.state === 'recovered' || recovery.state === 'unavailable') return;
    const taskKey = recoveryKey(sessionKey, recovery.sourceMessageId);
    const existing = tasks.current.get(taskKey); if (existing) return existing.promise;
    const attemptCount = attempts.current.restore(taskKey) ?? 0;
    if (attemptCount >= 4) {
      updateSessionMessages(sessionKey, (current) => current.map((candidate) => matchesRecovery(candidate, messageID, recovery.sourceMessageId) ? { ...candidate, recovery: { ...candidate.recovery!, state: 'unavailable', detail: 'full response unavailable after 4 attempts' } } : candidate), 'message-recovery');
      return;
    }
    if (tasks.current.size >= RECOVERY_LIMIT) { setDetail('full response recovery busy; tap to retry shortly'); return; }
    const signal = scenePublicationAuthority.current.signal;
    const task: RecoveryTask = { promise: Promise.resolve(), cancel: () => finish(true) };
    const finish = (cancelled = false) => {
      if (tasks.current.get(taskKey) !== task) return;
      tasks.current.delete(taskKey); signal.removeEventListener('abort', task.cancel);
      if (cancelled) attempts.current.store(taskKey, Math.max(0, (attempts.current.restore(taskKey) ?? 1) - 1));
    };
    const ownsTask = () => scenePublicationAuthority.current.owns(activityRevision) && tasks.current.get(taskKey) === task;
    attempts.current.store(taskKey, attemptCount + 1); tasks.current.set(taskKey, task);
    signal.addEventListener('abort', task.cancel, { once: true });
    task.promise = Promise.resolve().then(async () => {
      try {
        if (!ownsTask()) return;
        updateSessionMessages(sessionKey, (current) => current.map((candidate) => matchesRecovery(candidate, messageID, recovery.sourceMessageId) ? { ...candidate, recovery: { ...candidate.recovery!, state: 'loading', detail: 'loading full response…' } } : candidate), 'message-recovery');
        const payload = await client.getMessage(sessionKey, recovery.sourceMessageId, 524_288);
        if (!ownsTask()) return;
        const terminalDetail = terminalRecoveryDetail(payload);
        if (terminalDetail) {
          updateSessionMessages(sessionKey, current => current.map(candidate => matchesRecovery(candidate, messageID, recovery.sourceMessageId)
            ? { ...candidate, recovery: { ...candidate.recovery!, state: 'unavailable', detail: terminalDetail } } : candidate), 'message-recovery');
          if (sessionOwnsDetailPublication(sessionKey, selectedRef.current)) setDetail(terminalDetail);
          return;
        }
        const workspacePath = projectsRef.current.find((project) => project.sessionKey === sessionKey)?.path ?? '';
        const projectedTools = recoveredToolRows(message, payload, sessionKey, workspacePath);
        const recovered = projectedTools.length ? undefined : recoveredAssistantContent(payload, workspacePath);
        const hasRecoveredContent = projectedTools.length > 0
          || recovered !== undefined && messageByApplyingRecovery(message, recovered.text, recovered.attachments).recovery?.state === 'recovered';
        updateSessionMessages(sessionKey, (current) => current.flatMap((candidate) => {
          if (!matchesRecovery(candidate, messageID, recovery.sourceMessageId)) return [candidate];
          return client.decorateMessages(projectedTools.length ? projectedTools : [messageByApplyingRecovery(candidate, recovered!.text, recovered!.attachments)], sessionKey);
        }), 'message-recovery');
        if (sessionOwnsDetailPublication(sessionKey, selectedRef.current)) setDetail(hasRecoveredContent ? 'full response recovery completed' : 'full response is still incomplete');
      } catch (error) {
        if (!ownsTask()) return;
        const detail = error instanceof Error ? error.message : 'full response recovery failed';
        updateSessionMessages(sessionKey, (current) => current.map((candidate) => matchesRecovery(candidate, messageID, recovery.sourceMessageId) ? { ...candidate, recovery: { ...candidate.recovery!, state: 'failed', detail: `${detail} · tap to retry` } } : candidate), 'message-recovery');
        if (sessionOwnsDetailPublication(sessionKey, selectedRef.current)) setDetail(detail);
      } finally { finish(); }
    });
    return task.promise;
  }, [client, messageSessionKey, messagesRef, projectsRef, scenePublicationAuthority, selectedRef, setDetail, updateSessionMessages]);
}

function recoveryKey(sessionKey: string, sourceMessageId: string) { return JSON.stringify([sessionKey, sourceMessageId]); }
function matchesRecovery(message: WorkspaceMessage, id: string, source: string) {
  return message.id === id && message.recovery?.sourceMessageId === source && message.recovery.state !== 'recovered';
}
