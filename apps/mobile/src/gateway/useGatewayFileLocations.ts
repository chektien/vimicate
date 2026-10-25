import { useMemo } from 'react';
import type { OpenClawClient } from './OpenClawClient';
import { fileLocationFromPayload, locatedFileContentFromPayload, locatedFileListFromPayload, type LocatedFileRoot } from './locatedFiles';
import { readProjectFileForSharing, type ProjectFileShareInput } from './projectFileSharing';

export function useGatewayFileLocations(client: OpenClawClient) {
  return useMemo(() => ({
    resolveFileLocation: async (sourcePath: string, projectId?: string) => fileLocationFromPayload(
      await client.request('vimicate.files.resolve', { sourcePath, ...(projectId ? { projectId } : {}) }, 20000)),
    listLocatedFiles: async (root: LocatedFileRoot, path: string) => locatedFileListFromPayload(
      await client.request('vimicate.files.list', { location: root.location, projectId: root.projectId, path, includeUnsupported: true, includeDocuments: true }, 20000), root, path),
    readLocatedFile: async (root: LocatedFileRoot, path: string) => locatedFileContentFromPayload(
      await client.request('vimicate.files.read', { location: root.location, projectId: root.projectId, path, includeDocuments: true }, 20000), root, path),
    readLocatedFileForSharing: (root: Pick<LocatedFileRoot, 'location' | 'projectId'>, input: ProjectFileShareInput) =>
      readProjectFileForSharing(client.request.bind(client), root, input),
  }), [client]);
}
export type GatewayFileLocations = ReturnType<typeof useGatewayFileLocations>;
