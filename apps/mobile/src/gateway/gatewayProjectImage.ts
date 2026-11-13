import type { WorkspaceProject } from '../workspace/workspaceTypes';
import { owningProjectFilesId } from '../projectFiles/projectFileBrowserCore';
import { qualifiedProjectFilePath } from '../projectFiles/qualifiedProjectFilePath';
import type { ProjectFileContent } from './projectFiles';

export type GatewayProjectImageResolver = (path: string, sessionKey: string) => { cacheKey: string; load: (signal: AbortSignal) => Promise<{ uri: string }> };

/** Resolve from the attachment's originating thread, never the selected tab. */
export function createGatewayProjectImageResolver(
  read: (projectId: string, path: string, signal: AbortSignal) => Promise<ProjectFileContent>,
  projects: () => readonly WorkspaceProject[],
  connectionKey: () => string,
): GatewayProjectImageResolver {
  const binding = (sessionKey: string) => {
    const all = projects();
    const owners = all.filter(candidate => candidate.sessionKey === sessionKey);
    if (owners.length !== 1) throw new Error('Image thread unavailable');
    const owner = owners[0]!;
    const id = owningProjectFilesId(owner, all);
    const roots = all.filter(candidate => candidate.id === id && candidate.kind !== 'thread');
    if (!id || roots.length !== 1) throw new Error('Image project unavailable');
    return { id, stamp: JSON.stringify([id, roots[0]!.path, roots[0]!.sessionId, owner.sessionId, owner.rootSessionKey]) };
  };
  return (path, sessionKey) => {
    if (!qualifiedProjectFilePath(path) || /[\u0000-\u001f\u007f\\?#]/u.test(path)
      || path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid project image request');
    const origin = binding(sessionKey), connection = connectionKey();
    const current = (signal: AbortSignal) => {
      if (signal.aborted || connectionKey() !== connection || binding(sessionKey).stamp !== origin.stamp) throw new Error('Image request retired');
    };
    return { cacheKey: JSON.stringify([connection, origin.stamp, sessionKey, path]), load: async signal => {
      current(signal);
      const content = await read(origin.id, path, signal);
      current(signal);
      if (content.kind !== 'image' || content.projectId !== origin.id || content.path !== path) throw new Error('Invalid project image response');
      return { uri: `data:${content.mimeType};base64,${content.dataBase64}` };
    } };
  };
}
