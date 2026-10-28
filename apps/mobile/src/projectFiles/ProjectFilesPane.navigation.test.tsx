// @vitest-environment jsdom
import React, { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ProjectFileContent, ProjectFileList } from '../gateway/projectFiles';
import type { ProjectFilesPort } from './projectFilesTypes';
import { useProjectFilesController, type ProjectFilesController } from './useProjectFilesController';

const probe = vi.hoisted(() => ({ share: vi.fn(), scroll: [] as Array<{ pane: string; index: number }>, controller: null as ProjectFilesController | null, openMedia: vi.fn(), focus: vi.fn(), fontStep: vi.fn(), alignments: [] as Array<number | undefined>, previewMounts: 0, lists: new WeakMap<HTMLElement, Record<string, unknown>>(), gestures: new WeakMap<HTMLElement, Record<string, (event: unknown) => unknown>>() }));
vi.mock('react-native', async () => {
  const { createElement, forwardRef, useImperativeHandle, useEffect } = await import('react');
  const Host = ({ children, accessibilityLabel, onPress, ...props }: { children?: React.ReactNode; accessibilityLabel?: string; onPress?: () => void; [key: string]: unknown }) => createElement('div', {
    'aria-label': accessibilityLabel, onClick: onPress, 'data-pinch': props.onResponderGrant ? 'true' : undefined,
    'data-hidden': [props.style].flat().some(style => (style as { display?: string })?.display === 'none') ? 'true' : undefined,
    ref: (element: HTMLDivElement | null) => { if (element && props.onResponderGrant) probe.gestures.set(element, props as Record<string, (event: unknown) => unknown>); },
  }, children);
  const FlatList = forwardRef((props: { accessibilityLabel?: string; data: unknown[]; renderItem: (input: { item: unknown; index: number }) => React.ReactNode; ListHeaderComponent?: React.ReactNode; onLayout?: unknown; onViewableItemsChanged?: unknown; onScrollToIndexFailed?: unknown; onScrollBeginDrag?: unknown }, ref) => {
    useEffect(() => { if (props.accessibilityLabel?.startsWith('Rendered preview')) probe.previewMounts++; }, []);
    useImperativeHandle(ref, () => ({ scrollToIndex: ({ index, viewPosition }: { index: number; viewPosition?: number }) => {
      if (!props.data.length) throw new Error('scrollToIndex out of range: item length 0 but minimum is 1');
      if (index < 0 || index >= props.data.length) throw new Error(`scrollToIndex out of range: requested index ${index} but item length is ${props.data.length}`);
      probe.scroll.push({ pane: props.accessibilityLabel ?? '', index });
      probe.alignments.push(viewPosition);
    }, scrollToOffset: () => undefined }));
    return createElement('div', { 'aria-label': props.accessibilityLabel, ref: (element: HTMLDivElement | null) => { if (element) probe.lists.set(element, props); } }, props.ListHeaderComponent, ...props.data.map((item, index) => props.renderItem({ item, index })));
  });
  return { AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) }, View: Host, ScrollView: Host, Text: Host, Pressable: Host, Image: Host, FlatList, StyleSheet: { create: (styles: unknown) => styles } };
});
vi.mock('./useProjectFilesSplit', () => ({ useProjectFilesSplit: () => ({ listHeight: 100, dividerHeight: 4, onLayoutHeight: () => undefined, dividerPanHandlers: {}, resize: () => undefined }) }));
vi.mock('./ProjectFilesDivider', () => ({ ProjectFilesDivider: () => null }));
vi.mock('../../modules/vimicate-file-links', () => ({ VimicateFilePreviewView: null, VimicateHTMLPreviewView: null, isVimicateFileShareAvailable: () => false, isVimicateStreamedFileShareAvailable: () => false, maximumVimicateFileShareBytes: () => 32 * 1024 * 1024, shareVimicateFile: probe.share }));
vi.mock('expo-symbols', () => ({ SymbolView: () => <span /> }));
vi.mock('../transcript/TranscriptMarkdownLine', () => ({ TranscriptMarkdownLine: ({ line, row, navigation }: { line: { source: string }; row: number; navigation: { cursor: { row: number; column: number } } }) => <span data-row={row} data-column={navigation.cursor.row === row ? navigation.cursor.column : -1}>{line.source}</span> }));

