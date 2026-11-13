import { useMemo, type RefObject } from 'react';
import type { WorkspaceProject } from '../workspace/workspaceTypes';
import type { OpenClawClient } from './OpenClawClient';
import { createGatewayProjectImageResolver } from './gatewayProjectImage';

/** Publish authority changes to mounted images without reacting to activity clocks. */
export function useGatewayProjectImage(client: OpenClawClient, projects: RefObject<WorkspaceProject[]>) {
  const registryKey = JSON.stringify(projects.current.map(p => [p.id, p.sessionKey, p.kind, p.path, p.rootSessionKey, p.sessionId]).sort());
  const connection = client.imageConnectionKey;
  return useMemo(() => createGatewayProjectImageResolver(
    (id, path) => client.readProjectFile(id, path), () => projects.current, () => client.imageConnectionKey,
  ), [client, projects, registryKey, connection]);
}
