import type { ModelChoice } from './modelMatching';
import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { HistoryPublicationAuthority } from './historyPublicationAuthority';
import { commandsFromPayload, type GatewayCommand } from './gatewayCommands';
import { modelCatalogEntriesFromPayload } from './modelCommandProjection';
import type { OpenClawClient } from './OpenClawClient';

/**
 * One connect-time owner for everything colon-command completion can offer:
 * the advertised command vocabulary and the configured provider/model catalog
 * its arguments are drawn from. A missing catalog is not a command-vocabulary
 * failure, so it never publishes a connection problem — the completion owner
 * states that truth at the moment Tab asks for a candidate.
 */
export function useGatewayCommands(
  client: OpenClawClient,
  scenePublicationAuthority: { current: HistoryPublicationAuthority },
  setCommands: Dispatch<SetStateAction<GatewayCommand[]>>,
  setModelChoices: Dispatch<SetStateAction<ModelChoice[]>>,
  setDetail: Dispatch<SetStateAction<string>>,
) {
  return useCallback(async () => {
    if (client.status !== 'connected' || !scenePublicationAuthority.current.isActive) return;
    const activityRevision = scenePublicationAuthority.current.capture();
    const [advertised, catalog] = await Promise.allSettled([client.listCommands(), client.listModels()]);
    if (!scenePublicationAuthority.current.owns(activityRevision)) return;
    if (advertised.status === 'fulfilled') setCommands(commandsFromPayload(advertised.value));
    else setDetail(advertised.reason instanceof Error ? advertised.reason.message : 'commands failed');
    setModelChoices(catalog.status === 'fulfilled' ? modelCatalogEntriesFromPayload(catalog.value) : []);
  }, [client, scenePublicationAuthority, setCommands, setDetail, setModelChoices]);
}