import { ProjectFilesPane } from './ProjectFilesPane';

const hardware = (key: string) => ({ key, shift: false, control: false, option: false, command: false });
const source = 'alpha beta gamma delta\nepsilon zeta';
const list: ProjectFileList = { projectId: 'notes', path: '', entries: [{ name: 'plan.md', path: 'plan.md', kind: 'text', mimeType: 'text/markdown', size: source.length, mtimeMs: 1 }] };
const file: ProjectFileContent = { projectId: 'notes', path: 'plan.md', kind: 'text', mimeType: 'text/markdown', size: source.length, mtimeMs: 1, text: source };
const port: ProjectFilesPort = { listDirectory: async () => list, readFile: async () => file };
let root: Root; let node: HTMLDivElement;
function Harness({ width = 300, previewFontScale = 0.88, scopeKey, filesPort = port, rootLabel, rootPath }: { width?: number; previewFontScale?: number; scopeKey?: string; filesPort?: ProjectFilesPort; rootLabel?: string; rootPath?: string }) {
  const controller = useProjectFilesController({ projectId: 'notes', ...(scopeKey ? { scopeKey } : {}), port: filesPort, onStatus: () => undefined, onYank: () => undefined, onHandoff: () => undefined, onClose: () => undefined });
  useLayoutEffect(() => { probe.controller = controller; });
  return <ProjectFilesPane controller={controller} {...(rootLabel ? { rootLabel } : {})} {...(rootPath ? { rootPath } : {})} presentation="sidebar" width={width} previewFontScale={previewFontScale} focused onFontStep={probe.fontStep} onRequestFocus={probe.focus} {...{ onOpenMedia: probe.openMedia }} />;
}
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); probe.scroll.length = 0; probe.alignments.length = 0; probe.previewMounts = 0; probe.controller = null; probe.share.mockReset().mockResolvedValue({ status: 'cancelled' }); probe.openMedia.mockReset(); probe.focus.mockReset(); probe.fontStep.mockReset(); node = document.createElement('div'); document.body.append(node); root = createRoot(node); });
afterEach(async () => { await act(async () => root.unmount()); node.remove(); vi.unstubAllGlobals(); });

it('identifies the shared Downloads root separately from a project path', async () => {
  await act(async () => root.render(<Harness rootLabel="iCloud Downloads" />));
  await act(async () => { probe.controller!.openBrowser(); await Promise.resolve(); });
  expect(node.querySelector('[aria-label="iCloud Downloads path iCloud Downloads/"]')?.textContent).toBe('iCloud Downloads/');
  expect(node.querySelector('[aria-label="iCloud Downloads files"]')).not.toBeNull();
  await act(async () => root.render(<Harness />));
  expect(node.querySelector('[aria-label="Project path ./"]')?.textContent).toBe('./');
});

it('shows the complete open folder path through linked entry and parent navigation', async () => {
  const rootPath = '/fixture/example-notes';
  const folder = 'venepuncture-ntfgh/snaic/recommendation-materials';
  const filesPort: ProjectFilesPort = {
    listDirectory: async ({ projectId, path }) => ({ projectId, path, entries: path === 'venepuncture-ntfgh/snaic'
      ? [{ name: 'recommendation-materials', path: folder, kind: 'directory', size: 0, mtimeMs: 1 }]
      : [] }),
    readFile: vi.fn(),
  };
  await act(async () => root.render(<Harness rootPath={rootPath} filesPort={filesPort} width={260} />));
  await act(async () => { probe.controller!.openFilePath(folder); await Promise.resolve(); });
  expect(node.querySelector(`[aria-label="Project path ${rootPath}/${folder}"]`)?.textContent).toBe(`${rootPath}/${folder}`);
  await act(async () => { probe.controller!.parent(); await Promise.resolve(); });
  expect(node.querySelector(`[aria-label="Project path ${rootPath}/venepuncture-ntfgh/snaic"]`)?.textContent).toBe(`${rootPath}/venepuncture-ntfgh/snaic`);
  expect(filesPort.readFile).not.toHaveBeenCalled();
});

