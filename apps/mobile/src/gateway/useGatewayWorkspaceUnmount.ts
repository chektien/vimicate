import { useEffect, useRef, type MutableRefObject } from 'react';
import { setWorkspacePersistenceActive } from '../storage/workspaceStore';
import { mediaScenePublicationAuthority } from '../transcript/mediaScenePublicationAuthority';
import type { GatewayRefreshBatch } from './gatewayRefreshBatch';
import type { OpenClawClient } from './OpenClawClient';
import type { HistoryPublicationAuthority } from './historyPublicationAuthority';
import { suspendLiveMessagePublication, type LiveMessagePublicationBuffer, type LiveMessagePublicationTimers } from './liveMessagePublication';
import type { ProjectRegistryRetryOwner } from '../workspace/projectRegistryRetry';

type Timer = ReturnType<typeof setTimeout>;

type Dependencies = {
  client: OpenClawClient;
  scenePublicationAuthority: MutableRefObject<HistoryPublicationAuthority>;
  reconnectEnabled: MutableRefObject<boolean>;
  registryRetryOwner: MutableRefObject<ProjectRegistryRetryOwner>;
  refreshBatch: MutableRefObject<GatewayRefreshBatch>;
  reconnectTimer: MutableRefObject<Timer | null>;
  livePublicationTimers: MutableRefObject<LiveMessagePublicationTimers>;
  narrationRefreshTimers: MutableRefObject<LiveMessagePublicationTimers>;
  pendingLiveMessages: MutableRefObject<LiveMessagePublicationBuffer>;
  suspendHistoryPublication: () => void;
};

/** Retires durable Gateway owners only when the workspace hook truly unmounts. */
export function useGatewayWorkspaceUnmount(dependencies: Dependencies) {
  const latestSuspendHistory = useRef(dependencies.suspendHistoryPublication);
  latestSuspendHistory.current = dependencies.suspendHistoryPublication;
  useEffect(() => () => {
    setWorkspacePersistenceActive(false);
    dependencies.scenePublicationAuthority.current.suspend();
    dependencies.reconnectEnabled.current = false;
    dependencies.registryRetryOwner.current.suspend();
    dependencies.refreshBatch.current.clear();
    latestSuspendHistory.current();
    mediaScenePublicationAuthority.suspend();
    suspendLiveMessagePublication(dependencies.livePublicationTimers.current, dependencies.narrationRefreshTimers.current, dependencies.pendingLiveMessages.current);
    if (dependencies.reconnectTimer.current) clearTimeout(dependencies.reconnectTimer.current);
    dependencies.reconnectTimer.current = null;
    dependencies.client.disconnect();
  }, [dependencies.client, dependencies.livePublicationTimers, dependencies.narrationRefreshTimers, dependencies.pendingLiveMessages, dependencies.reconnectEnabled, dependencies.reconnectTimer, dependencies.refreshBatch, dependencies.registryRetryOwner, dependencies.scenePublicationAuthority]);
}
