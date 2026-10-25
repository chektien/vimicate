import { compareProjectFiles, DEFAULT_FILE_SORT, type ProjectFileSort } from './projectFileSort';
import type { HardwareKeyEvent } from '../../modules/vimicate-editor';
import type { ProjectFileEntry } from '../gateway/projectFiles';
import { normalizedHardwareKey } from '../keyboard/hardwareKey';
import type { TranscriptHandoffVariant } from '../transcript/transcriptVim';
import type { WorkspaceProject } from '../workspace/workspaceTypes';

export type FileListNavigation = { index: number; pending: '' | 'g'; count: string };
export type FileListEffect = 'none' | 'open' | 'close' | 'parent' | 'root' | 'refresh' | 'toggle-hidden' | 'toggle-help' | 'sort';

export function createFileListNavigation(): FileListNavigation { return { index: 0, pending: '', count: '' }; }

export function visibleProjectFileEntries(entries: readonly ProjectFileEntry[], showHidden: boolean, sort: ProjectFileSort = DEFAULT_FILE_SORT) {
  return entries.filter(entry => showHidden || !entry.name.startsWith('.')).sort((left, right) => compareProjectFiles(left, right, sort));
}

export function handleFileListKey(state: FileListNavigation, input: HardwareKeyEvent, entryCount: number): { state: FileListNavigation; effect: FileListEffect; handled: boolean } {
  const key = normalizedHardwareKey(input);
  const clean = (index = state.index): FileListNavigation => ({ index: clampIndex(index, entryCount), pending: '', count: '' });
  const noModifiers = !input.control && !input.command && !input.option;
  if (key === 'escape' || (input.control && input.key === '[') || (noModifiers && key === 'q')) return { state: clean(), effect: state.pending || state.count ? 'none' : 'close', handled: true };
  if (input.control && input.key.toLowerCase() === 'r') return { state: clean(), effect: 'refresh', handled: true };
  if (state.pending === 'g') {
    if (noModifiers && key === 'g') return { state: clean(state.count ? Number(state.count) - 1 : 0), effect: 'none', handled: true };
    if (noModifiers && key === '.') return { state: clean(), effect: 'toggle-hidden', handled: true };
    if (noModifiers && key === 's') return { state: clean(), effect: 'sort', handled: true };
    if (noModifiers && key === '?') return { state: clean(), effect: 'toggle-help', handled: true };
    return { state: clean(), effect: 'none', handled: true };
  }
  if (noModifiers && (/^[1-9]$/.test(key) || (key === '0' && state.count))) return { state: { ...state, count: `${state.count}${key}` }, effect: 'none', handled: true };
  const count = Math.max(1, Number(state.count || '1'));
  if (noModifiers && key === 'g') return { state: { ...state, pending: 'g' }, effect: 'none', handled: true };
  if (noModifiers && (key === 'j' || key === 'down')) return { state: clean(state.index + count), effect: 'none', handled: true };
  if (noModifiers && (key === 'k' || key === 'up')) return { state: clean(state.index - count), effect: 'none', handled: true };
  if (noModifiers && key === 'G') return { state: clean(state.count ? count - 1 : entryCount - 1), effect: 'none', handled: true };
  if (noModifiers && (key === 'enter' || key === 'tab' || key === 'l' || key === 'right')) return { state: clean(), effect: 'open', handled: true };
  if (noModifiers && (key === '-' || key === 'h' || key === 'left')) return { state: clean(), effect: 'parent', handled: true };
  if (input.control && ['f', 'b', 'd', 'u'].includes(key.toLowerCase())) {
    const delta = key === 'f' ? 10 : key === 'b' ? -10 : key === 'd' ? 5 : -5;
    return { state: clean(state.index + delta * count), effect: 'none', handled: true };
  }
  if (noModifiers && key === '_') return { state: clean(), effect: 'root', handled: true };
  // A focused file browser owns unrecognised keys. In particular, read-only
  // list commands such as d/c must never leak into the prompt editor.
  return { state: clean(), effect: 'none', handled: true };
}

export function parentProjectFilePath(path: string) {
  const parts = path.split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
}

export function owningProjectFilesId(project: WorkspaceProject | undefined, projects: readonly WorkspaceProject[]) {
  if (!project) return '';
  if (project.kind !== 'thread') return project.id;
  return projects.find((candidate) => candidate.kind !== 'thread' && candidate.sessionKey === project.rootSessionKey)?.id ?? '';
}

export function projectFileHandoff(source: string, path: string, line: number, column: number, variant: TranscriptHandoffVariant) {
  const lines = source.split('\n');
  const safeLine = Math.max(0, Math.min(lines.length - 1, line));
  const current = lines[safeLine] ?? '';
  const lineStart = lines.slice(0, safeLine).reduce((total, value) => total + value.length + 1, 0);
  const lineEnd = lineStart + current.length;
  const sourceCursor = Math.max(lineStart, Math.min(lineEnd, lineStart + column));
  let body = source;
  let caretInBody = sourceCursor;
  if (variant === 'a') caretInBody = Math.min(lineEnd, sourceCursor + 1);
  if (variant === 'I') caretInBody = lineStart + (current.match(/^\s*/)?.[0].length ?? 0);
  if (variant === 'A') caretInBody = lineEnd;
  if (variant === 'o') { body = `${source.slice(0, lineEnd)}\n${source.slice(lineEnd)}`; caretInBody = lineEnd + 1; }
  if (variant === 'O') { body = `${source.slice(0, lineStart)}\n${source.slice(lineStart)}`; caretInBody = lineStart; }
  const prefix = `Update this ${path} with these:\n\n`;
  return { text: prefix + body, caretOffset: prefix.length + caretInBody };
}

function clampIndex(index: number, count: number) { return count ? Math.max(0, Math.min(count - 1, index)) : 0; }

export function matchingFileIndex(entries: readonly ProjectFileEntry[], current: number, query: string, direction: 1 | -1) {
  for (let step = 1; step <= entries.length; step += 1) {
    const index = (current + direction * step + entries.length) % entries.length;
    if (entries[index]?.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())) return index;
  }
  return -1;
}