it('shows the registered root even at the project or shared Downloads root', async () => {
  await act(async () => root.render(<Harness rootPath="~/projects/example-notes/" />));
  await act(async () => { probe.controller!.openBrowser(); await Promise.resolve(); });
  expect([...node.querySelectorAll('[aria-label]')].find(element => element.getAttribute('aria-label') === 'Project path ~/projects/example-notes')?.textContent).toBe('~/projects/example-notes');
  await act(async () => root.render(<Harness rootLabel="iCloud Downloads" rootPath="~/icloud/Downloads" />));
  expect([...node.querySelectorAll('[aria-label]')].find(element => element.getAttribute('aria-label') === 'iCloud Downloads path ~/icloud/Downloads')?.textContent).toBe('~/icloud/Downloads');
});

it('selects a PDF in its folder and explains unsupported preview without reading the PDF', async () => {
  const readFile = vi.fn();
  const filesPort: ProjectFilesPort = {
    listDirectory: async ({ projectId, path }) => ({ projectId, path, entries: [
      { name: 'report.pdf', path: 'docs/report.pdf', kind: 'unsupported', size: 12, mtimeMs: 1 },
    ] }), readFile,
  };
  await act(async () => root.render(<Harness rootPath="/repo/notes" filesPort={filesPort} />));
  await act(async () => { probe.controller!.openFilePath('docs/report.pdf'); await Promise.resolve(); });
  expect(node.querySelector('[aria-label="Project path /repo/notes/docs"]')?.textContent).toBe('/repo/notes/docs');
  expect(node.querySelector('[aria-label="unsupported report.pdf"]')).not.toBeNull();
  expect(probe.controller!.selectedEntry?.path).toBe('docs/report.pdf');
  expect(node.textContent).toContain('Preview not supported for this file type');
  expect(node.textContent).not.toContain('preview unavailable');
  expect(readFile).not.toHaveBeenCalled();
});

it('renders every preview row and reveals only source-row crossings for word motion', async () => {
  await act(async () => root.render(<Harness />));
  await act(async () => { probe.controller!.openBrowser(); await Promise.resolve(); await Promise.resolve(); });
  act(() => probe.controller!.handleKey(hardware('enter')));
  expect(node.querySelectorAll('[data-row]')).toHaveLength(2);
  probe.scroll.length = 0;
  act(() => probe.controller!.handleKey(hardware('w')));
  expect(node.querySelector('[data-row="0"]')?.getAttribute('data-column')).toBe('6');
  expect(probe.scroll.filter(call => call.pane.startsWith('Rendered preview'))).toEqual([]);
  for (const column of [11, 17]) {
    act(() => probe.controller!.handleKey(hardware('w')));
    expect(node.querySelector('[data-row="0"]')?.getAttribute('data-column')).toBe(String(column));
  }
  act(() => probe.controller!.handleKey(hardware('w')));
  expect(node.querySelector('[data-row="1"]')?.getAttribute('data-column')).toBe('0');
  expect(probe.scroll.filter(call => call.pane.startsWith('Rendered preview'))).toEqual([{ pane: 'Rendered preview plan.md', index: 1 }]);
});

function previewProps() {
  return probe.lists.get(node.querySelector<HTMLElement>('[aria-label="Rendered preview plan.md"]')!)!;
}
function previewLayout(width: number, height = 400) {
  act(() => (previewProps().onLayout as ((event: unknown) => void) | undefined)?.({ nativeEvent: { layout: { width, height } } }));
}
function visiblePreviewRow(index: number) {
  act(() => (previewProps().onViewableItemsChanged as ((event: unknown) => void) | undefined)?.({ viewableItems: [{ index, isViewable: true }] }));
}

it('retires stale row metrics after reflow while restoring the touch reading row, not the cursor', async () => {
  await act(async () => root.render(<Harness />));
  await act(async () => { probe.controller!.openFilePath('plan.md'); await Promise.resolve(); });
  previewLayout(300);
  visiblePreviewRow(1); // Finger scrolling does not move the Vim cursor.
  expect(probe.controller!.previewNavigation.cursor.row).toBe(0);
  const mounts = probe.previewMounts;
  probe.scroll.length = 0;
  previewLayout(250);
  expect(probe.previewMounts).toBe(mounts + 1);
  expect(probe.alignments.at(-1)).toBe(0);
  expect(probe.scroll).toEqual([{ pane: 'Rendered preview plan.md', index: 1 }]);
  visiblePreviewRow(1);
  await act(async () => root.render(<Harness previewFontScale={1.2} />));
  expect(probe.previewMounts).toBe(mounts + 2);
  expect(probe.scroll.at(-1)).toEqual({ pane: 'Rendered preview plan.md', index: 1 });
  expect(probe.controller!.previewNavigation.cursor.row).toBe(0);
});

