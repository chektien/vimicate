// @vitest-environment jsdom
import React, { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectFileContent, ProjectFileList } from '../gateway/projectFiles';
import type { ProjectFilesPort } from './projectFilesTypes';
import { PROJECT_FILE_PREVIEW_MAX_CHARACTERS, PROJECT_FILE_PREVIEW_MAX_LINES, boundedProjectFilePreviewSource, type ProjectFilesController, useProjectFilesController } from './useProjectFilesController';

const probe = { current: null as ProjectFilesController | null };
const callbacks = { status: vi.fn(), yank: vi.fn(), handoff: vi.fn(), close: vi.fn() };
const markdownList: ProjectFileList = { projectId: 'notes', path: '', entries: [{ name: 'plan.md', path: 'plan.md', kind: 'text', mimeType: 'text/markdown', size: 23, mtimeMs: 3 }] };
const markdown: ProjectFileContent = { projectId: 'notes', path: 'plan.md', kind: 'text', mimeType: 'text/markdown', size: 23, mtimeMs: 3, text: '# Plan\n- first\n- second' };
const hardware = (key: string) => ({ key, shift: false, control: false, option: false, command: false });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((next, fail) => { resolve = next; reject = fail; });
  return { promise, resolve, reject };
}

function Harness({ projectId, scopeKey, port, closeOnHandoff = false, onHandoff = callbacks.handoff }: { projectId: string; scopeKey?: string; port: ProjectFilesPort; closeOnHandoff?: boolean; onHandoff?: (payload: { text: string; caretOffset: number; path: string }) => void }) {
  const controller = useProjectFilesController({ projectId, ...(scopeKey ? { scopeKey } : {}), port, closeOnHandoff, onStatus: callbacks.status, onYank: callbacks.yank, onHandoff, onClose: callbacks.close });
  useLayoutEffect(() => { probe.current = controller; });
  return null;
}

let root: Root; let container: HTMLDivElement;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); Object.values(callbacks).forEach(value => value.mockClear()); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); probe.current = null; });
async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }

describe('project file controller', () => {
  it('uses gs to sort while retaining the selected file and lets Escape dismiss only sorting', async () => {
    const entries = [{ ...markdownList.entries[0]!, name: 'z.md', path: 'z.md', mtimeMs: 3 },
      { ...markdownList.entries[0]!, name: 'a.md', path: 'a.md', mtimeMs: 1 }];
    const port: ProjectFilesPort = { listDirectory: async () => ({ ...markdownList, entries }),
      readFile: async ({ path }) => ({ ...markdown, path }) };
    await act(async () => root.render(<Harness projectId="notes" port={port} />));
    act(() => probe.current!.openBrowser()); await flush();
    expect(probe.current!.entries.map(row => row.path)).toEqual(['z.md', 'a.md']);
    for (const key of ['g', 's']) act(() => probe.current!.handleKey(hardware(key)));
    expect(probe.current!.sorting.visible).toBe(true);
    act(() => probe.current!.handleKey(hardware('n'))); await flush();
    expect(probe.current!.entries.map(row => row.path)).toEqual(['a.md', 'z.md']);
    expect(probe.current!.selectedEntry?.path).toBe('z.md');
    expect(probe.current!.selectedIndex).toBe(1);
    expect(probe.current!.content?.path).toBe('z.md');
    for (const key of ['g', 's', 'r']) act(() => probe.current!.handleKey(hardware(key)));
    expect(probe.current!.entries.map(row => row.path)).toEqual(['z.md', 'a.md']);
    for (const key of ['g', 's', 'escape']) act(() => probe.current!.handleKey(hardware(key)));
    expect(probe.current!.sorting.visible).toBe(false);
    expect(probe.current!.open).toBe(true);
    act(() => probe.current!.refresh()); await flush();
    expect(probe.current!.sorting.order).toEqual({ field: 'name', direction: 'desc' });
    act(() => probe.current!.close()); act(() => probe.current!.openBrowser()); await flush();
    expect(probe.current!.sorting.visible).toBe(false);
    expect(probe.current!.entries.map(row => row.path)).toEqual(['z.md', 'a.md']);
    expect(callbacks.handoff).not.toHaveBeenCalled();
  });

  it('restores each file cursor and backward search independently within one thread, while explicit lines win', async () => {
    const texts: Record<string, string> = { 'a.txt': 'alpha one\nother\nalpha two\nlast', 'b.txt': 'beta one\nother\nbeta two\nlast' };
    const port: ProjectFilesPort = {
      listDirectory: async ({ projectId, path }) => ({ projectId, path, entries: Object.keys(texts).map((name) => ({ name, path: name, kind: 'text' as const, mimeType: 'text/plain', size: texts[name]!.length, mtimeMs: 1 })) }),
      readFile: async ({ projectId, path }) => ({ projectId, path, kind: 'text', mimeType: 'text/plain', size: texts[path]!.length, mtimeMs: 1, text: texts[path]! }),
    };
    await act(async () => root.render(<Harness projectId="notes" scopeKey="a" port={port} />));
    act(() => probe.current!.openBrowser()); await flush();
    act(() => probe.current!.openEntry(0));
    for (const key of ['G', '?', 'a', 'l', 'p', 'h', 'a', 'enter', 'l']) act(() => probe.current!.handleKey(hardware(key)));
    expect(probe.current!.previewNavigation.cursor).toEqual({ row: 2, column: 1 });
    act(() => probe.current!.openEntry(1)); await flush();
    expect(probe.current!.previewNavigation.cursor).toEqual({ row: 0, column: 0 });
    for (const key of ['G', '?', 'b', 'e', 't', 'a', 'enter']) act(() => probe.current!.handleKey(hardware(key)));
    act(() => probe.current!.openEntry(0)); await flush();
    expect(probe.current!.previewNavigation.cursor).toEqual({ row: 2, column: 1 });
    act(() => probe.current!.handleKey(hardware('n')));
    expect(probe.current!.previewNavigation.cursor).toEqual({ row: 2, column: 0 });
    act(() => probe.current!.handleKey(hardware('n')));
    expect(probe.current!.previewNavigation.cursor.row).toBe(0);
    act(() => probe.current!.openEntry(1)); await flush();
    expect(probe.current!.previewNavigation.cursor.row).toBe(2);
    act(() => probe.current!.handleKey(hardware('n')));
    expect(probe.current!.previewNavigation.cursor.row).toBe(0);
    act(() => probe.current!.openFilePath('a.txt', 4)); await flush();
    expect(probe.current!.previewNavigation.cursor).toEqual({ row: 3, column: 0 });
    await act(async () => root.render(<Harness projectId="notes" scopeKey="b" port={port} />));
    act(() => probe.current!.openEntry(1)); await flush();
    expect(probe.current!.previewNavigation.cursor.row).toBe(0);
    expect(callbacks.handoff).not.toHaveBeenCalled();
  });

  it('moves through words on every preview source line without jumping to the file end', async () => {
    const source = { ...markdown, text: 'alpha beta\ngamma delta\nepsilon zeta' };
    const port: ProjectFilesPort = { listDirectory: async () => markdownList, readFile: async () => source };
    await act(async () => root.render(<Harness projectId="notes" port={port} />));
    act(() => probe.current!.openBrowser()); await flush();
    act(() => probe.current!.handleKey(hardware('enter')));
    const positions: Array<[number, number]> = [];
    for (const key of ['w', 'w', 'w', 'w', 'w', 'b', 'e', '2', 'w']) {
      act(() => probe.current!.handleKey(hardware(key)));
      if (key !== '2') positions.push([probe.current!.previewNavigation.cursor.row, probe.current!.previewNavigation.cursor.column]);
    }
    expect(positions).toEqual([[0, 6], [1, 0], [1, 6], [2, 0], [2, 8], [2, 0], [2, 6], [2, 12]]);
    expect(probe.current!.content).toMatchObject({ text: 'alpha beta\ngamma delta\nepsilon zeta' });
    expect(callbacks.handoff).not.toHaveBeenCalled();
  });

  it('distinguishes punctuation-delimited w/b/e from whitespace-delimited W/B/E', async () => {
    const source = { ...markdown, text: 'one,two three\nfour-five six' };
    const port: ProjectFilesPort = { listDirectory: async () => markdownList, readFile: async () => source };
    await act(async () => root.render(<Harness projectId="notes" port={port} />));
    act(() => probe.current!.openBrowser()); await flush();
    act(() => probe.current!.handleKey(hardware('enter')));
    act(() => probe.current!.handleKey(hardware('w')));
    expect(probe.current!.previewNavigation.cursor).toEqual({ row: 0, column: 3 });
    act(() => probe.current!.handleKey(hardware('b')));
    expect(probe.current!.previewNavigation.cursor).toEqual({ row: 0, column: 0 });
    act(() => probe.current!.handleKey(hardware('E')));
    expect(probe.current!.previewNavigation.cursor).toEqual({ row: 0, column: 6 });
    act(() => probe.current!.handleKey(hardware('W')));
    expect(probe.current!.previewNavigation.cursor).toEqual({ row: 0, column: 8 });
    act(() => probe.current!.handleKey(hardware('B')));
    expect(probe.current!.previewNavigation.cursor).toEqual({ row: 0, column: 0 });
    for (const key of ['2', 'W']) act(() => probe.current!.handleKey(hardware(key)));
    expect(probe.current!.previewNavigation.cursor).toEqual({ row: 1, column: 0 });
    expect(probe.current!.content).toMatchObject({ text: source.text });
  });

  it('restores each thread file and preview position after switching away and back', async () => {
    const entries = [markdownList.entries[0]!, { name: 'other.md', path: 'other.md', kind: 'text' as const, mimeType: 'text/markdown', size: 25, mtimeMs: 2 }];
    const port: ProjectFilesPort = {
      listDirectory: async ({ projectId, path }) => ({ projectId, path, entries }),
      readFile: async ({ projectId, path }) => ({ projectId, path, kind: 'text', mimeType: 'text/markdown', size: 25, mtimeMs: 2, text: 'alpha beta\ngamma delta' }),
    };
    await act(async () => root.render(<Harness projectId="notes" scopeKey="thread-a" port={port} />));
    act(() => probe.current!.openBrowser()); await flush();
    act(() => probe.current!.openEntry(1)); await flush();
    act(() => probe.current!.handleKey(hardware('w')));
    act(() => probe.current!.handleKey(hardware('w')));
    expect(probe.current).toMatchObject({ selectedEntry: expect.objectContaining({ path: 'other.md' }), region: 'preview' });
    expect(probe.current!.previewNavigation.cursor).toEqual({ row: 1, column: 0 });

    await act(async () => root.render(<Harness projectId="notes" scopeKey="thread-b" port={port} />));
    act(() => probe.current!.openEntry(0)); await flush();
    expect(probe.current!.selectedEntry?.path).toBe('plan.md');
    await act(async () => root.render(<Harness projectId="notes" scopeKey="thread-a" port={port} />));
    await flush();
    expect(probe.current!.selectedEntry?.path).toBe('other.md');
    expect(probe.current!.region).toBe('preview');
    expect(probe.current!.content?.path).toBe('other.md');
    expect(probe.current!.previewNavigation.cursor).toEqual({ row: 1, column: 0 });
  });

  it('restores a project selection after visiting another root and ignores its late preview', async () => {
    const late = deferred<ProjectFileContent>();
    const notesEntries = [markdownList.entries[0]!, { name: 'other.md', path: 'other.md', kind: 'text' as const, mimeType: 'text/plain', size: 9, mtimeMs: 2 }];
    const port: ProjectFilesPort = {
      listDirectory: async ({ projectId, path }) => ({ projectId, path, entries: projectId === 'notes' ? notesEntries : [{ name: 'fresh.txt', path: 'fresh.txt', kind: 'text', mimeType: 'text/plain', size: 9, mtimeMs: 1 }] }),
      readFile: ({ projectId, path }) => projectId === 'elsewhere' ? late.promise : Promise.resolve({ projectId, path, kind: 'text', mimeType: 'text/plain', size: 9, mtimeMs: 1, text: 'first\nsecond' }),
    };
    await act(async () => root.render(<Harness projectId="notes" scopeKey="a" port={port} />));
    act(() => probe.current!.openBrowser()); await flush();
    act(() => probe.current!.openEntry(1)); await flush();
    act(() => probe.current!.handleKey(hardware('j')));
    await act(async () => root.render(<Harness projectId="elsewhere" scopeKey="b" port={port} />));
    await flush();
    expect(probe.current!.selectedEntry?.path).toBe('fresh.txt');
    await act(async () => root.render(<Harness projectId="notes" scopeKey="a" port={port} />));
    await flush();
    await act(async () => late.resolve({ projectId: 'elsewhere', path: 'fresh.txt', kind: 'text', mimeType: 'text/plain', size: 9, mtimeMs: 1, text: 'wrong project' }));
    expect(probe.current!.selectedEntry?.path).toBe('other.md');
    expect(probe.current!.content).toMatchObject({ projectId: 'notes', path: 'other.md' });
    expect(probe.current!.previewNavigation.cursor.row).toBe(1);
    expect(callbacks.close).not.toHaveBeenCalled();
  });

  it('does not silently substitute a neighbour when a saved file disappears before return', async () => {
    let includeSaved = true;
    const entries = [markdownList.entries[0]!, { name: 'other.md', path: 'other.md', kind: 'text' as const, mimeType: 'text/plain', size: 9, mtimeMs: 2 }];
    const port: ProjectFilesPort = {
      listDirectory: async ({ projectId, path }) => ({ projectId, path, entries: projectId === 'notes' ? includeSaved ? entries : entries.slice(0, 1) : entries.slice(0, 1) }),
      readFile: async ({ projectId, path }) => ({ projectId, path, kind: 'text', mimeType: 'text/plain', size: 9, mtimeMs: 1, text: 'alpha\nbeta' }),
    };
    await act(async () => root.render(<Harness projectId="notes" scopeKey="a" port={port} />));
    act(() => probe.current!.openBrowser()); await flush();
    act(() => probe.current!.openEntry(1)); await flush();
    await act(async () => root.render(<Harness projectId="elsewhere" scopeKey="b" port={port} />));
    await flush(); includeSaved = false;
    await act(async () => root.render(<Harness projectId="notes" scopeKey="a" port={port} />));
    await flush();
    expect(probe.current).toMatchObject({ open: true, selectedIndex: -1, selectedEntry: null, content: null, region: 'list' });
    expect(probe.current!.previewNavigation.cursor.row).toBe(0);
  });

  it('renders retained same-scope text during a pending read, blocks actions, then accepts changed bytes with unchanged metadata', async () => {
    const pending = deferred<ProjectFileContent>();
    const initial = { ...markdown, text: 'old\nsecond\nthird' };
    const updated = { ...initial, text: 'new\nsecond' };
    const readFile = vi.fn().mockResolvedValueOnce(initial).mockResolvedValueOnce(initial).mockImplementationOnce(() => pending.promise);
    const port: ProjectFilesPort = { listDirectory: async () => markdownList, readFile };
    await act(async () => root.render(<Harness projectId="notes" scopeKey="a" port={port} />));
    act(() => probe.current!.openBrowser()); await flush();
    act(() => probe.current!.handleKey(hardware('enter')));
    act(() => probe.current!.handleKey(hardware('j')));
    expect(probe.current!.previewNavigation.cursor.row).toBe(1);
    await act(async () => root.render(<Harness projectId="notes" scopeKey="b" port={port} />));
    await act(async () => root.render(<Harness projectId="notes" scopeKey="a" port={port} />)); await flush();
    expect(probe.current).toMatchObject({ previewPhase: 'loading', content: expect.objectContaining({ text: initial.text }) });
    expect(probe.current!.previewNavigation.cursor.row).toBe(1);
    for (const key of ['j', 'y', 'y', 'i', '/', 'n', 'e', 'w', 'enter']) act(() => probe.current!.handleKey(hardware(key)));
    expect(probe.current!.previewNavigation.cursor.row).toBe(1);
    expect(callbacks.yank).not.toHaveBeenCalled();
    expect(callbacks.handoff).not.toHaveBeenCalled();
    expect(probe.current!.previewNavigation.searchQuery).not.toBe('new');
    await act(async () => pending.resolve(updated));
    expect(probe.current).toMatchObject({ previewPhase: 'ready', content: expect.objectContaining({ text: updated.text }) });
    expect(probe.current!.previewNavigation.cursor.row).toBe(1);
    expect(readFile).toHaveBeenCalledTimes(3);
  });

  it('drops a retained preview when revalidation fails', async () => {
    const pending = deferred<ProjectFileContent>();
    const readFile = vi.fn().mockResolvedValueOnce(markdown).mockResolvedValueOnce(markdown).mockImplementationOnce(() => pending.promise);
    const port: ProjectFilesPort = { listDirectory: async () => markdownList, readFile };
    await act(async () => root.render(<Harness projectId="notes" scopeKey="a" port={port} />));
    act(() => probe.current!.openBrowser()); await flush();
    act(() => probe.current!.handleKey(hardware('enter')));
    await act(async () => root.render(<Harness projectId="notes" scopeKey="b" port={port} />));
    await act(async () => root.render(<Harness projectId="notes" scopeKey="a" port={port} />)); await flush();
    expect(probe.current?.content?.path).toBe('plan.md');
    await act(async () => { pending.reject(new Error('Read failed')); });
    expect(probe.current).toMatchObject({ previewPhase: 'error', previewProblem: 'Read failed', content: null });
  });

  it('does not leave retained content checking forever on mismatched list or read identity', async () => {
    const badList: ProjectFileList = { ...markdownList, path: 'wrong' };
    const listDirectory = vi.fn().mockResolvedValueOnce(markdownList).mockResolvedValueOnce(markdownList).mockResolvedValueOnce(badList);
    const readFile = vi.fn().mockResolvedValue(markdown);
    const port: ProjectFilesPort = { listDirectory, readFile };
    await act(async () => root.render(<Harness projectId="notes" scopeKey="a" port={port} />));
    act(() => probe.current!.openBrowser()); await flush();
    act(() => probe.current!.handleKey(hardware('enter')));
    await act(async () => root.render(<Harness projectId="notes" scopeKey="b" port={port} />));
    await act(async () => root.render(<Harness projectId="notes" scopeKey="a" port={port} />)); await flush();
    expect(probe.current).toMatchObject({ phase: 'error', content: null });
    expect(probe.current!.problem).toContain('Invalid project file list');
    listDirectory.mockResolvedValue(markdownList);
    readFile.mockResolvedValue({ ...markdown, path: 'wrong' });
    act(() => probe.current!.refresh()); await flush();
    expect(probe.current).toMatchObject({ previewPhase: 'error', content: null });
    expect(probe.current!.previewProblem).toContain('Invalid project file response');
  });

  it('searches backward with ? and repeats in the chosen direction while Escape cancels only the command line', async () => {
    const source = { ...markdown, text: 'target one\nspacer\ntarget two\nspacer\ntarget three' };
    const port: ProjectFilesPort = { listDirectory: async () => markdownList, readFile: async () => source };
    await act(async () => root.render(<Harness projectId="notes" port={port} />));
    act(() => probe.current!.openBrowser()); await flush();
    act(() => probe.current!.handleKey(hardware('enter')));
    act(() => probe.current!.handleKey(hardware('G')));
    for (const key of ['?', 't', 'a', 'r', 'g', 'e', 't', 'enter']) act(() => probe.current!.handleKey(hardware(key)));
    expect(probe.current!.previewNavigation.cursor).toEqual({ row: 2, column: 0 });
    act(() => probe.current!.handleKey(hardware('n')));
    expect(probe.current!.previewNavigation.cursor).toEqual({ row: 0, column: 0 });
    act(() => probe.current!.handleKey(hardware('N')));
    expect(probe.current!.previewNavigation.cursor).toEqual({ row: 2, column: 0 });
    act(() => probe.current!.handleKey(hardware('/')));
    act(() => probe.current!.handleKey(hardware('z')));
    act(() => probe.current!.handleKey({ ...hardware('['), control: true }));
    expect(probe.current).toMatchObject({ open: true, searchQuery: null, region: 'preview' });
    expect(probe.current!.previewNavigation.cursor).toEqual({ row: 2, column: 0 });
    act(() => probe.current!.handleKey(hardware('n')));
    expect(probe.current!.previewNavigation.cursor).toEqual({ row: 0, column: 0 });
  });

  it('restores the matching thread search for n after another thread searches a different file', async () => {
    const entries = [markdownList.entries[0]!, { name: 'other.md', path: 'other.md', kind: 'text' as const, mimeType: 'text/plain', size: 20, mtimeMs: 2 }];
    const port: ProjectFilesPort = {
      listDirectory: async ({ projectId, path }) => ({ projectId, path, entries }),
      readFile: async ({ projectId, path }) => ({ projectId, path, kind: 'text', mimeType: 'text/plain', size: 20, mtimeMs: 1,
        text: path === 'plan.md' ? 'alpha one\nalpha two\nalpha three' : 'beta one\nbeta two\nbeta three' }),
    };
    await act(async () => root.render(<Harness projectId="notes" scopeKey="a" port={port} />));
    act(() => probe.current!.openBrowser()); await flush();
    act(() => probe.current!.openEntry(0)); await flush();
    for (const key of ['/', 'a', 'l', 'p', 'h', 'a', 'enter']) act(() => probe.current!.handleKey(hardware(key)));
    expect(probe.current!.previewNavigation.cursor.row).toBe(1);

    await act(async () => root.render(<Harness projectId="notes" scopeKey="b" port={port} />));
    act(() => probe.current!.openEntry(1)); await flush();
    for (const key of ['/', 'b', 'e', 't', 'a', 'enter']) act(() => probe.current!.handleKey(hardware(key)));
    expect(probe.current!.previewNavigation.cursor.row).toBe(1);

    await act(async () => root.render(<Harness projectId="notes" scopeKey="a" port={port} />)); await flush();
    expect(probe.current!.previewNavigation.searchQuery).toBe('alpha');
    act(() => probe.current!.handleKey(hardware('n')));
    expect(probe.current!.previewNavigation.cursor.row).toBe(2);
  });

  it('does not search stale preview content while a scope read is being revalidated', async () => {
    const pending = deferred<ProjectFileContent>();
    const readFile = vi.fn().mockResolvedValueOnce({ ...markdown, text: 'old\nneedle\nneedle' }).mockImplementationOnce(() => pending.promise);
    const port: ProjectFilesPort = { listDirectory: async () => markdownList, readFile };
    await act(async () => root.render(<Harness projectId="notes" scopeKey="a" port={port} />));
    act(() => probe.current!.openBrowser()); await flush();
    act(() => probe.current!.openEntry(0));
    await act(async () => root.render(<Harness projectId="notes" scopeKey="b" port={port} />));
    for (const key of ['/', 'n', 'e', 'e', 'd', 'l', 'e', 'enter']) act(() => probe.current!.handleKey(hardware(key)));
    expect(probe.current!.previewNavigation.cursor.row).toBe(0);
    expect(probe.current!.previewNavigation.searchQuery).not.toBe('needle');
    await act(async () => pending.resolve({ ...markdown, text: 'new\nneedle\nneedle' }));
    expect(probe.current!.previewNavigation.cursor.row).toBe(0);
  });

  it('keeps counted line, document, page, visual and yank motions in the read-only preview', async () => {
    const source = { ...markdown, text: Array.from({ length: 25 }, (_, row) => `row${row} word`).join('\n') };
    const port: ProjectFilesPort = { listDirectory: async () => markdownList, readFile: async () => source };
    await act(async () => root.render(<Harness projectId="notes" port={port} />));
    act(() => probe.current!.openBrowser()); await flush();
    act(() => probe.current!.handleKey(hardware('enter')));
    for (const key of ['2', 'j']) act(() => probe.current!.handleKey(hardware(key)));
    expect(probe.current!.previewNavigation.cursor).toEqual({ row: 2, column: 0 });
    act(() => probe.current!.handleKey(hardware('$')));
    expect(probe.current!.previewNavigation.cursor.column).toBe(9);
    act(() => probe.current!.handleKey(hardware('0')));
    expect(probe.current!.previewNavigation.cursor.column).toBe(0);
    act(() => probe.current!.handleKey({ ...hardware('f'), control: true }));
    expect(probe.current!.previewNavigation.cursor.row).toBe(12);
    for (const key of ['g', 'g']) act(() => probe.current!.handleKey(hardware(key)));
    expect(probe.current!.previewNavigation.cursor.row).toBe(0);
    act(() => probe.current!.handleKey(hardware('v')));
    for (const key of ['2', 'w']) act(() => probe.current!.handleKey(hardware(key)));
    expect(probe.current!.previewNavigation.cursor).toEqual({ row: 1, column: 0 });
    act(() => probe.current!.handleKey(hardware('escape')));
    expect(probe.current).toMatchObject({ open: true, region: 'preview' });
    expect(probe.current!.previewNavigation.visualMode).toBeNull();
    act(() => probe.current!.handleKey(hardware('y')));
    act(() => probe.current!.handleKey(hardware('y')));
    expect(callbacks.yank).toHaveBeenLastCalledWith('row1 word');
    act(() => probe.current!.handleKey(hardware('G')));
    expect(probe.current!.previewNavigation.cursor.row).toBe(24);
    expect(probe.current!.content).toMatchObject({ text: source.text });
    expect(callbacks.handoff).not.toHaveBeenCalled();
  });

  it('uses ? and n/N for reverse directory search without opening a file', async () => {
    const entries = ['alpha.md', 'beta.md', 'gamma.md'].map((name, index) => ({ name, path: name, kind: 'text' as const, mimeType: 'text/plain', size: 1, mtimeMs: 3 - index }));
    const port: ProjectFilesPort = { listDirectory: async ({ projectId, path }) => ({ projectId, path, entries }), readFile: async () => markdown };
    await act(async () => root.render(<Harness projectId="notes" port={port} />));
    act(() => probe.current!.openBrowser()); await flush();
    act(() => probe.current!.select(2));
    for (const key of ['?', 'm', 'd', 'enter']) act(() => probe.current!.handleKey(hardware(key)));
    expect(probe.current!.selectedEntry?.path).toBe('beta.md');
    act(() => probe.current!.handleKey(hardware('n')));
    expect(probe.current!.selectedEntry?.path).toBe('alpha.md');
    act(() => probe.current!.handleKey(hardware('N')));
    expect(probe.current!.selectedEntry?.path).toBe('beta.md');
    expect(probe.current).toMatchObject({ open: true, region: 'list' });
    expect(callbacks.handoff).not.toHaveBeenCalled();
  });

  it('keeps g? help and g. hidden toggling distinct from reverse search', async () => {
    const port: ProjectFilesPort = { listDirectory: async () => markdownList, readFile: async () => markdown };
    await act(async () => root.render(<Harness projectId="notes" port={port} />));
    act(() => probe.current!.openBrowser()); await flush();
    for (const key of ['g', '?']) act(() => probe.current!.handleKey(hardware(key)));
    expect(probe.current).toMatchObject({ helpVisible: true, searchQuery: null });
    for (const key of ['g', '.']) act(() => probe.current!.handleKey(hardware(key)));
    expect(probe.current!.showHidden).toBe(false);
    act(() => probe.current!.handleKey(hardware('enter')));
    for (const key of ['g', '?']) act(() => probe.current!.handleKey(hardware(key)));
    expect(probe.current).toMatchObject({ helpVisible: false, searchQuery: null, region: 'preview' });
  });
  it('opens an exact hidden nested file at a bounded source line without reading a transient first row', async () => {
    const guide: ProjectFileContent = { ...markdown, path: 'docs/guide.md', text: 'first\nsecond\nthird' };
    const secret: ProjectFileContent = { ...markdown, path: 'docs/.secret.md', text: 'one\ntwo\nthree' };
    const listDirectory = vi.fn(async ({ projectId, path }: { projectId: string; path: string }): Promise<ProjectFileList> => ({
      projectId, path, entries: path === 'docs'
        ? [
            { name: 'guide.md', path: guide.path, kind: 'text', mimeType: 'text/markdown', size: guide.size, mtimeMs: 9 },
            { name: '.secret.md', path: secret.path, kind: 'text', mimeType: 'text/markdown', size: secret.size, mtimeMs: 1 },
          ]
        : markdownList.entries,
    }));
    const readFile = vi.fn(async ({ path }: { path: string }) => path === secret.path ? secret : guide);
    const port: ProjectFilesPort = { listDirectory, readFile };
    await act(async () => root.render(<Harness projectId="notes" port={port} />));
    act(() => probe.current!.openBrowser()); await flush();
    act(() => { probe.current!.handleKey(hardware('g')); probe.current!.handleKey(hardware('.')); });
    expect(probe.current!.showHidden).toBe(false);
    listDirectory.mockClear(); readFile.mockClear();

    act(() => probe.current!.openFilePath('docs/.secret.md', 999));
    await flush();

    expect(listDirectory).toHaveBeenCalledOnce();
    expect(listDirectory).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'notes', path: 'docs' }));
    expect(readFile).toHaveBeenCalledOnce();
    expect(readFile).toHaveBeenCalledWith(expect.objectContaining({ path: 'docs/.secret.md' }));
    expect(probe.current).toMatchObject({ open: true, path: 'docs', showHidden: true, region: 'preview', previewPhase: 'ready' });
    expect(probe.current!.selectedEntry?.path).toBe('docs/.secret.md');
    expect(probe.current!.content?.path).toBe('docs/.secret.md');
    expect(probe.current!.previewNavigation.cursor.row).toBe(2);
  });

  it('enters a linked directory instead of rejecting it or previewing its documents', async () => {
    const folder = 'venepuncture-ntfgh/snaic/recommendation-materials';
    const listDirectory = vi.fn(async ({ projectId, path }: { projectId: string; path: string }): Promise<ProjectFileList> => ({
      projectId, path, entries: path === 'venepuncture-ntfgh/snaic'
        ? [{ name: 'recommendation-materials', path: folder, kind: 'directory', size: 0, mtimeMs: 1 }]
        : [{ ...markdownList.entries[0]!, path: `${folder}/plan.md` }],
    }));
    const readFile = vi.fn(async () => markdown);
    await act(async () => root.render(<Harness projectId="notes" port={{ listDirectory, readFile }} />));
    act(() => probe.current!.openFilePath(folder)); await flush();
    expect(listDirectory.mock.calls.map(([request]) => request.path)).toEqual(['venepuncture-ntfgh/snaic', folder]);
    expect(probe.current).toMatchObject({ open: true, path: folder, phase: 'ready', region: 'list', problem: '', content: null, selectedEntry: null });
    expect(probe.current!.entries).toHaveLength(1);
    expect(readFile).not.toHaveBeenCalled();
  });

  it.each(['close', 'scope', 'newer-link'] as const)('retires the linked directory listing after %s', async (action) => {
    const pending = deferred<ProjectFileList>();
    let folderRequests = 0;
    const listDirectory = vi.fn(async ({ projectId, path }: { projectId: string; path: string }): Promise<ProjectFileList> => {
      if (path === 'docs') return { projectId, path, entries: [{ name: 'materials', path: 'docs/materials', kind: 'directory', size: 0, mtimeMs: 1 }] };
      if (path === 'docs/materials') return ++folderRequests === 1 ? pending.promise : { projectId, path, entries: [] };
      return { ...markdownList, projectId, path };
    });
    const readFile = vi.fn(async ({ path }: { path: string }) => ({ ...markdown, path }));
    const port = { listDirectory, readFile };
    await act(async () => root.render(<Harness projectId="notes" scopeKey="a" port={port} />));
    act(() => probe.current!.openFilePath('docs/materials')); await flush();
    expect(probe.current!.path).toBe('docs/materials');
    const retired = listDirectory.mock.calls[1]![0] as { signal?: AbortSignal };
    if (action === 'close') act(() => probe.current!.close());
    else if (action === 'scope') await act(async () => root.render(<Harness projectId="notes" scopeKey="b" port={port} />));
    else { act(() => probe.current!.openFilePath('plan.md')); await flush(); }
    expect(retired.signal?.aborted).toBe(true);
    await act(async () => pending.resolve({ projectId: 'notes', path: 'docs/materials', entries: [{ ...markdownList.entries[0]!, path: 'docs/materials/old.md' }] }));
    expect(probe.current!.entries.some(entry => entry.path === 'docs/materials/old.md')).toBe(false);
    expect(readFile.mock.calls.some(([request]) => (request as { path: string }).path === 'docs/materials/old.md')).toBe(false);
  });

  it('keeps the linked file folder browsable when an older Gateway omits the target', async () => {
    const listDirectory = vi.fn(async ({ projectId, path }: { projectId: string; path: string }): Promise<ProjectFileList> => ({
      projectId, path, entries: path === 'docs'
        ? [{ name: 'guide.md', path: 'docs/guide.md', kind: 'text', mimeType: 'text/markdown', size: 3, mtimeMs: 1 }]
        : markdownList.entries,
    }));
    const readFile = vi.fn(async () => markdown);
    const port: ProjectFilesPort = { listDirectory, readFile };
    await act(async () => root.render(<Harness projectId="notes" port={port} />));
    act(() => probe.current!.openBrowser()); await flush();
    expect(probe.current!.content?.path).toBe('plan.md');
    readFile.mockClear();

    act(() => probe.current!.openFilePath('docs/archive.zip'));
    await flush();

    expect(probe.current).toMatchObject({ open: true, path: 'docs', phase: 'ready', content: null, selectedEntry: null, region: 'list' });
    expect(probe.current!.problem).toContain('Linked file is not listed by the Gateway');
    expect(probe.current!.entries.map(entry => entry.path)).toEqual(['docs/guide.md']);
    expect(probe.current!.problem).toContain('docs/archive.zip');
    expect(readFile).not.toHaveBeenCalled();
  });

  it('selects a linked PDF in its folder without requesting content or retaining an old preview', async () => {
    const pdfPath = 'docs/report.pdf';
    const port: ProjectFilesPort = {
      listDirectory: async ({ projectId, path }) => path ? { projectId, path, entries: [
        { name: 'report.pdf', path: pdfPath, kind: 'unsupported', size: 12, mtimeMs: 9 },
        { ...markdownList.entries[0]!, path: 'docs/plan.md' },
      ] } : markdownList,
      readFile: vi.fn(async () => markdown),
    };
    await act(async () => root.render(<Harness projectId="notes" port={port} />));
    act(() => probe.current!.openBrowser()); await flush();
    expect(probe.current!.content?.path).toBe('plan.md');
    vi.mocked(port.readFile).mockClear();
    act(() => probe.current!.openFilePath(pdfPath)); await flush();
    expect(probe.current).toMatchObject({ path: 'docs', phase: 'ready', problem: '', content: null, previewPhase: 'idle' });
    expect(probe.current!.selectedEntry?.path).toBe(pdfPath);
    expect(port.readFile).not.toHaveBeenCalled();
    act(() => probe.current!.openEntry(probe.current!.selectedIndex)); await flush();
    expect(port.readFile).not.toHaveBeenCalled();
    for (const key of ['i', 'y']) act(() => probe.current!.handleKey(hardware(key)));
    expect(callbacks.handoff).not.toHaveBeenCalled(); expect(callbacks.yank).not.toHaveBeenCalled();
  });

  it('retires linked-file directory work on a newer open, close, and scope change', async () => {
    const firstList = deferred<ProjectFileList>();
    const secondList = deferred<ProjectFileList>();
    const secondRead = deferred<ProjectFileContent>();
    const listDirectory = vi.fn()
      .mockImplementationOnce(() => firstList.promise)
      .mockImplementationOnce(() => secondList.promise)
      .mockResolvedValue(markdownList);
    const readFile = vi.fn().mockImplementationOnce(() => secondRead.promise).mockResolvedValue(markdown);
    const port: ProjectFilesPort = { listDirectory, readFile };
    await act(async () => root.render(<Harness projectId="notes" scopeKey="thread-a" port={port} />));

    act(() => probe.current!.openFilePath('a/old.md', 2));
    act(() => probe.current!.openFilePath('b/current.md', 3));
    await act(async () => firstList.resolve({ projectId: 'notes', path: 'a', entries: [{ name: 'old.md', path: 'a/old.md', kind: 'text', mimeType: 'text/plain', size: 3, mtimeMs: 1 }] }));
    expect(probe.current!.path).toBe('b');
    expect(readFile).not.toHaveBeenCalled();
    await act(async () => secondList.resolve({ projectId: 'notes', path: 'b', entries: [{ name: 'current.md', path: 'b/current.md', kind: 'text', mimeType: 'text/plain', size: 5, mtimeMs: 1 }] }));
    expect(readFile).toHaveBeenCalledOnce();

    act(() => probe.current!.close());
    await act(async () => secondRead.resolve({ ...markdown, path: 'b/current.md', text: 'one\ntwo\nthree' }));
    expect(probe.current!.content).toBeNull();
    await act(async () => root.render(<Harness projectId="notes" scopeKey="thread-b" port={port} />));
    expect(probe.current!.open).toBe(false);
    expect(probe.current!.previewNavigation.cursor.row).toBe(0);
  });

  it('retires a linked source line and read when the active thread changes', async () => {
    const oldRead = deferred<ProjectFileContent>();
    const currentRead = deferred<ProjectFileContent>();
    const linkedList: ProjectFileList = { projectId: 'notes', path: 'docs', entries: [{ name: 'guide.md', path: 'docs/guide.md', kind: 'text', mimeType: 'text/markdown', size: 13, mtimeMs: 1 }] };
    const readFile = vi.fn().mockImplementationOnce(() => oldRead.promise).mockImplementationOnce(() => currentRead.promise);
    const port: ProjectFilesPort = { listDirectory: async ({ path }) => path === 'docs' ? linkedList : markdownList, readFile };
    await act(async () => root.render(<Harness projectId="notes" scopeKey="thread-a" port={port} />));
    act(() => probe.current!.openFilePath('docs/guide.md', 3)); await flush();
    expect(readFile).toHaveBeenCalledOnce();

    await act(async () => root.render(<Harness projectId="notes" scopeKey="thread-b" port={port} />));
    expect(readFile).toHaveBeenCalledTimes(2);
    await act(async () => oldRead.resolve({ ...markdown, path: 'docs/guide.md', text: 'old\nthread\nread' }));
    expect(probe.current!.content).toBeNull();
    await act(async () => currentRead.resolve({ ...markdown, path: 'plan.md', text: 'current\nthread\nread' }));
    expect(probe.current!.content).toMatchObject({ text: 'current\nthread\nread' });
    expect(probe.current!.previewNavigation.cursor.row).toBe(0);
  });

  it('does not apply a captured linked line after manual selection clears its authority', async () => {
    const pendingRead = deferred<ProjectFileContent>();
    const linkedList: ProjectFileList = { projectId: 'notes', path: 'docs', entries: [{ name: 'guide.md', path: 'docs/guide.md', kind: 'text', mimeType: 'text/markdown', size: 13, mtimeMs: 1 }] };
    const port: ProjectFilesPort = { listDirectory: async () => linkedList, readFile: () => pendingRead.promise };
    await act(async () => root.render(<Harness projectId="notes" port={port} />));
    act(() => probe.current!.openFilePath('docs/guide.md', 3)); await flush();

    act(() => probe.current!.select(0));
    await act(async () => pendingRead.resolve({ ...markdown, path: 'docs/guide.md', text: 'one\ntwo\nthree' }));

    expect(probe.current!.content?.path).toBe('docs/guide.md');
    expect(probe.current!.previewNavigation.cursor.row).toBe(0);
  });

  it('bounds a non-finite public line to the first source line', async () => {
    const port: ProjectFilesPort = { listDirectory: async () => markdownList, readFile: async () => markdown };
    await act(async () => root.render(<Harness projectId="notes" port={port} />));
    act(() => probe.current!.openFilePath('plan.md', Number.POSITIVE_INFINITY)); await flush();
    expect(probe.current!.previewNavigation.cursor.row).toBe(0);
  });

  it('keeps Files open on a root-project switch while dropping the old directory response', async () => {
    const oldList = deferred<ProjectFileList>();
    const freshList: ProjectFileList = { projectId: 'vimicate', path: '', entries: [{ name: 'fresh.txt', path: 'fresh.txt', kind: 'text', mimeType: 'text/plain', size: 5, mtimeMs: 1 }] };
    const listDirectory = vi.fn(({ projectId }: { projectId: string }) => projectId === 'notes' ? oldList.promise : Promise.resolve(freshList));
    const port: ProjectFilesPort = { listDirectory, readFile: vi.fn(async ({ projectId, path }): Promise<ProjectFileContent> => ({ projectId, path, kind: 'text', mimeType: 'text/plain', size: 5, mtimeMs: 1, text: 'fresh' })) };
    await act(async () => root.render(<Harness projectId="notes" port={port} />));
    act(() => probe.current!.openBrowser());
    await act(async () => root.render(<Harness projectId="vimicate" port={port} />));
    await flush();
    expect(probe.current).toMatchObject({ open: true, path: '', selectedEntry: expect.objectContaining({ path: 'fresh.txt' }) });
    await act(async () => oldList.resolve(markdownList));
    expect(probe.current!.selectedEntry?.path).toBe('fresh.txt');
    expect(listDirectory).toHaveBeenLastCalledWith(expect.objectContaining({ projectId: 'vimicate', path: '' }));
    expect(callbacks.close).not.toHaveBeenCalled();
    expect(callbacks.handoff).not.toHaveBeenCalled();
  });

  it('cannot publish a late old-root read after the new project is ready', async () => {
    const oldRead = deferred<ProjectFileContent>();
    const freshList: ProjectFileList = { projectId: 'vimicate', path: '', entries: [{ name: 'fresh.txt', path: 'fresh.txt', kind: 'text', mimeType: 'text/plain', size: 5, mtimeMs: 1 }] };
    const listDirectory = vi.fn(async ({ projectId }: { projectId: string }) => projectId === 'notes' ? markdownList : freshList);
    const readFile = vi.fn(({ projectId, path }: { projectId: string; path: string }) => projectId === 'notes'
      ? oldRead.promise
      : Promise.resolve<ProjectFileContent>({ projectId, path, kind: 'text', mimeType: 'text/plain', size: 5, mtimeMs: 1, text: 'fresh project read' }));
    const port: ProjectFilesPort = { listDirectory, readFile };
    await act(async () => root.render(<Harness projectId="notes" scopeKey="notes-thread" port={port} />));
    act(() => probe.current!.openBrowser()); await flush();
    expect(readFile).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'notes', path: 'plan.md' }));

    await act(async () => root.render(<Harness projectId="vimicate" scopeKey="vimicate-thread" port={port} />));
    await flush();
    expect(probe.current).toMatchObject({ open: true, content: expect.objectContaining({ projectId: 'vimicate', text: 'fresh project read' }) });
    await act(async () => oldRead.resolve({ ...markdown, text: 'late old project read' }));
    expect(probe.current!.content).toMatchObject({ projectId: 'vimicate', text: 'fresh project read' });
    expect(callbacks.handoff).not.toHaveBeenCalled();
  });

  it('keeps same-root state open and retires a late read when switching threads', async () => {
    const oldRead = deferred<ProjectFileContent>();
    const currentRead = deferred<ProjectFileContent>();
    const handoffs = vi.fn();
    const readFile = vi.fn().mockImplementationOnce(() => oldRead.promise).mockImplementationOnce(() => currentRead.promise);
    const port: ProjectFilesPort = { listDirectory: async () => markdownList, readFile };
    await act(async () => root.render(<Harness projectId="notes" scopeKey="thread-a" port={port} onHandoff={() => handoffs('thread-a')} />));
    act(() => probe.current!.openBrowser()); await flush();
    expect(probe.current!.selectedEntry?.path).toBe('plan.md');
    await act(async () => root.render(<Harness projectId="notes" scopeKey="thread-b" port={port} onHandoff={() => handoffs('thread-b')} />));
    expect(probe.current).toMatchObject({ open: true, path: '', selectedEntry: expect.objectContaining({ path: 'plan.md' }) });
    expect(readFile).toHaveBeenCalledTimes(2);
    await act(async () => oldRead.resolve({ ...markdown, text: 'old thread read' }));
    expect(probe.current!.content).toBeNull();
    act(() => { probe.current!.handleKey(hardware('enter')); probe.current!.handleKey(hardware('i')); });
    expect(handoffs).not.toHaveBeenCalled();
    await act(async () => currentRead.resolve({ ...markdown, text: 'current thread read' }));
    expect(probe.current!.content).toMatchObject({ text: 'current thread read' });
    act(() => probe.current!.handleKey(hardware('i')));
    expect(handoffs).toHaveBeenCalledWith('thread-b');
    expect(callbacks.close).not.toHaveBeenCalled();
  });

  it('starts unseen threads at root and restores their own directory, options and cursor on return', async () => {
    const hidden = { name: '.private', path: 'docs/.private', kind: 'text' as const, mimeType: 'text/plain', size: 7, mtimeMs: 1 };
    const guide = { ...markdown, path: 'docs/guide.md', text: '# Guide\n- first\n- second' };
    const revalidated = deferred<ProjectFileContent>();
    const listDirectory = vi.fn(async ({ projectId, path }: { projectId: string; path: string }) => ({
      projectId, path, entries: path === 'docs' ? [{ ...markdownList.entries[0]!, path: guide.path }, hidden] : [{ name: 'docs', path: 'docs', kind: 'directory' as const, size: 0, mtimeMs: 2 }],
    }));
    const readFile = vi.fn().mockResolvedValueOnce(guide).mockImplementationOnce(() => revalidated.promise);
    const port: ProjectFilesPort = { listDirectory, readFile };
    await act(async () => root.render(<Harness projectId="notes" scopeKey="thread-a" port={port} />));
    act(() => probe.current!.openBrowser()); await flush();
    act(() => probe.current!.handleKey(hardware('enter'))); await flush();
    act(() => probe.current!.handleKey(hardware('g')));
    act(() => probe.current!.handleKey(hardware('.')));
    act(() => probe.current!.setHelpVisible(true));
    act(() => probe.current!.handleKey(hardware('enter'))); await flush();
    act(() => probe.current!.handleKey(hardware('j')));

    await act(async () => root.render(<Harness projectId="notes" scopeKey="thread-b" port={port} />));
    expect(probe.current).toMatchObject({ open: true, path: '', showHidden: true, region: 'list', helpVisible: false, content: null });
    expect(probe.current!.previewNavigation.cursor.row).toBe(0);
    await act(async () => root.render(<Harness projectId="notes" scopeKey="thread-a" port={port} />));
    expect(probe.current).toMatchObject({ open: true, path: 'docs', showHidden: false, region: 'preview', helpVisible: true, previewPhase: 'loading', content: expect.objectContaining({ path: guide.path }) });
    expect(probe.current!.selectedEntry?.path).toBe(guide.path);
    expect(probe.current!.previewNavigation.cursor.row).toBe(1);
    expect(listDirectory).toHaveBeenCalledTimes(4);
    expect(readFile).toHaveBeenCalledTimes(2);
    act(() => probe.current!.handleKey(hardware('i')));
    expect(callbacks.handoff).not.toHaveBeenCalled();

    await act(async () => revalidated.resolve(guide));
    expect(probe.current!.previewNavigation.cursor.row).toBe(1);
    act(() => probe.current!.handleKey(hardware('i')));
    expect(callbacks.handoff).toHaveBeenCalledTimes(1);
  });

  it('suspends and resumes the current directory, selection, options, region, and source cursor', async () => {
    const hidden = { name: '.private', path: 'docs/.private', kind: 'text' as const, mimeType: 'text/plain', size: 7, mtimeMs: 1 };
    const guide = { ...markdown, path: 'docs/guide.md', text: '# Guide\n- first\n- second' };
    const resumedRead = deferred<ProjectFileContent>();
    const rapidRead = deferred<ProjectFileContent>();
    const listDirectory = vi.fn(async ({ projectId, path }: { projectId: string; path: string }) => ({
      projectId, path, entries: path === 'docs' ? [{ ...markdownList.entries[0]!, path: guide.path }, hidden] : [{ name: 'docs', path: 'docs', kind: 'directory' as const, size: 0, mtimeMs: 2 }],
    }));
    const readFile = vi.fn()
      .mockResolvedValueOnce(guide)
      .mockImplementationOnce(() => resumedRead.promise)
      .mockImplementationOnce(() => rapidRead.promise);
    const port: ProjectFilesPort = { listDirectory, readFile };
    await act(async () => root.render(<Harness projectId="notes" scopeKey="thread-a" port={port} />));
    act(() => probe.current!.openBrowser()); await flush();
    act(() => probe.current!.handleKey(hardware('enter'))); await flush();
    act(() => probe.current!.handleKey(hardware('g')));
    act(() => probe.current!.handleKey(hardware('.')));
    act(() => probe.current!.setHelpVisible(true));
    act(() => probe.current!.handleKey(hardware('enter'))); await flush();
    act(() => probe.current!.handleKey(hardware('j')));
    expect(probe.current).toMatchObject({ path: 'docs', showHidden: false, region: 'preview', helpVisible: true });
    expect(probe.current!.previewNavigation.cursor.row).toBe(1);

    act(() => probe.current!.close());
    expect(probe.current!.open).toBe(false);
    expect(listDirectory).toHaveBeenCalledTimes(2);
    expect(readFile).toHaveBeenCalledTimes(1);
    let hiddenHandled = true;
    act(() => { hiddenHandled = probe.current!.handleKey(hardware('k')); probe.current!.handleKey(hardware('i')); });
    expect(hiddenHandled).toBe(false);
    expect(probe.current!.previewNavigation.cursor.row).toBe(1);
    expect(callbacks.handoff).not.toHaveBeenCalled();

    act(() => probe.current!.openBrowser()); await flush();
    expect(probe.current).toMatchObject({ open: true, path: 'docs', showHidden: false, region: 'preview', helpVisible: true });
    expect(probe.current!.selectedEntry?.path).toBe(guide.path);
    expect(probe.current!.content?.path).toBe(guide.path);
    expect(probe.current!.previewNavigation.cursor.row).toBe(1);
    expect(listDirectory).toHaveBeenCalledTimes(2);
    expect(readFile).toHaveBeenCalledTimes(2);
    act(() => { probe.current!.handleKey(hardware('y')); probe.current!.handleKey(hardware('y')); probe.current!.handleKey(hardware('i')); });
    expect(callbacks.yank).not.toHaveBeenCalled();
    expect(callbacks.handoff).not.toHaveBeenCalled();
    await act(async () => resumedRead.resolve(guide));
    expect(probe.current!.previewNavigation.cursor.row).toBe(1);

    act(() => { probe.current!.close(); probe.current!.openBrowser(); });
    await flush();
    expect(probe.current!.open).toBe(true);
    expect(readFile).toHaveBeenCalledTimes(3);
    await act(async () => rapidRead.resolve(guide));
    expect(probe.current!.previewNavigation.cursor.row).toBe(1);
  });

  it('restarts interrupted directory and preview requests when reopened without working while hidden', async () => {
    const firstList = deferred<ProjectFileList>();
    const secondList = deferred<ProjectFileList>();
    const firstRead = deferred<ProjectFileContent>();
    const secondRead = deferred<ProjectFileContent>();
    const listDirectory = vi.fn()
      .mockImplementationOnce(() => firstList.promise)
      .mockImplementationOnce(() => secondList.promise);
    const readFile = vi.fn()
      .mockImplementationOnce(() => firstRead.promise)
      .mockImplementationOnce(() => secondRead.promise);
    const port: ProjectFilesPort = { listDirectory, readFile };
    await act(async () => root.render(<Harness projectId="notes" port={port} />));

    act(() => probe.current!.openBrowser());
    expect(listDirectory).toHaveBeenCalledTimes(1);
    act(() => probe.current!.close());
    await act(async () => firstList.resolve(markdownList));
    expect(probe.current!.entries).toEqual([]);
    expect(listDirectory).toHaveBeenCalledTimes(1);

    act(() => probe.current!.openBrowser());
    expect(listDirectory).toHaveBeenCalledTimes(2);
    await act(async () => secondList.resolve(markdownList));
    expect(probe.current!.selectedEntry?.path).toBe('plan.md');
    expect(readFile).toHaveBeenCalledTimes(1);
    act(() => probe.current!.close());
    await act(async () => firstRead.resolve(markdown));
    expect(probe.current!.content).toBeNull();
    expect(readFile).toHaveBeenCalledTimes(1);

    act(() => probe.current!.openBrowser());
    expect(readFile).toHaveBeenCalledTimes(2);
    await act(async () => secondRead.resolve(markdown));
    expect(probe.current!.content?.path).toBe('plan.md');
  });

  it('invalidates suspended state when the project scope changes while Files is closed', async () => {
    const newList: ProjectFileList = { projectId: 'vimicate', path: '', entries: [{ name: 'fresh.txt', path: 'fresh.txt', kind: 'text', mimeType: 'text/plain', size: 5, mtimeMs: 1 }] };
    const listDirectory = vi.fn(async ({ projectId, path }: { projectId: string; path: string }) => projectId === 'notes' ? markdownList : { ...newList, path });
    const port: ProjectFilesPort = { listDirectory, readFile: async () => markdown };
    await act(async () => root.render(<Harness projectId="notes" scopeKey="thread-a" port={port} />));
    act(() => probe.current!.openBrowser()); await flush();
    act(() => probe.current!.handleKey(hardware('enter'))); await flush();
    act(() => probe.current!.handleKey(hardware('j')));
    act(() => probe.current!.close());

    await act(async () => root.render(<Harness projectId="vimicate" scopeKey="thread-b" port={port} />));
    expect(probe.current).toMatchObject({ open: false, path: '', region: 'list', content: null, selectedEntry: null });
    expect(listDirectory).toHaveBeenCalledTimes(1);
    expect(callbacks.close).toHaveBeenCalledTimes(1);
    act(() => probe.current!.openBrowser()); await flush();
    expect(probe.current!.selectedEntry?.path).toBe('fresh.txt');
    expect(probe.current!.content?.projectId).not.toBe('notes');
  });

  it('re-lists a returned closed scope before trusting its retained selection on reopen', async () => {
    let present = true;
    const listDirectory = vi.fn(async ({ projectId, path }: { projectId: string; path: string }) => ({
      projectId, path, entries: present ? markdownList.entries : [],
    }));
    const port: ProjectFilesPort = { listDirectory, readFile: async () => markdown };
    await act(async () => root.render(<Harness projectId="notes" scopeKey="a" port={port} />));
    act(() => probe.current!.openBrowser()); await flush();
    act(() => probe.current!.handleKey(hardware('enter')));
    act(() => probe.current!.close());
    await act(async () => root.render(<Harness projectId="notes" scopeKey="b" port={port} />));
    await act(async () => root.render(<Harness projectId="notes" scopeKey="a" port={port} />));
    expect(listDirectory).toHaveBeenCalledTimes(1);
    present = false;
    act(() => probe.current!.openBrowser()); await flush();
    expect(listDirectory).toHaveBeenCalledTimes(2);
    expect(probe.current).toMatchObject({ selectedEntry: null, content: null, region: 'list' });
  });

  it('clears an open browser for an invalid project without reading or reporting a close', async () => {
    const listDirectory = vi.fn(async () => markdownList);
    const port: ProjectFilesPort = { listDirectory, readFile: async () => markdown };
    await act(async () => root.render(<Harness projectId="notes" scopeKey="thread-a" port={port} />));
    act(() => probe.current!.openBrowser()); await flush(); await flush();
    expect(probe.current!.content?.projectId).toBe('notes');

    await act(async () => root.render(<Harness projectId="" scopeKey="" port={port} />));
    expect(probe.current).toMatchObject({ open: true, path: '', entries: [], selectedEntry: null, content: null, phase: 'error' });
    expect(listDirectory).toHaveBeenCalledTimes(1);
    act(() => { probe.current!.handleKey(hardware('tab')); probe.current!.handleKey(hardware('i')); });
    expect(callbacks.handoff).not.toHaveBeenCalled();
    expect(callbacks.close).not.toHaveBeenCalled();
  });

  it('cancels an active search without closing Files or retaining the incomplete query', async () => {
    const port: ProjectFilesPort = { listDirectory: async () => markdownList, readFile: async () => markdown };
    await act(async () => root.render(<Harness projectId="notes" port={port} />));
    act(() => probe.current!.openBrowser()); await flush();
    for (const key of ['/', 'p', 'l']) act(() => probe.current!.handleKey(hardware(key)));
    expect(probe.current!.searchQuery).toBe('pl');
    act(() => probe.current!.handleKey(hardware('escape')));
    expect(probe.current).toMatchObject({ open: true, searchQuery: null, path: '' });
    act(() => probe.current!.handleKey(hardware('escape')));
    expect(probe.current!.open).toBe(false);
  });

  it('uses q and Escape to cancel transient list or preview modes before closing Files', async () => {
    const port: ProjectFilesPort = { listDirectory: async () => markdownList, readFile: async () => markdown };
    await act(async () => root.render(<Harness projectId="notes" port={port} />));
    act(() => probe.current!.openBrowser()); await flush();
    act(() => probe.current!.handleKey(hardware('g')));
    act(() => probe.current!.handleKey(hardware('q')));
    expect(probe.current!.open).toBe(true);
    act(() => probe.current!.handleKey(hardware('enter'))); await flush();
    act(() => probe.current!.handleKey(hardware('v')));
    act(() => probe.current!.handleKey(hardware('q')));
    expect(probe.current!.previewNavigation.visualMode).toBeNull();
    expect(probe.current!.open).toBe(true);
    for (const key of ['/', 'q']) act(() => probe.current!.handleKey(hardware(key)));
    expect(probe.current!.searchQuery).toBe('q');
    act(() => probe.current!.handleKey(hardware('escape')));
    expect(probe.current!.open).toBe(true);
    act(() => probe.current!.handleKey(hardware('q')));
    expect(probe.current!.open).toBe(false);
  });

  it('uses raw source for yank/handoff, only hands off a clean insertion, and closes an iPhone owner', async () => {
    const port: ProjectFilesPort = { listDirectory: async () => markdownList, readFile: async () => markdown };
    await act(async () => root.render(<Harness projectId="notes" port={port} closeOnHandoff />));
    act(() => probe.current!.openBrowser()); await flush(); await flush();
    act(() => probe.current!.handleKey(hardware('enter')));
    act(() => probe.current!.handleKey(hardware('y')));
    act(() => probe.current!.handleKey(hardware('y')));
    expect(callbacks.yank).toHaveBeenCalledWith('# Plan');
    act(() => probe.current!.handleKey(hardware('v')));
    act(() => probe.current!.handleKey(hardware('i')));
    expect(callbacks.handoff).not.toHaveBeenCalled();
    act(() => probe.current!.handleKey(hardware('escape')));
    act(() => probe.current!.openBrowser()); await flush(); await flush();
    act(() => probe.current!.handleKey(hardware('enter')));
    act(() => probe.current!.handleKey(hardware('i')));
    expect(callbacks.handoff).toHaveBeenCalledWith(expect.objectContaining({ path: 'plan.md', text: expect.stringContaining(markdown.text) }));
    expect(probe.current!.open).toBe(false);
  });

  it('bounds rendered source by both characters and lines', () => {
    const source = Array.from({ length: PROJECT_FILE_PREVIEW_MAX_LINES + 20 }, (_, index) => `${index}:${'x'.repeat(300)}`).join('\n');
    const result = boundedProjectFilePreviewSource(source);
    expect(result.truncated).toBe(true);
    expect(result.source.length).toBeLessThanOrEqual(PROJECT_FILE_PREVIEW_MAX_CHARACTERS);
    expect(result.source.split('\n').length).toBeLessThanOrEqual(PROJECT_FILE_PREVIEW_MAX_LINES);
  });

  it('opens directories by touch, returns to the bounded parent, and searches list and source', async () => {
    const directory = { name: 'docs', path: 'docs', kind: 'directory' as const, size: 0, mtimeMs: 1 };
    const listDirectory = vi.fn(async ({ projectId, path }: { projectId: string; path: string }) => ({ projectId, path, entries: path ? [] : [...markdownList.entries, directory] }));
    const port: ProjectFilesPort = { listDirectory, readFile: async () => markdown };
    await act(async () => root.render(<Harness projectId="notes" port={port} />));
    act(() => probe.current!.openBrowser()); await flush(); await flush();
    for (const key of ['/', 'd', 'o', 'c', 's', 'enter']) act(() => probe.current!.handleKey(hardware(key)));
    expect(probe.current!.selectedEntry?.path).toBe('docs');
    act(() => probe.current!.openEntry(1)); await flush();
    expect(probe.current!.path).toBe('docs');
    act(() => probe.current!.parent()); await flush(); await flush();
    expect(probe.current!.path).toBe('');
    act(() => probe.current!.parent()); await flush(); await flush();
    expect(listDirectory).toHaveBeenLastCalledWith(expect.objectContaining({ path: '' }));
    act(() => probe.current!.handleKey(hardware('tab')));
    expect(probe.current!.region).toBe('preview');
    for (const key of ['/', 's', 'e', 'c', 'o', 'n', 'd', 'enter']) act(() => probe.current!.handleKey(hardware(key)));
    expect(probe.current!.previewNavigation.cursor.row).toBe(2);
    act(() => probe.current!.handleKey(hardware('y')));
    act(() => probe.current!.handleKey(hardware('y')));
    expect(callbacks.yank).toHaveBeenLastCalledWith('- second');
  });

  // Physical iPad, 5 Oct: an iCloud placeholder PDF failed to read with the
  // preview focused, and j/k did nothing until Ctrl-k or Tab.
  it.each([
    ['a failed read', async () => { throw new Error('vimicate project files: file read failed'); }],
    ['a finished PDF preview', async (_projectId: string, path: string) => ({ projectId: 'notes', path, kind: 'document', mimeType: 'application/pdf', size: 3, mtimeMs: 3, dataBase64: 'JVBE' } as unknown as ProjectFileContent)],
  ] as const)('hands j/k back to the list after %s in the preview', async (_label, read) => {
    const pdfs: ProjectFileList = { projectId: 'notes', path: '', entries: ['a.pdf', 'b.pdf', 'c.pdf'].map((name, index) =>
      ({ name, path: name, kind: 'document', mimeType: 'application/pdf', size: 3, mtimeMs: 10 - index })) } as unknown as ProjectFileList;
    const port: ProjectFilesPort = { listDirectory: async () => pdfs, readFile: (async (request: { projectId: string; path: string }) => read(request.projectId, request.path)) as unknown as ProjectFilesPort['readFile'] };
    await act(async () => root.render(<Harness projectId="notes" port={port} />));
    act(() => probe.current!.openBrowser()); await flush(); await flush();
    act(() => probe.current!.handleKey({ ...hardware('j'), control: true })); await flush(); await flush();
    expect(probe.current!.region).toBe('preview');
    expect(probe.current!.selectedEntry?.path).toBe('a.pdf');
    act(() => probe.current!.handleKey(hardware('j'))); await flush();
    expect(probe.current!.region).toBe('list');
    expect(probe.current!.selectedEntry?.path).toBe('b.pdf');
    act(() => probe.current!.handleKey(hardware('k'))); await flush();
    expect(probe.current!.selectedEntry?.path).toBe('a.pdf');
  });

  it('uses control vertical pane aliases to move between the directory and preview regions', async () => {
    const port: ProjectFilesPort = { listDirectory: async () => markdownList, readFile: async () => markdown };
    await act(async () => root.render(<Harness projectId="notes" port={port} />));
    act(() => probe.current!.openBrowser()); await flush(); await flush();
    expect(probe.current!.region).toBe('list');

    act(() => probe.current!.handleKey({ ...hardware('j'), control: true }));
    expect(probe.current!.region).toBe('preview');
    act(() => probe.current!.handleKey({ ...hardware('up'), control: true }));
    expect(probe.current!.region).toBe('list');
    act(() => probe.current!.handleKey({ ...hardware('down'), control: true }));
    expect(probe.current!.region).toBe('preview');
    act(() => probe.current!.handleKey({ ...hardware('k'), control: true }));
    expect(probe.current!.region).toBe('list');
  });
});

it.each(['tap', 'enter'])('retries a failed selected preview via %s without requiring a different file selection', async method => {
  const readFile = vi.fn().mockRejectedValueOnce(new Error('health timed out')).mockResolvedValue(markdown);
  const port: ProjectFilesPort = { listDirectory: async () => markdownList, readFile };
  await act(async () => root.render(<Harness projectId="notes" port={port} />));
  act(() => probe.current!.openBrowser()); await flush();
  expect(probe.current!.previewPhase).toBe('error'); expect(readFile).toHaveBeenCalledTimes(1);
  act(() => method === 'tap' ? probe.current!.openEntry(0) : probe.current!.handleKey(hardware('enter'))); await flush();
  expect(readFile).toHaveBeenCalledTimes(2);
  expect(probe.current!.previewPhase).toBe('ready'); expect(probe.current!.previewProblem).toBe('');
  expect(probe.current!.content).toEqual(markdown);
  act(() => probe.current!.openEntry(0)); await flush();
  expect(readFile).toHaveBeenCalledTimes(2);
});
