import { projectFileContentFromPayload, projectFileListFromPayload } from './projectFiles';

export type FileLocation = 'project' | 'icloud-downloads' | 'assistant-artifacts';
export type LocatedFileRoot = { location: FileLocation; projectId: string; rootPath: string };
export type ResolvedFileLocation = LocatedFileRoot & { path: string };

function validRoot(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 4096
    && (value.startsWith('/') || value.startsWith('~/')) && !/[\\\0]/u.test(value)
    && !value.split('/').some(part => part === '..' || part === '.');
}
export function fileLocationFromPayload(value: unknown): ResolvedFileLocation {
  const p = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  if (p.schemaVersion !== 1 || !['project', 'icloud-downloads', 'assistant-artifacts'].includes(String(p.location))
    || !validRoot(p.rootPath)
    || p.location === 'icloud-downloads' && p.projectId !== 'shared-icloud-downloads'
    || p.location === 'assistant-artifacts' && p.projectId !== 'assistant-artifacts') throw new Error('Invalid file location response');
  // Reuse the bounded identity/path validator, including root directory links.
  const list = projectFileListFromPayload({ ...p, entries: [] });
  return { location: p.location as FileLocation, projectId: list.projectId, rootPath: p.rootPath, path: list.path };
}
function scopedPayload(value: unknown, root: LocatedFileRoot) {
  if (!value || typeof value !== 'object' || (value as Record<string, unknown>).location !== root.location) {
    throw new Error('Invalid file location response');
  }
  return value;
}
export function locatedFileListFromPayload(value: unknown, root: LocatedFileRoot, path: string) {
  return projectFileListFromPayload(scopedPayload(value, root), root.projectId, path);
}
export function locatedFileContentFromPayload(value: unknown, root: LocatedFileRoot, path: string) {
  return projectFileContentFromPayload(scopedPayload(value, root), root.projectId, path);
}