it('keeps an explicit linked line when the preview measures its initial width', async () => {
  await act(async () => root.render(<Harness />));
  await act(async () => { probe.controller!.openFilePath('plan.md', 2); await Promise.resolve(); });
  visiblePreviewRow(0); // Initial top-row layout must not replace the explicit target.
  probe.scroll.length = 0;
  previewLayout(300);
  expect(probe.scroll).toEqual([{ pane: 'Rendered preview plan.md', index: 1 }]);
});

it('retains the preview and scroll position through height, focus, and unrelated render changes', async () => {
  await act(async () => root.render(<Harness />));
  await act(async () => { probe.controller!.openFilePath('plan.md'); await Promise.resolve(); });
  previewLayout(300); visiblePreviewRow(1);
  const mounts = probe.previewMounts;
  probe.scroll.length = 0;
  previewLayout(300, 200);
  await act(async () => root.render(<Harness />));
  act(() => probe.controller!.setRegion('list'));
  act(() => probe.controller!.setRegion('preview'));
  expect(probe.previewMounts).toBe(mounts);
  expect(probe.scroll).toEqual([]);
});

it('cancels a failed reveal when reflow retires its list and when the reader starts dragging', async () => {
  const frames = new Map<number, FrameRequestCallback>(); let next = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++next, callback); return next; });
  const cancel = vi.fn((id: number) => frames.delete(id)); vi.stubGlobal('cancelAnimationFrame', cancel);
  await act(async () => root.render(<Harness />));
  await act(async () => { probe.controller!.openFilePath('plan.md'); await Promise.resolve(); });
  previewLayout(300);
  act(() => (previewProps().onScrollToIndexFailed as (event: unknown) => void)({ index: 1, averageItemLength: 20 }));
  const stale = [...frames.values()][0]!;
  expect(frames.size).toBe(1);
  previewLayout(250);
  expect(frames.size).toBe(0);
  probe.scroll.length = 0;
  act(() => stale(0)); // Even an already-dequeued callback cannot steer its replacement.
  expect(probe.scroll).toEqual([]);
  act(() => (previewProps().onScrollToIndexFailed as (event: unknown) => void)({ index: 1, averageItemLength: 20 }));
  const dragged = [...frames.values()][0]!;
  act(() => (previewProps().onScrollBeginDrag as () => void)());
  expect(frames.size).toBe(0);
  probe.scroll.length = 0; act(() => dragged(0));
  expect(probe.scroll).toEqual([]);
  act(() => (previewProps().onScrollToIndexFailed as (event: unknown) => void)({ index: 1, averageItemLength: 20 }));
  act(() => probe.controller!.close());
  expect(frames.size).toBe(0);
});

it('keeps the selected source mounted and at its cursor while returning to a scope during revalidation', async () => {
  let finishList!: (value: ProjectFileList) => void;
  let finishRead!: (value: ProjectFileContent) => void;
  const waitingList = new Promise<ProjectFileList>((resolve) => { finishList = resolve; });
  const waitingRead = new Promise<ProjectFileContent>((resolve) => { finishRead = resolve; });
  const filesPort: ProjectFilesPort = {
    listDirectory: vi.fn().mockResolvedValueOnce(list).mockResolvedValueOnce(list).mockImplementationOnce(() => waitingList).mockResolvedValue(list),
    readFile: vi.fn().mockResolvedValueOnce(file).mockResolvedValueOnce(file).mockImplementationOnce(() => waitingRead).mockResolvedValue(file),
  };
  await act(async () => root.render(<Harness scopeKey="a" filesPort={filesPort} />));
  await act(async () => { probe.controller!.openBrowser(); await Promise.resolve(); await Promise.resolve(); });
  act(() => probe.controller!.handleKey(hardware('enter')));
  act(() => probe.controller!.handleKey(hardware('j')));
  await act(async () => root.render(<Harness scopeKey="b" filesPort={filesPort} />));
  await act(async () => root.render(<Harness scopeKey="a" filesPort={filesPort} />));
  expect(node.querySelector('[aria-label="Rendered preview plan.md"]')).not.toBeNull();
  expect(node.querySelector('[data-row="1"]')?.getAttribute('data-column')).toBe('0');
  expect(node.textContent).not.toContain('loading preview…');
  expect(node.textContent).not.toContain('reading directory…');
  expect(filesPort.readFile).toHaveBeenCalledTimes(2);
  await act(async () => finishList(list));
  expect(filesPort.readFile).toHaveBeenCalledTimes(3);
  expect(node.querySelector('[aria-label="Rendered preview plan.md"]')).not.toBeNull();
  expect(node.textContent).toContain('checking file…');
  await act(async () => finishRead(file));
  expect(node.querySelector('[aria-label="Rendered preview plan.md"]')).not.toBeNull();
  expect(node.textContent).not.toContain('checking file…');
});

