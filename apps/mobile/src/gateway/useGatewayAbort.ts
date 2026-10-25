import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { HistoryPublicationAuthority } from './historyPublicationAuthority';
import type { OpenClawClient } from './OpenClawClient';
import type { SessionRunRegistry } from './sessionRunRegistry';
import { requestGatewayStop } from './gatewayStopRequest';

export function useGatewayAbort(
  client: OpenClawClient,
  selectedRef: MutableRefObject<string>,
  runRegistry: MutableRefObject<SessionRunRegistry>,
  scenePublicationAuthority: MutableRefObject<HistoryPublicationAuthority>,
  setDetail: Dispatch<SetStateAction<string>>,
  publishSelectedRun: (sessionKey?: string) => void,
) {
  return useCallback(async () => {
    if (!selectedRef.current || client.status !== 'connected' || !scenePublicationAuthority.current.isActive) return;
    const activityRevision = scenePublicationAuthority.current.capture();
    const sessionKey = selectedRef.current;
    const selectedRun = runRegistry.current.runFor(sessionKey);
    if (!selectedRun) { setDetail('No active run belongs to this thread.'); publishSelectedRun(); return; }
    setDetail('requesting stop');
    try {
      const detail = await requestGatewayStop(client, runRegistry.current, sessionKey, selectedRun);
      if (scenePublicationAuthority.current.owns(activityRevision) && selectedRef.current === sessionKey && runRegistry.current.ownsRun(sessionKey, selectedRun)) {
        setDetail(detail); publishSelectedRun(sessionKey);
      }
    }
    catch (error) {
      if (scenePublicationAuthority.current.owns(activityRevision) && selectedRef.current === sessionKey && runRegistry.current.ownsRun(sessionKey, selectedRun)) {
        setDetail(error instanceof Error ? error.message : 'Stop result is unconfirmed.');
        throw error;
      }
    }
  }, [client, publishSelectedRun, runRegistry, scenePublicationAuthority, selectedRef, setDetail]);
}
