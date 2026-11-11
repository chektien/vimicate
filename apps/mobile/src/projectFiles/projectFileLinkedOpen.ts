import type { ProjectFileList } from '../gateway/projectFiles';
import { visibleProjectFileEntries } from './projectFileBrowserCore';
import type { ProjectFileSort } from './projectFileSort';

type Link = { path: string; line?: number };
/** Bind a repository-relative intent to the primary host before any file is admitted. */
export function projectFileLinkedOpen(list: ProjectFileList, link: Link | undefined, showHidden: boolean, sort: ProjectFileSort, redirected = false) {
  if (list.primaryRoot && (list.path || link)) {
    if (redirected) throw new Error('Repeated file root redirect');
    const prefix = (path: string) => `${list.primaryRoot}${path ? '/' + path : ''}`;
    return { kind: 'redirect' as const, path: prefix(list.path), link: link ? { ...link, path: prefix(link.path) } : undefined };
  }
  if (!link) return null;
  const entry = list.entries.find(candidate => candidate.path === link.path);
  if (!entry) return { kind: 'missing' as const };
  if (entry.kind === 'directory') return { kind: 'directory' as const, path: entry.path };
  const revealHidden = entry.name.startsWith('.');
  const visible = visibleProjectFileEntries(list.entries, revealHidden || showHidden, sort);
  return { kind: 'file' as const, revealHidden, index: visible.findIndex(candidate => candidate.path === link.path) };
}