it('restarts a retained directory check after close and reopen, ignoring the cancelled list reply', async () => {
  let finishCancelledList!: (value: ProjectFileList) => void;
  let finishCurrentList!: (value: ProjectFileList) => void;
  let finishCurrentRead!: (value: ProjectFileContent) => void;
  const cancelledList = new Promise<ProjectFileList>((resolve) => { finishCancelledList = resolve; });
  const currentList = new Promise<ProjectFileList>((resolve) => { finishCurrentList = resolve; });
  const currentRead = new Promise<ProjectFileContent>((resolve) => { finishCurrentRead = resolve; });
  const filesPort: ProjectFilesPort = {
    listDirectory: vi.fn().mockResolvedValueOnce(list).mockResolvedValueOnce(list)
      .mockImplementationOnce(() => cancelledList).mockImplementationOnce(() => currentList),
    readFile: vi.fn().mockResolvedValueOnce(file).mockResolvedValueOnce(file)
      .mockImplementationOnce(() => currentRead),
  };
  await act(async () => root.render(<Harness scopeKey="a" filesPort={filesPort} />));
  await act(async () => { probe.controller!.openBrowser(); await Promise.resolve(); await Promise.resolve(); });
  act(() => probe.controller!.handleKey(hardware('enter')));
  act(() => probe.controller!.handleKey(hardware('j')));
  await act(async () => root.render(<Harness scopeKey="b" filesPort={filesPort} />));
  await act(async () => root.render(<Harness scopeKey="a" filesPort={filesPort} />));
  expect(node.querySelector('[aria-label="Rendered preview plan.md"]')).not.toBeNull();
  expect(filesPort.listDirectory).toHaveBeenCalledTimes(3);

  act(() => probe.controller!.close());
  act(() => probe.controller!.openBrowser());
  expect(filesPort.listDirectory).toHaveBeenCalledTimes(4);
  expect(node.querySelector('[aria-label="Rendered preview plan.md"]')).not.toBeNull();
  expect(node.querySelector('[data-row="1"]')?.getAttribute('data-column')).toBe('0');
  expect(node.textContent).toContain('checking file…');
  expect(filesPort.readFile).toHaveBeenCalledTimes(2);
  for (const key of ['j', 'y', 'y', 'i']) act(() => probe.controller!.handleKey(hardware(key)));
  expect(node.querySelector('[data-row="1"]')?.getAttribute('data-column')).toBe('0');

  await act(async () => finishCancelledList({ ...list, entries: [] }));
  expect(node.querySelector('[aria-label="Rendered preview plan.md"]')).not.toBeNull();
  expect(filesPort.readFile).toHaveBeenCalledTimes(2);
  await act(async () => finishCurrentList(list));
  expect(filesPort.readFile).toHaveBeenCalledTimes(3);
  await act(async () => finishCurrentRead({ ...file, text: 'fresh\nsecond' }));
  expect(probe.controller).toMatchObject({ previewPhase: 'ready', content: expect.objectContaining({ text: 'fresh\nsecond' }) });
  expect(node.textContent).not.toContain('checking file…');
});

