import type { ProjectFileEntry } from '../gateway/projectFiles';

export type ProjectFileSort = { field: 'modified' | 'name' | 'size' | 'type'; direction: 'asc' | 'desc' };
export const DEFAULT_FILE_SORT: ProjectFileSort = { field: 'modified', direction: 'desc' };
export const FILE_SORT_CHOICES = [
  { key: 'm', field: 'modified', direction: 'desc', label: 'Modified · newest first' },
  { key: 'n', field: 'name', direction: 'asc', label: 'Name · A–Z' },
  { key: 's', field: 'size', direction: 'desc', label: 'Size · largest first' },
  { key: 't', field: 'type', direction: 'asc', label: 'Type · folders first' },
] as const;

export function fileSortLabel(sort: ProjectFileSort) {
  const label = sort.field === 'modified' ? 'Modified' : sort.field === 'name' ? 'Name' : sort.field === 'size' ? 'Size' : 'Type';
  return `${label} ${sort.direction === 'desc' ? '↓' : '↑'}`;
}

export function compareProjectFiles(left: ProjectFileEntry, right: ProjectFileEntry, sort: ProjectFileSort) {
  const name = () => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }) || left.path.localeCompare(right.path);
  const kind = (entry: ProjectFileEntry) => entry.kind === 'directory' ? '' : (entry.name.match(/\.([^.]+)$/)?.[1] ?? entry.kind).toLocaleLowerCase();
  const primary = sort.field === 'modified' ? left.mtimeMs - right.mtimeMs
    : sort.field === 'size' ? left.size - right.size
      : sort.field === 'type' ? kind(left).localeCompare(kind(right)) : name();
  const kindOrder = (entry: ProjectFileEntry) => entry.kind === 'directory' ? 0 : entry.kind === 'text' ? 1 : 2;
  return primary * (sort.direction === 'desc' ? -1 : 1) || kindOrder(left) - kindOrder(right) || name();
}
