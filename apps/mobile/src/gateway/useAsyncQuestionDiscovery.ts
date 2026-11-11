import { useCallback, useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import type { WorkspaceMessage, WorkspaceProject } from '../workspace/workspaceTypes';
import type { OpenClawClient, GatewayStatus } from './OpenClawClient';
import type { HistoryPublicationAuthority } from './historyPublicationAuthority';
import { AsyncQuestionDiscovery } from './asyncQuestionDiscovery';

export function useAsyncQuestionDiscovery(client: OpenClawClient | undefined, status: GatewayStatus, endpoint: string,
  projects: WorkspaceProject[] | undefined, selectedSessionKey: string | undefined, authority: MutableRefObject<HistoryPublicationAuthority>, observe: (rows: WorkspaceMessage[]) => void) {
  const latest = useRef({ projects, observe, status, selectedSessionKey }); latest.current = { projects, observe, status, selectedSessionKey };
  const discovery = useMemo(() => new AsyncQuestionDiscovery(key => client!.history(key, 80, 0), rows => latest.current.observe(rows)), [client, endpoint]);
  const reconcile = useCallback(() => {
    if (!client || latest.current.status !== 'connected' || !authority.current.isActive) { discovery.retire(); return; }
    const scene = authority.current.capture(); const connection = client.connectionRevision;
    discovery.reconcile(latest.current.projects ?? [], { revision: JSON.stringify([scene, connection]), selectedSessionKey: latest.current.selectedSessionKey,
      owns: () => authority.current.owns(scene) && client.connectionRevision === connection && client.status === 'connected' });
  }, [authority, client, discovery]);
  const signal = authority.current.signal;
  useEffect(() => {
    reconcile();
    const retire = () => discovery.retire(); signal.addEventListener('abort', retire);
    return () => signal.removeEventListener('abort', retire);
  }, [discovery, projects, reconcile, selectedSessionKey, signal, status]);
  useEffect(() => () => discovery.retire(), [discovery]);
  return useMemo(() => ({ refresh: () => { discovery.retire(); reconcile(); }, retire: () => discovery.retire() }), [discovery, reconcile]);
}