it.each(['Project', 'iCloud Downloads'])('opens the loaded %s image preview in the shared viewer without another read', async (rootLabel) => {
  const image: ProjectFileContent = { projectId: 'notes', path: 'shots/phone.png', kind: 'image', mimeType: 'image/png', size: 4, mtimeMs: 1, dataBase64: 'iVBORw==' };
  const readFile = vi.fn(async () => image);
  const filesPort: ProjectFilesPort = {
    listDirectory: async ({ projectId, path }) => ({ projectId, path, entries: [{ name: 'phone.png', path: image.path, kind: 'image', mimeType: image.mimeType, size: image.size, mtimeMs: 1 }] }), readFile,
  };
  await act(async () => root.render(<Harness rootLabel={rootLabel} filesPort={filesPort} />));
  await act(async () => { probe.controller!.openFilePath(image.path); await Promise.resolve(); });
  const preview = node.querySelector<HTMLElement>('[aria-label="Preview shots/phone.png"]')!;
  expect(preview).not.toBeNull();
  expect(preview.closest('[data-pinch]')).toBeNull();
  await act(async () => preview.click());
  expect(probe.openMedia).toHaveBeenCalledWith([expect.objectContaining({ filename: 'phone.png', mimeType: 'image/png', byteCount: 4, uri: 'data:image/png;base64,iVBORw==' })], expect.any(String));
  const [attachments, initialID] = probe.openMedia.mock.calls[0]!;
  expect(initialID).toBe(attachments[0].id);
  expect(readFile).toHaveBeenCalledTimes(1);
  expect(probe.focus).toHaveBeenCalledTimes(1);
  expect(probe.controller!.region).toBe('preview');
});

function pinch(selector: string, from: number, to: number) {
  const surface = node.querySelector(selector)?.closest<HTMLElement>('[data-pinch]');
  expect(surface).toBeTruthy();
  const handlers = probe.gestures.get(surface!)!;
  const event = (distance: number, count = 2) => ({ nativeEvent: { touches: [{ pageX: 0, pageY: 0 }, ...(count === 2 ? [{ pageX: distance, pageY: 0 }] : [])] } });
  expect(handlers.onStartShouldSetResponderCapture!(event(from, 1))).toBe(false);
  expect(handlers.onStartShouldSetResponderCapture!(event(from))).toBe(true);
  act(() => { handlers.onResponderGrant!(event(from)); handlers.onResponderMove!(event(to)); handlers.onResponderRelease!(event(to)); });
}

it('routes list and text-preview pinches to their own font target without changing selection', async () => {
  await act(async () => root.render(<Harness />));
  await act(async () => { probe.controller!.openBrowser(); await Promise.resolve(); });
  pinch('[aria-label="Project file list"]', 100, 125);
  expect(probe.fontStep).toHaveBeenLastCalledWith('list', 1);
  expect(probe.controller!.region).toBe('list');
  act(() => probe.controller!.handleKey(hardware('enter')));
  act(() => probe.controller!.handleKey(hardware('j')));
  const cursor = probe.controller!.previewNavigation.cursor;
  probe.fontStep.mockClear();
  pinch('[aria-label="Rendered preview plan.md"]', 125, 100);
  expect(probe.fontStep).toHaveBeenLastCalledWith('preview', -1);
  expect(probe.controller!.region).toBe('preview');
  expect(probe.controller!.previewNavigation.cursor).toEqual(cursor);
  expect(probe.openMedia).not.toHaveBeenCalled();
});

it('does not apply hidden source keyboard actions while HTML is rendered, then restores source navigation', async () => {
  const html = { ...file, path: 'preview.html', mimeType: 'text/html', text: 'first\nsecond' };
  const filesPort: ProjectFilesPort = {
    listDirectory: async () => ({ ...list, entries: [{ ...list.entries[0]!, name: html.path, path: html.path, mimeType: html.mimeType }] }),
    readFile: async () => html,
  };
  await act(async () => root.render(<Harness filesPort={filesPort} />));
  await act(async () => { probe.controller!.openBrowser(); await Promise.resolve(); });
  act(() => probe.controller!.handleKey(hardware('enter')));
  for (const key of ['j', 'v', 'y', 'i', '?', 'q']) act(() => probe.controller!.handleKey(hardware(key)));
  expect(probe.controller!.previewNavigation.cursor.row).toBe(0);
  expect(probe.controller!.searchQuery).toBeNull(); expect(probe.controller!.open).toBe(true);
  act(() => node.querySelector<HTMLElement>('[aria-label="Show HTML source"]')!.click());
  act(() => probe.controller!.handleKey(hardware('j')));
  expect(probe.controller!.previewNavigation.cursor.row).toBe(1);
});

