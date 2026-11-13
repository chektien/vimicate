import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { QueuedPromptOptions } from './useGatewayQueuedPrompts';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { remoteQueuedInputScope as remoteScope } from './remoteQueuedInputScope';
import { readGatewayQueuedInput, type GatewayQueuedInputState } from './gatewayQueuedInput';

export type RemoteQueuedInputView = {
  readOnly: true; runId: string; sessionKey: string; sessionId: string;
  state: 'queued' | 'unknown' | 'consumed' | 'interrupted' | 'cancelled';
  predecessorRunId?: never; detail?: string; canCancel: false; canRunNow: false; busy: boolean;
};

/** Server custody is visible without inventing a local preparation or granting
 * mutation authority. Reads and their results retire with the exact scene. */
export function useRemoteQueuedInputs(options: QueuedPromptOptions, localRecord: (message: WorkspaceMessage) => unknown) {
  const latest = useRef({ options, localRecord }); latest.current = { options, localRecord };
  const [, publish] = useState(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const scene = options.authority.current; const epoch = scene.capture();
  const connectionRevision = options.client.connectionRevision;
  const owner = useMemo(() => ({ receipts: new Map<string, GatewayQueuedInputState>(), busy: false }),
    [options.endpoint, options.client, options.client.connectionRevision, options.status, options.selectedSessionKey, options.selectedSessionId, scene, epoch]);
  const currentOwner = useRef(owner); currentOwner.current = owner;
  const eligible = (message: WorkspaceMessage) => {
    const current = latest.current.options;
    return remoteScope(message) && message.sessionKey === current.selectedSessionKey
      && message.transcriptSessionId === current.selectedSessionId && !latest.current.localRecord(message);
  };
  const refresh = useCallback(async () => {
    const current = latest.current.options; const authority = current.authority.current; const revision = authority.capture();
    const connection = current.client.connectionRevision;
    const owns = () => mounted.current && currentOwner.current === owner && authority.owns(revision)
      && latest.current.options.status === 'connected' && latest.current.options.client === current.client
      && current.client.connectionRevision === connection;
    if (owner.busy || currentOwner.current !== owner || current.status !== 'connected' || !authority.owns(epoch)
      || current.client.connectionRevision !== connectionRevision) return;
    const rows = (current.messages ?? []).filter(eligible).slice(-16);
    if (!rows.length) return;
    const keys = new Set(rows.map(receiptKey));
    for (const key of owner.receipts.keys()) if (!keys.has(key)) owner.receipts.delete(key);
    owner.busy = true; publish(value => value + 1);
    try {
      for (const message of rows) {
        if (!owns()) return;
        const scope = remoteScope(message)!;
        let receipt: GatewayQueuedInputState;
        try { receipt = await readGatewayQueuedInput(current.client, scope, current.messages); }
        catch { receipt = { state: 'unknown' }; }
        if (!owns()) return;
        owner.receipts.set(receiptKey(message), receipt);
      }
    } finally {
      owner.busy = false;
      if (owns()) publish(value => value + 1);
    }
  }, [owner, epoch, connectionRevision]);
  const view = (message: WorkspaceMessage): RemoteQueuedInputView | undefined => {
    if (!eligible(message)) return;
    const scope = remoteScope(message)!;
    const connected = mounted.current && currentOwner.current === owner && options.status === 'connected'
      && scene.owns(epoch) && options.client.connectionRevision === connectionRevision;
    const receipt = connected ? owner.receipts.get(receiptKey(message)) : undefined;
    const state = !connected ? 'unknown' : receipt?.state === 'interrupted' && receipt.reason === 'cancelled' ? 'cancelled'
      : receipt?.state ?? 'unknown';
    return { ...scope, readOnly: true, state, canCancel: false, canRunNow: false, busy: owner.busy };
  };
  return { refresh, view };
}

function receiptKey(message: WorkspaceMessage) {
  return JSON.stringify([message.id, message.sessionKey, message.transcriptSessionId, message.inputReceiptRunId, message.inputPendingId ?? message.id]);
}
