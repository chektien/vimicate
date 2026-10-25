import { describe, expect, it } from 'vitest';
import type { ProjectFileEntry } from '../gateway/projectFiles';
import type { WorkspaceProject } from '../workspace/workspaceTypes';
import { createFileListNavigation, handleFileListKey, owningProjectFilesId, parentProjectFilePath, projectFileHandoff, visibleProjectFileEntries } from './projectFileBrowserCore';

const key = (value: string, overrides: Partial<{ shift: boolean; control: boolean; option: boolean; command: boolean }> = {}) => ({ key: value, shift: false, control: false, option: false, command: false, ...overrides });
const entry = (name: string, kind: ProjectFileEntry['kind'], mtimeMs: number): ProjectFileEntry => ({ name, path: name, kind, size: kind === 'directory' ? 0 : 20, mtimeMs, ...(kind === 'directory' ? {} : { mimeType: kind === 'text' ? 'text/plain' : 'image/png' }) });

describe('project file browser core', () => {
  it('shows hidden entries by default and sorts by mtime, then type and name', () => {
    const rows = [entry('z.md', 'text', 3), entry('.env', 'text', 5), entry('dir', 'directory', 3), entry('a.md', 'text', 3)];
    expect(visibleProjectFileEntries(rows, true).map(value => value.name)).toEqual(['.env', 'dir', 'a.md', 'z.md']);
    expect(visibleProjectFileEntries(rows, false).map(value => value.name)).toEqual(['dir', 'a.md', 'z.md']);
  });

  it('implements Oil navigation, capped parents, refresh, hidden and help chords', () => {
    let state = createFileListNavigation();
    state = handleFileListKey(state, key('j'), 4).state;
    expect(state.index).toBe(1);
    state = handleFileListKey(state, key('G'), 4).state;
    expect(state.index).toBe(3);
    state = handleFileListKey(state, key('g'), 4).state;
    expect(handleFileListKey(state, key('.'), 4).effect).toBe('toggle-hidden');
    state = handleFileListKey(createFileListNavigation(), key('g'), 4).state;
    expect(handleFileListKey(state, key('?'), 4).effect).toBe('toggle-help');
    expect(handleFileListKey(state, key('r', { control: true }), 4).effect).toBe('refresh');
    expect(handleFileListKey(state, key('d'), 4)).toMatchObject({ handled: true, effect: 'none' });
    expect(parentProjectFilePath('')).toBe('');
    expect(parentProjectFilePath('docs/design')).toBe('docs');
  });

  it('offers Oil gs sorting and selectable ascending/descending fields', () => {
    const prefix = handleFileListKey({ index: 2, pending: '', count: '' }, key('g'), 4).state;
    expect(handleFileListKey(prefix, key('s'), 4)).toMatchObject({ state: { index: 2, pending: '', count: '' }, effect: 'sort' });
    const rows = [entry('z.md', 'text', 3), { ...entry('a.md', 'text', 5), size: 10 }, entry('dir', 'directory', 4)];
    expect(visibleProjectFileEntries(rows, true, { field: 'name', direction: 'asc' }).map(row => row.name)).toEqual(['a.md', 'dir', 'z.md']);
    expect(visibleProjectFileEntries(rows, true, { field: 'size', direction: 'desc' }).map(row => row.name)).toEqual(['z.md', 'a.md', 'dir']);
    expect(visibleProjectFileEntries(rows, true, { field: 'modified', direction: 'asc' }).map(row => row.name)).toEqual(['z.md', 'dir', 'a.md']);
    expect(rows.map(row => row.name)).toEqual(['z.md', 'a.md', 'dir']);
  });

  it('resolves a thread to its trusted registry root id', () => {
    const root = { id: 'notes', sessionKey: 'root', name: 'Notes', path: '/private', branch: 'main', starred: false, threadCount: 2, state: 'idle', kind: 'project' } satisfies WorkspaceProject;
    const thread = { ...root, id: 'thread-id', sessionKey: 'thread', kind: 'thread', rootSessionKey: 'root' } satisfies WorkspaceProject;
    expect(owningProjectFilesId(thread, [root, thread])).toBe('notes');
    expect(owningProjectFilesId({ ...thread, rootSessionKey: 'missing' }, [root])).toBe('');
  });

  it('composes each Vim insertion variant around complete raw Markdown source', () => {
    const source = '# Title\n  item';
    expect(projectFileHandoff(source, 'docs/plan.md', 1, 2, 'i')).toEqual({ text: `Update this docs/plan.md with these:\n\n${source}`, caretOffset: 48 });
    expect(projectFileHandoff(source, 'docs/plan.md', 1, 0, 'I').caretOffset).toBe(48);
    expect(projectFileHandoff(source, 'docs/plan.md', 1, 2, 'a').caretOffset).toBe(49);
    expect(projectFileHandoff(source, 'docs/plan.md', 0, 0, 'A').caretOffset).toBe(45);
    expect(projectFileHandoff(source, 'docs/plan.md', 0, 0, 'o').text).toContain('# Title\n\n  item');
    expect(projectFileHandoff(source, 'docs/plan.md', 0, 0, 'o').caretOffset).toBe(46);
    expect(projectFileHandoff(source, 'docs/plan.md', 1, 0, 'O').text).toContain('# Title\n\n  item');
    expect(projectFileHandoff(source, 'docs/plan.md', 1, 0, 'O').caretOffset).toBe(46);
  });
});
