import { gatewayRequestWasRefused, type GatewayRequestFailure } from './gatewayRequestDelivery';
import { requestGatewayStop } from './gatewayStopRequest';
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { loadValue, saveValue } from '../storage/workspaceStore';
import type { GatewayStatus } from './OpenClawClient';
import type { HistoryPublicationAuthority } from './historyPublicationAuthority';
import type { SessionRunRegistry } from './sessionRunRegistry';
import { cancelGatewayQueuedInput, gatewayQueuedInputAck, readGatewayQueuedInput, type GatewayQueuedInputPort } from './gatewayQueuedInput';
import type { QueuedInterruptScope, QueuedInterruptResult } from './queuedPromptSubmission';
import { QueuedPromptOwner, type QueuedPromptPreparation, type QueuedPromptRecord } from './queuedPromptOwner';

export type QueuedPromptOptions = {
  endpoint: string; status: GatewayStatus; client: GatewayQueuedInputPort & { readonly connectionRevision?: number };
  authority: MutableRefObject<HistoryPublicationAuthority>; runRegistry: MutableRefObject<SessionRunRegistry>;
  selectedSessionKey: string; selectedSessionId: string; messages?: WorkspaceMessage[];
  onStopConfirmed?: (sessionKey: string) => void;
};
export type QueuedPromptView = QueuedPromptRecord & { canCancel: boolean; canRunNow: boolean; busy: boolean };
const REFRESH_MS = 5000;