it('restores the directory list when navigating away from expanded HTML', async () => {
  const html = { ...file, path: 'preview.html', mimeType: 'text/html' };
  const filesPort: ProjectFilesPort = {
    listDirectory: async () => ({ ...list, entries: [{ ...list.entries[0]!, name: html.path, path: html.path, mimeType: html.mimeType }] }),
    readFile: async () => html,
  };
  await act(async () => root.render(<Harness filesPort={filesPort} />));
  await act(async () => { probe.controller!.openBrowser(); await Promise.resolve(); });
  act(() => node.querySelector<HTMLElement>('[aria-label="Expand file preview"]')!.click());
  expect(node.querySelector('[aria-label="Project file list"]')?.closest('[data-hidden]')).not.toBeNull();
  await act(async () => node.querySelector<HTMLElement>('[aria-label="Parent directory"]')!.click());
  expect(node.querySelector('[aria-label="Project file list"]')?.closest('[data-hidden]')).toBeNull();
});

it.each(['idle', 'loading', 'error'] as const)('does not reveal retained rows while the rendered directory is %s, then reveals on readiness', async (phase) => {
  await act(async () => root.render(<Harness />));
  await act(async () => { probe.controller!.openBrowser(); await Promise.resolve(); });
  const retained = { ...probe.controller!, entries: [...probe.controller!.entries] };
  const pane = (controller: ProjectFilesController) => <ProjectFilesPane controller={controller} presentation="sidebar" width={300} focused onRequestFocus={probe.focus} onOpenMedia={probe.openMedia} />;
  probe.scroll.length = 0;
  await act(async () => root.render(pane({ ...retained, phase })));
  expect(probe.scroll).toEqual([]);
  expect(node.querySelector('[aria-label="Project file list"]')?.childElementCount).toBe(0);
  await act(async () => root.render(pane({ ...retained, phase: 'ready' })));
  expect(probe.scroll).toEqual([{ pane: 'Project file list', index: 0 }]);
});

it('does not reveal a stale directory index after the visible list shrinks', async () => {
  await act(async () => root.render(<Harness />));
  await act(async () => { probe.controller!.openBrowser(); await Promise.resolve(); });
  const retained = probe.controller!;
  probe.scroll.length = 0;
  await act(async () => root.render(<ProjectFilesPane controller={{ ...retained, selectedIndex: retained.entries.length }} presentation="sidebar" width={300} focused onRequestFocus={probe.focus} onOpenMedia={probe.openMedia} />));
  expect(probe.scroll).toEqual([]);
});


it('offers touch sorting while keeping the selected file and preview', async () => {
  const filesPort: ProjectFilesPort = { ...port, listDirectory: async () => ({ ...list, entries: [
    { ...list.entries[0]!, name: 'zeta.md', path: 'zeta.md', mtimeMs: 9 },
    { ...list.entries[0]!, name: 'alpha.md', path: 'alpha.md', mtimeMs: 1 },
  ] }), readFile: async ({ path }) => ({ ...file, path }) };
  await act(async () => root.render(<Harness filesPort={filesPort} />));
  await act(async () => { probe.controller!.openBrowser(); await Promise.resolve(); });
  const selected = probe.controller!.selectedEntry!.path;
  await act(async () => node.querySelector<HTMLElement>('[aria-label="Sort files: Modified ↓"]')!.click());
  expect(node.querySelector('[aria-label="File sort options"]')).not.toBeNull();
  await act(async () => node.querySelector<HTMLElement>('[aria-label="Sort by name"]')!.click());
  expect(probe.controller!.entries.map(entry => entry.name)).toEqual(['alpha.md', 'zeta.md']);
  expect(probe.controller!.selectedEntry!.path).toBe(selected);
  expect(probe.controller!.content!.path).toBe(selected);
  expect(node.querySelector('[aria-label="File sort options"]')).toBeNull();
});


