import type { WorkspaceProject } from '../workspace/workspaceTypes';
import { hardwareTextCharacter } from '../keyboard/hardwareKey';

export function findProjectSearchMatch(projects: WorkspaceProject[], query: string, currentKey: string, direction: 1 | -1) {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle || !projects.length) return currentKey;
  const start = Math.max(0, projects.findIndex((project) => project.sessionKey === currentKey));
  for (let offset = 1; offset <= projects.length; offset += 1) {
    const index = (start + direction * offset + projects.length) % projects.length;
    const project = projects[index];
    if (`${project?.name}\n${project?.path}\n${project?.branch}`.toLocaleLowerCase().includes(needle)) return project?.sessionKey ?? currentKey;
  }
  return currentKey;
}

export function findTextSearchMatch(text: string, query: string, cursor: number, direction: 1 | -1) {
  const needle = query.trim().toLocaleLowerCase();
  const source = text.toLocaleLowerCase();
  if (!needle) return cursor;
  if (!source) return null;
  if (direction === 1) {
    const after = source.indexOf(needle, Math.max(0, cursor + 1));
    if (after >= 0) return after;
    const wrapped = source.indexOf(needle);
    return wrapped >= 0 ? wrapped : null;
  }
  const before = cursor > 0 ? source.lastIndexOf(needle, cursor - 1) : -1;
  if (before >= 0) return before;
  const wrapped = source.lastIndexOf(needle);
  return wrapped >= 0 ? wrapped : null;
}

export function searchInputCharacter(key: string, shift: boolean) {
  return hardwareTextCharacter({ key, shift });
}

export function vimSearchDirectionForKey(key: string): 1 | -1 | null {
  return key === '/' ? 1 : key === '?' ? -1 : null;
}

export function repeatedVimSearchDirection(initial: 1 | -1, key: 'n' | 'N') {
  return key === 'n' ? initial : initial === 1 ? -1 : 1;
}