/** Persists identities before the caller sends. All reconnection work is read-only. */
export function useGatewayQueuedPrompts(options: QueuedPromptOptions) {
  const { endpoint, authority, selectedSessionKey, selectedSessionId, status } = options;
  const owner = useMemo(() => new QueuedPromptOwner(), [endpoint]);
  const [loadedOwner, setLoadedOwner] = useState<QueuedPromptOwner | null>(null);
  const [revision, setRevision] = useState(0); const [storageError, setStorageError] = useState<string>();
  const [busyId, setBusyId] = useState<string | null>(null);
  const latest = useRef({ options, owner }); latest.current = { options, owner };
  const alive = useRef(true); const readBusy = useRef(false); const actionBusy = useRef<string | null>(null);
  const scene = authority.current; const sceneRevision = scene.capture();
  const storageKey = endpoint ? `queued-prompts:v1:${endpoint}` : '';
  const persistence = useMemo(() => {
    let tail = Promise.resolve();
    return (payload: string, owns: () => boolean) => {
      const write = tail.catch(() => {}).then(async () => {
        if (!owns()) throw new Error('Queued-message storage retired.');
        await saveValue(storageKey, payload);
      });
      tail = write; return write;
    };
  }, [storageKey]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const ownsEndpoint = useCallback(() => alive.current && latest.current.owner === owner, [owner]);
  const publish = useCallback(() => { if (ownsEndpoint() && authority.current.isActive) setRevision(value => value + 1); }, [authority, ownsEndpoint]);
  const capture = useCallback(() => {
    const captured = latest.current.options; const authorityOwner = captured.authority.current; const epoch = authorityOwner.capture(); const connection = captured.client.connectionRevision;
    return () => ownsEndpoint() && latest.current.options.client === captured.client && captured.client.connectionRevision === connection && latest.current.options.status === 'connected'
      && latest.current.options.selectedSessionKey === captured.selectedSessionKey && latest.current.options.selectedSessionId === captured.selectedSessionId
      && captured.authority.current === authorityOwner && authorityOwner.owns(epoch);
  }, [ownsEndpoint]);
  useEffect(() => {
    if (!storageKey || loadedOwner === owner || !scene.isActive) return;
    let retired = false; const epoch = scene.capture();
    void loadValue(storageKey).then(payload => {
      if (retired || !ownsEndpoint() || !scene.owns(epoch)) return;
      owner.restore(payload); setLoadedOwner(owner); setStorageError(undefined); publish();
    }).catch(() => { if (!retired && ownsEndpoint() && scene.owns(epoch)) setStorageError('Queued-message status could not be loaded. Reconnect to check it.'); });
    return () => { retired = true; };
  }, [storageKey, loadedOwner, owner, scene, sceneRevision, status, ownsEndpoint, publish]);
  const persist = useCallback(async (owns: () => boolean, required = false) => {
    try { await persistence(owner.serialize(), owns); }
    catch (error) {
      if (ownsEndpoint() && authority.current.isActive) setStorageError('Queued-message status is not saved. Keep this conversation open.');
      if (required) throw error;
    }
  }, [authority, owner, ownsEndpoint, persistence]);
  useEffect(() => {
    if (loadedOwner !== owner || !scene.isActive) return;
    setBusyId(null);
    void persist(() => ownsEndpoint() && scene.owns(sceneRevision));
  }, [loadedOwner, owner, ownsEndpoint, persist, scene, sceneRevision]);
  const observe = useCallback((runId: string, receipt: Awaited<ReturnType<typeof readGatewayQueuedInput>>) => {
    if (receipt.state === 'unknown') { owner.update(runId, 'unknown', 'Queue status could not be confirmed. This message will not be resent automatically.'); return; }
    if (receipt.state === 'queued' && owner.get(runId)?.state === 'queued') return;
    owner.update(runId, receipt.state === 'interrupted' && receipt.reason === 'cancelled' ? 'cancelled' : receipt.state, undefined,
      receipt.state === 'consumed' ? receipt.consumedByEventId : undefined);
  }, [owner]);
  const refresh = useCallback(async () => {
    const current = latest.current.options;
    if (readBusy.current || loadedOwner !== owner || current.status !== 'connected' || !current.authority.current.isActive) return;
    const owns = capture(); const records = owner.pending(current.selectedSessionKey, current.selectedSessionId);
    if (!records.length) return;
    readBusy.current = true;
    try {
      for (const record of records.slice(0, 16)) {
        if (!owns()) return;
        try { const receipt = await readGatewayQueuedInput(current.client, record, current.messages); if (!owns()) return; observe(record.runId, receipt); }
        catch { if (owns()) owner.update(record.runId, 'unknown', 'Queue status is unavailable. This message will not be resent automatically.'); }
      }
      if (owns()) { publish(); await persist(owns); }
    } finally { readBusy.current = false; }
  }, [capture, loadedOwner, observe, owner, persist, publish]);
  useEffect(() => {
    if (loadedOwner !== owner || status !== 'connected' || !scene.isActive || !selectedSessionKey || !selectedSessionId) return;
    let retired = false; let timer: ReturnType<typeof setTimeout> | undefined;
    const epoch = scene.capture();
    const retire = () => { retired = true; if (timer) clearTimeout(timer); };
    const tick = async () => {
      if (retired || !scene.owns(epoch)) return;
      await refresh();
      if (!retired && scene.owns(epoch)) timer = setTimeout(() => { void tick(); }, REFRESH_MS);
    };
    scene.signal.addEventListener('abort', retire, { once: true }); void tick();
    return () => { retire(); scene.signal.removeEventListener('abort', retire); };
  }, [loadedOwner, owner, refresh, scene, sceneRevision, selectedSessionId, selectedSessionKey, status]);
  const prepare = useCallback(async (request: QueuedPromptPreparation) => {
    const current = latest.current.options; const owns = capture();
    if (!storageKey || loadedOwner !== owner || !owns() || request.sessionKey !== current.selectedSessionKey || request.sessionId !== current.selectedSessionId
      || current.runRegistry.current.runFor(request.sessionKey) !== request.predecessorRunId) throw new Error('This conversation changed before the message could be queued.');
    owner.prepare(request); publish();
    try { await persist(owns, true); }
    catch (error) { owner.rollbackPreparation(request.runId); publish(); throw error; }
    if (!owns() || current.runRegistry.current.runFor(request.sessionKey) !== request.predecessorRunId) {
      owner.rollbackPreparation(request.runId); publish();
      if (ownsEndpoint() && authority.current.isActive) await persist(() => ownsEndpoint() && authority.current.isActive);
      throw new Error('Queued-message submission retired before sending.');
    }
  }, [authority, capture, loadedOwner, owner, ownsEndpoint, persist, publish, storageKey]);
  const accepted = useCallback(async (runId: string, payload: unknown) => {
    if (!ownsEndpoint() || !authority.current.isActive) return;
    owner.update(runId, gatewayQueuedInputAck(payload, runId).state);
    publish(); void persist(capture()).then(() => refresh());
  }, [authority, capture, owner, ownsEndpoint, persist, publish, refresh]);
  const failed = useCallback(async (runId: string, error: unknown) => {
    if (!ownsEndpoint()) return;
    if (gatewayRequestWasRefused(error)) {
      owner.rollbackPreparation(runId); publish();
      if (authority.current.isActive) await persist(capture());
      return;
    }
    if (!authority.current.isActive) return;
    // A failed/lost transport acknowledgment does not prove that chat.send failed.
    owner.update(runId, 'unknown', 'Delivery is unconfirmed. Checking the saved queue; this message will not be resent automatically.');
    publish(); await persist(capture()); await refresh();
  }, [authority, capture, owner, ownsEndpoint, persist, publish, refresh]);
  const act = useCallback(async (runId: string, kind: 'cancel' | 'runNow') => {
    const current = latest.current.options; const record = owner.get(runId); const owns = capture();
    if (actionBusy.current || loadedOwner !== owner || !owns() || !record || record.sessionKey !== current.selectedSessionKey || record.sessionId !== current.selectedSessionId) return;
    if (kind === 'runNow' && current.runRegistry.current.stopWasConfirmed(record.sessionKey, record.predecessorRunId)) return;
    actionBusy.current = runId; setBusyId(runId);
    try {
      const receipt = await readGatewayQueuedInput(current.client, record, current.messages); if (!owns()) return;
      observe(runId, receipt);
      if (receipt.state !== 'queued') { owner.update(runId, 'unknown', 'This message is no longer confirmed in the queue. Check its status before taking action.'); return; }
      if (kind === 'cancel') {
        const result = await cancelGatewayQueuedInput({ request: (method, params) => {
          if (!owns()) return Promise.reject(new Error('Queue action retired.'));
          return current.client.request(method, params);
        } }, record);
        if (!owns()) return;
        owner.update(runId, result.state === 'cancelled' ? 'cancelled' : 'queued', result.state === 'cancelled' ? undefined : 'Cancellation is unconfirmed. This message has not been resent.');
      } else {
        if (current.runRegistry.current.runFor(record.sessionKey) !== record.predecessorRunId) { owner.update(runId, 'queued', 'The current task changed. Your message remains queued.'); return; }
        await requestGatewayStop({ abort: (sessionKey, runId) => current.client.request('chat.abort', { sessionKey, runId }) },
          current.runRegistry.current, record.sessionKey, record.predecessorRunId);
        if (!owns()) return;
        const confirmed = current.runRegistry.current.stopWasConfirmed(record.sessionKey, record.predecessorRunId);
        if (confirmed) current.onStopConfirmed?.(record.sessionKey);
        owner.update(runId, 'queued', confirmed ? undefined : 'Stop request is unconfirmed. Checking message pickup.');
        return confirmed;
      }
    } catch (error) {
      const actionFailure = kind !== 'cancel' ? 'The queue action is unconfirmed. Check status; this message will not be resent.'
        : error instanceof Error && (error as GatewayRequestFailure).gatewayCode === 'UNAVAILABLE'
          && error.message === 'Error: Queued input is already starting; refresh before removing it.'
          ? 'Cancel was refused: the Gateway reports this message is already starting. It has not been cancelled.'
          : 'Cancellation could not be confirmed. Check the message status before trying again.';
      if (owns()) { owner.update(runId, 'unknown'); owner.recordActionFailure(runId, actionFailure); }
    }
    finally {
      actionBusy.current = null;
      if (owns()) { setBusyId(null); publish(); await persist(owns); await refresh(); }
    }
  }, [capture, loadedOwner, observe, owner, persist, publish, refresh]);
  const interruptQueued = useCallback(async (scope: QueuedInterruptScope): Promise<QueuedInterruptResult> => {
    const current = latest.current.options; const owns = capture();
    const refused = { accepted: false, detail: 'No confirmed queued message belongs to the current task. Nothing was interrupted.' };
    if (loadedOwner !== owner || !owns() || actionBusy.current || scope.sessionKey !== current.selectedSessionKey
      || scope.sessionId !== current.selectedSessionId || !scope.predecessorRunId
      || current.runRegistry.current.runFor(scope.sessionKey) !== scope.predecessorRunId) return refused;
    // One predecessor stop releases the existing queue in its native order.
    // Never stop each queued identity or resend any stored prompt text.
    const candidates = () => owner.pending(scope.sessionKey, scope.sessionId)
      .filter(record => record.predecessorRunId === scope.predecessorRunId && ['queued', 'accepted', 'unknown'].includes(record.state))
      .sort((a, b) => a.createdAt - b.createdAt);
    if (!candidates().length) return refused;
    if (current.runRegistry.current.stopWasConfirmed(scope.sessionKey, scope.predecessorRunId)) {
      return { accepted: true, detail: 'Stop already accepted. Queued messages will run next in order.' };
    }
    // The accepted notice invites "interrupt" before the background status read
    // returns. Read exact custody now instead of refusing an admitted message.
    if (!candidates().some(record => record.state === 'queued')) {
      for (const record of candidates().slice(0, 16)) {
        if (!owns()) return refused;
        try { const receipt = await readGatewayQueuedInput(current.client, record, current.messages); if (owns()) observe(record.runId, receipt); }
        catch { /* Unread custody stays unconfirmed and authorizes nothing. */ }
      }
      if (!owns() || current.runRegistry.current.runFor(scope.sessionKey) !== scope.predecessorRunId) return refused;
      publish(); void persist(owns);
    }
    const first = candidates().find(record => record.state === 'queued');
    if (!first) return { accepted: false, detail: 'Your queued message is still being confirmed. Nothing was interrupted. Reply "interrupt" again in a moment.' };
    const confirmed = await act(first.runId, 'runNow');
    if (confirmed) return { accepted: true, detail: 'Stop accepted. Queued messages will run next in order.' };
    return { accepted: false, detail: 'The queued message or current task could not be confirmed for interruption. Check this conversation before trying again.' };
  }, [act, capture, loadedOwner, observe, owner, persist, publish]);
  const view = (message: WorkspaceMessage): QueuedPromptView | undefined => {
    const record = owner.view(message); if (!record) return;
    const current = latest.current.options;
    const eligible = loadedOwner === owner && current.status === 'connected' && current.authority.current.isActive
      && record.sessionKey === current.selectedSessionKey && record.sessionId === current.selectedSessionId && record.state === 'queued' && !busyId;
    const stopConfirmed = current.runRegistry.current.stopWasConfirmed(record.sessionKey, record.predecessorRunId);
    const detail = record.actionFailure ?? (record.state === 'queued' && stopConfirmed ? 'Stop request accepted. Checking message pickup.' : record.detail);
    return { ...record, ...(detail ? { detail } : {}),
      canCancel: eligible, canRunNow: eligible && !stopConfirmed && current.runRegistry.current.runFor(record.sessionKey) === record.predecessorRunId, busy: busyId === record.runId };
  };
  void revision;
  return { prepare, accepted, failed, interruptQueued, view, cancel: async (runId: string) => { await act(runId, 'cancel'); }, runNow: async (runId: string) => { await act(runId, 'runNow'); }, refresh, loaded: loadedOwner === owner, storageError };
}