it.each(['unsupported', 'failed'] as const)('Enter shares a %s preview from either Files region without retrying the preview', async kind => {
  const entry = { name: 'archive.zip', path: 'archive.zip', kind: 'unsupported' as const, mimeType: 'application/zip', size: 10, mtimeMs: 1 };
  const readFile = vi.fn().mockRejectedValue(new Error('Preview exceeds limit'));
  const readFileForSharing = vi.fn().mockResolvedValue({ filename: entry.name, mimeType: entry.mimeType, dataBase64: 'AA==' });
  const filesPort: ProjectFilesPort = { listDirectory: async () => ({ ...list, entries: [{ ...entry, kind: kind === 'unsupported' ? 'unsupported' : 'document' }] }), readFile, readFileForSharing };
  await act(async () => root.render(<Harness filesPort={filesPort} />));
  await act(async () => probe.controller!.openBrowser());
  expect(readFileForSharing).not.toHaveBeenCalled();
  for (const region of ['list', 'preview'] as const) {
    act(() => probe.controller!.setRegion(region));
    await act(async () => probe.controller!.handleKey(hardware('enter')));
  }
  expect(readFileForSharing).toHaveBeenCalledTimes(2);
  expect(probe.share).toHaveBeenCalledTimes(2);
  expect(probe.share).toHaveBeenLastCalledWith('AA==', entry.name, entry.mimeType, expect.any(Object));
  expect(readFile).toHaveBeenCalledTimes(kind === 'unsupported' ? 0 : 1);
});


it('keeps Enter for search and valid/loading previews, and never shares a stale selection', async () => {
  const unsupported = { name: 'archive.zip', path: 'archive.zip', kind: 'unsupported' as const, mimeType: 'application/zip', size: 10, mtimeMs: 2 };
  let finish!: (value: ProjectFileContent) => void;
  const readFile = vi.fn(() => new Promise<ProjectFileContent>(resolve => { finish = resolve; }));
  const readFileForSharing = vi.fn();
  const filesPort: ProjectFilesPort = { listDirectory: async () => ({ ...list, entries: [unsupported, ...list.entries] }), readFile, readFileForSharing };
  await act(async () => root.render(<Harness filesPort={filesPort} />));
  await act(async () => probe.controller!.openBrowser());
  for (const key of ['/', 'a', 'enter', 'g', 'enter']) await act(async () => probe.controller!.handleKey(hardware(key)));
  expect(readFileForSharing).not.toHaveBeenCalled();
  // Select and press Enter before React commits the old fallback's unmount.
  act(() => { probe.controller!.select(1); probe.controller!.handleKey(hardware('enter')); });
  expect(readFileForSharing).not.toHaveBeenCalled();
  await act(async () => probe.controller!.handleKey(hardware('enter')));
  expect(readFileForSharing).not.toHaveBeenCalled();
  await act(async () => finish(file));
  act(() => probe.controller!.setRegion('list'));
  await act(async () => probe.controller!.handleKey(hardware('enter')));
  expect(probe.controller!.region).toBe('preview');
  expect(readFileForSharing).not.toHaveBeenCalled();
});

it('coalesces repeated Enter during original download and cancels when Files closes', async () => {
  const entry = { name: 'archive.zip', path: 'archive.zip', kind: 'unsupported' as const, mimeType: 'application/zip', size: 10, mtimeMs: 1 };
  let finish!: (value: { filename: string; mimeType: string; dataBase64: string }) => void;
  const readFileForSharing = vi.fn<NonNullable<ProjectFilesPort['readFileForSharing']>>(() => new Promise(resolve => { finish = resolve; }));
  const filesPort: ProjectFilesPort = { listDirectory: async () => ({ ...list, entries: [entry] }), readFile: vi.fn(), readFileForSharing };
  await act(async () => root.render(<Harness filesPort={filesPort} />));
  await act(async () => probe.controller!.openBrowser());
  for (let i = 0; i < 3; i++) await act(async () => probe.controller!.handleKey(hardware('enter')));
  expect(readFileForSharing).toHaveBeenCalledTimes(1);
  await act(async () => probe.controller!.close());
  expect(readFileForSharing.mock.calls[0]![0].signal!.aborted).toBe(true);
  await act(async () => finish({ filename: entry.name, mimeType: entry.mimeType, dataBase64: 'AA==' }));
  expect(probe.share).not.toHaveBeenCalled();
});
