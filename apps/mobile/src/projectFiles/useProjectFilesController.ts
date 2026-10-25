import { useProjectFilePreviewLineSelection } from './useProjectFilePreviewLineSelection';
import { useProjectFileSort } from './useProjectFileSort';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HardwareKeyEvent } from '../../modules/vimicate-editor';
import type { ProjectFileContent, ProjectFileEntry } from '../gateway/projectFiles';
import { normalizedHardwareKey } from '../keyboard/hardwareKey';
import { applyTranscriptSearch, handleTranscriptKey, type TranscriptVimState } from '../transcript/transcriptVim';
import { createFileListNavigation, handleFileListKey, matchingFileIndex, parentProjectFilePath, projectFileHandoff, visibleProjectFileEntries, type FileListNavigation } from './projectFileBrowserCore';
import { ProjectFilesRequestOwner } from './projectFilesRequestOwner';
import { useProjectFilePreviewPositions } from './projectFilePreviewPositions';
import { fileViewKey, ProjectFileViewStore, type SavedFileView } from './projectFileViewStore';
import { boundedProjectFilePreviewSource, createTopPreviewNavigation, projectFilePreviewBuffer, restorePreviewNavigation } from './projectFilePreview';
import type { ProjectFilesPort } from './projectFilesTypes';

export { PROJECT_FILE_PREVIEW_MAX_LINES, PROJECT_FILE_PREVIEW_MAX_CHARACTERS, boundedProjectFilePreviewSource } from './projectFilePreview';

export type ProjectFilesController = ReturnType<typeof useProjectFilesController>;
type LinkedFileOpen = { projectId: string; scopeKey: string; path: string; line?: number };

export function useProjectFilesController({ projectId, scopeKey = projectId, port, active = true, initiallyOpen = false, closeOnHandoff = false, onStatus, onYank, onHandoff, onClose }: {
  projectId: string;
  scopeKey?: string;
  port: ProjectFilesPort | null;
  /** Selected Files location; inactive owners retain state but do not resume I/O on thread changes. */
  active?: boolean;
  initiallyOpen?: boolean;
  closeOnHandoff?: boolean;
  onStatus: (detail: string) => void;
  onYank: (text: string) => void;
  onHandoff: (payload: { text: string; caretOffset: number; path: string }) => void;
  onClose: () => void;
}) {
  const activeRef = useRef(active); activeRef.current = active;
  const [open, setOpen] = useState(false);
  const [resumeRevision, setResumeRevision] = useState(0);
  const directoryChecking = useRef(false);
  const openRef = useRef(false);
  const [path, setPath] = useState('');
  const pathRef = useRef('');
  const [entries, setEntries] = useState<ProjectFileEntry[]>([]);
  const [showHidden, setShowHidden] = useState(true); const showHiddenRef = useRef(showHidden); showHiddenRef.current = showHidden;
  const [navigation, setNavigation] = useState<FileListNavigation>(createFileListNavigation);
  const navigationRef = useRef(navigation); navigationRef.current = navigation;
  const [region, setRegion] = useState<'list' | 'preview'>('list');
  const regionRef = useRef(region); regionRef.current = region;
  const publishRegion = (next: 'list' | 'preview') => { regionRef.current = next; setRegion(next); };
  const nativePreviewRef = useRef<{ projectId: string; scopeKey: string; path: string } | null>(null);
  const [helpVisible, setHelpVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState<string | null>(null);
  const searchRef = useRef<string | null>(null);
  const searchDirection = useRef<1 | -1>(1);
  const lastSearch = useRef('');
  const lastSearchDirection = useRef<1 | -1>(1);
  const publishSearch = (query: string | null) => { searchRef.current = query; setSearchQuery(query); };
  const [phase, setPhase] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const phaseRef = useRef(phase); phaseRef.current = phase;
  const publishPhase = (next: typeof phase) => { phaseRef.current = next; setPhase(next); };
  const [problem, setProblem] = useState('');
  const [content, setContent] = useState<ProjectFileContent | null>(null);
  const contentRef = useRef(content); contentRef.current = content;
  const [previewPhase, setPreviewPhase] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const previewPhaseRef = useRef(previewPhase); previewPhaseRef.current = previewPhase;
  const [previewProblem, setPreviewProblem] = useState('');
  const [contentScope, setContentScope] = useState('');
  const [previewNavigation, setPreviewNavigation] = useState<TranscriptVimState>(() => createTopPreviewNavigation(''));
  const previewNavigationRef = useRef(previewNavigation); previewNavigationRef.current = previewNavigation;
  const listRequests = useRef(new ProjectFilesRequestOwner()); const previewRequests = useRef(new ProjectFilesRequestOwner());
  const linkedFileOpenRef = useRef<LinkedFileOpen | null>(null);
  const savedViews = useRef(new ProjectFileViewStore());
  const pendingRestoreSelection = useRef<string | null>(null);
  const pendingRestoreRegion = useRef<'list' | 'preview'>('list');
  const restorePreviewPath = useRef<string | null>(null);
  const projectRef = useRef(projectId); projectRef.current = projectId; const scopeRef = useRef(scopeKey); scopeRef.current = scopeKey;
  const stateScopeRef = useRef({ projectId, scopeKey });
  const portRef = useRef(port); portRef.current = port;
  const stateProjectIsCurrent = stateScopeRef.current.projectId === projectId;
  const stateScopeIsCurrent = stateProjectIsCurrent && stateScopeRef.current.scopeKey === scopeKey;
  const sorting = useProjectFileSort(entries, showHidden, navigationRef, setNavigation, () => openRef.current && activeRef.current && stateScopeIsCurrent && !directoryChecking.current);
  const { orderRef: sortRef, dismiss: dismissSort } = sorting;
  const visibleEntries = useMemo(() => visibleProjectFileEntries(stateProjectIsCurrent ? entries : [], showHidden, sorting.order), [entries, showHidden, stateProjectIsCurrent, sorting.order]);
  const selectedEntry = visibleEntries[navigation.index] ?? null;
  const visibleContent = stateScopeIsCurrent
    && content?.projectId === projectId && contentScope === scopeKey && content.path === selectedEntry?.path ? content : null;
  const previewPositions = useProjectFilePreviewPositions(visibleContent, previewPhase === 'ready', scopeKey, previewNavigation, lastSearch, lastSearchDirection);

  const setNativePreviewActive = useCallback((active: boolean) => {
    nativePreviewRef.current = active && contentRef.current ? { projectId: projectRef.current, scopeKey: scopeRef.current, path: contentRef.current.path } : null;
    if (active) { searchRef.current = null; setSearchQuery(null); }
  }, []);

  const close = useCallback(() => {
    dismissSort(); openRef.current = false;
    listRequests.current.invalidate(); previewRequests.current.invalidate();
    if (directoryChecking.current) {
      directoryChecking.current = false;
      pendingRestoreSelection.current = restorePreviewPath.current ?? contentRef.current?.path ?? null;
      pendingRestoreRegion.current = regionRef.current;
      publishPhase('idle');
    }
    linkedFileOpenRef.current = null;
    const list = { ...navigationRef.current, pending: '' as const, count: '' };
    const preview = { ...previewNavigationRef.current, visualMode: null, anchor: null, pending: '' as const, count: '' };
    navigationRef.current = list; previewNavigationRef.current = preview;
    setOpen(false); setNavigation(list); setPreviewNavigation(preview); publishSearch(null);
    onClose();
  }, [onClose]);

  const loadDirectory = useCallback(async (nextPath: string, linkedFile?: { path: string; line?: number }, selectedPath?: string | null, restoredRegion: 'list' | 'preview' = 'list', preservePreview = false): Promise<void> => {
    if (!openRef.current) return;
    dismissSort();
    const activePort = portRef.current; const expectedProject = projectRef.current; const expectedScope = scopeRef.current;
    const request = listRequests.current.begin(); previewRequests.current.invalidate();
    directoryChecking.current = preservePreview;
    const requestedFile = linkedFile ? { ...linkedFile, projectId: expectedProject, scopeKey: expectedScope } : null;
    pendingRestoreSelection.current = null;
    pendingRestoreRegion.current = 'list';
    restorePreviewPath.current = selectedPath ?? null;
    linkedFileOpenRef.current = requestedFile;
    pathRef.current = nextPath; setPath(nextPath);
    if (!preservePreview) { setEntries([]); setContent(null); setContentScope(''); setPreviewPhase('idle'); }
    publishPhase(preservePreview ? 'ready' : 'loading'); setProblem(''); setPreviewProblem(''); publishRegion(requestedFile ? 'preview' : restoredRegion); publishSearch(null);
    if (!activePort || !expectedProject) { request.finish(); directoryChecking.current = false; linkedFileOpenRef.current = null; setEntries([]); setContent(null); setContentScope(''); setPreviewPhase('idle'); publishPhase('error'); setProblem('Project files are unavailable.'); return; }
    try {
      const result = await activePort.listDirectory({ projectId: expectedProject, path: nextPath, signal: request.signal });
      if (!request.current() || !openRef.current || projectRef.current !== expectedProject || scopeRef.current !== expectedScope) return; if (result.projectId !== expectedProject || result.path !== nextPath) throw new Error('Invalid project file list response.');
      directoryChecking.current = false;
      if (requestedFile) {
        const entry = result.entries.find((candidate) => candidate.path === requestedFile.path);
        if (!entry) {
          linkedFileOpenRef.current = null;
          const selected = { ...createFileListNavigation(), index: -1 };
          navigationRef.current = selected; setNavigation(selected); setEntries(result.entries); publishPhase('ready'); publishRegion('list');
          setProblem(`Linked file is not listed by the Gateway. Showing its folder: ${requestedFile.path}`);
          return;
        }
        if (entry.kind === 'directory') {
          // Enter the folder without previewing a file as a link side effect;
          // the new listing owns cancellation under the same project scope.
          void loadDirectory(entry.path, undefined, '');
          return;
        }
        const revealHidden = entry.name.startsWith('.');
        if (revealHidden) { showHiddenRef.current = true; setShowHidden(true); }
        const visible = visibleProjectFileEntries(result.entries, revealHidden || showHiddenRef.current, sortRef.current);
        const selected = { ...createFileListNavigation(), index: visible.findIndex((candidate) => candidate.path === requestedFile.path) };
        navigationRef.current = selected; setEntries(result.entries); setNavigation(selected); publishPhase('ready');
      } else {
        const visible = visibleProjectFileEntries(result.entries, showHiddenRef.current, sortRef.current);
        const index = selectedPath === undefined || selectedPath === null ? 0 : visible.findIndex((entry) => entry.path === selectedPath);
        const selected = { ...createFileListNavigation(), index };
        if (index < 0) {
          previewRequests.current.invalidate(); restorePreviewPath.current = null; const top = createTopPreviewNavigation(''); previewNavigationRef.current = top; setPreviewNavigation(top); publishRegion('list'); setContent(null); setContentScope(''); setPreviewPhase('idle');
        }
        navigationRef.current = selected; setEntries(result.entries); setNavigation(selected); publishPhase('ready');
      }
      if (preservePreview) setResumeRevision((current) => current + 1);
    } catch (error) {
      if (!request.current() || !openRef.current || projectRef.current !== expectedProject || scopeRef.current !== expectedScope) return;
      linkedFileOpenRef.current = null;
      directoryChecking.current = false;
      previewRequests.current.invalidate(); setEntries([]); setContent(null); setContentScope(''); setPreviewPhase('idle'); publishPhase('error'); setProblem(errorDetail(error, 'Could not read this directory.'));
    } finally { request.finish(); }
  }, []);

  const openBrowser = useCallback(() => {
    if (openRef.current) { publishRegion('list'); return; }
    openRef.current = true; setOpen(true); setResumeRevision((current) => current + 1);
    if (phaseRef.current !== 'ready') void loadDirectory(pathRef.current, undefined, pendingRestoreSelection.current, pendingRestoreRegion.current, Boolean(contentRef.current));
  }, [loadDirectory]);

  const openFilePath = useCallback((filePath: string, line?: number) => {
    openRef.current = true; setOpen(true); setResumeRevision((current) => current + 1);
    void loadDirectory(parentProjectFilePath(filePath), filePath ? { path: filePath, ...(line === undefined ? {} : { line }) } : undefined);
  }, [loadDirectory]);

  const refresh = useCallback(() => { if (openRef.current) void loadDirectory(pathRef.current); }, [loadDirectory]);

  useEffect(() => {
    const previous = stateScopeRef.current;
    if (previous.projectId === projectId && previous.scopeKey === scopeKey) return;
    dismissSort();
    const wasOpen = openRef.current && activeRef.current;
    if (previous.projectId) {
      const key = fileViewKey(previous.projectId, previous.scopeKey);
      const visible = visibleProjectFileEntries(entries, showHiddenRef.current, sortRef.current);
      const prior = savedViews.current.get(key);
      const selectedPath = visible[navigationRef.current.index]?.path ?? (prior?.path === pathRef.current ? prior.selectedPath : null) ?? restorePreviewPath.current;
      const retainedContent = previewPhaseRef.current === 'ready' && contentScope === previous.scopeKey
        && contentRef.current?.projectId === previous.projectId && contentRef.current.path === selectedPath ? contentRef.current : null;
      const saved: SavedFileView = { path: pathRef.current, selectedPath,
        showHidden: showHiddenRef.current, region: regionRef.current, helpVisible,
        previewNavigation: { ...previewNavigationRef.current, visualMode: null, anchor: null, pending: '', count: '' },
        lastSearch: lastSearch.current, lastSearchDirection: lastSearchDirection.current,
        entries: phaseRef.current === 'ready' ? entries : phaseRef.current === 'loading' && prior?.path === pathRef.current ? prior.entries : null,
        content: retainedContent ?? (previewPhaseRef.current === 'loading' && prior?.path === pathRef.current && prior.selectedPath === selectedPath ? prior.content : null) };
      savedViews.current.set(key, saved);
    }
    listRequests.current.invalidate(); previewRequests.current.invalidate();
    directoryChecking.current = false;
    linkedFileOpenRef.current = null;
    stateScopeRef.current = { projectId, scopeKey };
    const saved = savedViews.current.get(fileViewKey(projectId, scopeKey));
    if (saved) {
      const first = createFileListNavigation();
      navigationRef.current = first; previewNavigationRef.current = saved.previewNavigation; pathRef.current = saved.path;
      showHiddenRef.current = saved.showHidden; pendingRestoreSelection.current = saved.selectedPath; pendingRestoreRegion.current = saved.region;
      lastSearch.current = saved.lastSearch; lastSearchDirection.current = saved.lastSearchDirection;
      const visible = visibleProjectFileEntries(saved.entries ?? [], saved.showHidden, sortRef.current);
      const selectedIndex = saved.selectedPath === null ? -1 : visible.findIndex((entry) => entry.path === saved.selectedPath);
      const restored = { ...first, index: selectedIndex }; navigationRef.current = restored;
      const retained = selectedIndex >= 0 && saved.content?.path === saved.selectedPath && saved.content.projectId === projectId ? saved.content : null;
      setPath(saved.path); setEntries(saved.entries ?? []); setShowHidden(saved.showHidden); setNavigation(restored); publishPhase(wasOpen && saved.entries ? 'ready' : 'idle'); setProblem('');
      setHelpVisible(saved.helpVisible); publishRegion(saved.region); setContent(retained); setContentScope(retained ? scopeKey : ''); setPreviewPhase(retained ? 'loading' : 'idle'); setPreviewProblem(''); setPreviewNavigation(saved.previewNavigation);
      publishSearch(null);
      if (wasOpen) void loadDirectory(saved.path, undefined, saved.selectedPath, saved.region, Boolean(saved.entries));
      return;
    }
    const first = createFileListNavigation(); const top = createTopPreviewNavigation('');
    navigationRef.current = first; previewNavigationRef.current = top; pathRef.current = '';
    pendingRestoreSelection.current = null; pendingRestoreRegion.current = 'list'; restorePreviewPath.current = null;
    showHiddenRef.current = true;
    setPath(''); setEntries([]); setShowHidden(true); setNavigation(first); publishPhase('idle'); setProblem('');
    setHelpVisible(false); publishRegion('list'); setContent(null); setContentScope(''); setPreviewPhase('idle'); setPreviewProblem(''); setPreviewNavigation(top);
    publishSearch(null); lastSearch.current = '';
    lastSearchDirection.current = 1;
    if (wasOpen) void loadDirectory('');
  }, [projectId, scopeKey, loadDirectory]);

  useEffect(() => {
    if (!active || !open || !stateScopeIsCurrent || directoryChecking.current) { previewRequests.current.invalidate(); return; }
    if (!selectedEntry || selectedEntry.kind === 'directory' || selectedEntry.kind === 'unsupported') {
      previewRequests.current.invalidate(); setContent(null); setContentScope(''); setPreviewPhase('idle'); setPreviewProblem(''); return;
    }
    const activePort = portRef.current; const expectedProject = projectRef.current; const expectedScope = scopeRef.current; const expectedPath = selectedEntry.path;
    if (!activePort || !expectedProject) return;
    const sameFile = contentRef.current?.projectId === expectedProject && contentRef.current.path === expectedPath;
    const currentForScope = sameFile && contentScope === expectedScope;
    const linkedFile = linkedFileOpenRef.current;
    const linkedSelection = linkedFile?.projectId === expectedProject && linkedFile.scopeKey === expectedScope && linkedFile.path === expectedPath ? linkedFile : null;
    if (linkedFile && !linkedSelection) linkedFileOpenRef.current = null;
    const request = previewRequests.current.begin();
    if (!currentForScope) { if (!sameFile) setContent(null); setContentScope(''); }
    setPreviewPhase('loading'); setPreviewProblem('');
    void activePort.readFile({ projectId: expectedProject, path: expectedPath, signal: request.signal }).then((result) => {
      if (!request.current() || !openRef.current || projectRef.current !== expectedProject || scopeRef.current !== expectedScope) return; if (result.projectId !== expectedProject || result.path !== expectedPath) throw new Error('Invalid project file response.');
      setContent(result); setContentScope(expectedScope); setPreviewPhase('ready');
      if (result.kind === 'text') {
        const source = boundedProjectFilePreviewSource(result.text).source;
        const applyLinkedLine = linkedSelection !== null && linkedFileOpenRef.current === linkedSelection;
        const retained = sameFile || restorePreviewPath.current === expectedPath;
        const remembered = !retained ? previewPositions.restore(expectedProject, expectedScope, expectedPath, source) : null;
        const next = applyLinkedLine ? createTopPreviewNavigation(source, linkedSelection.line) : retained ? restorePreviewNavigation(source, previewNavigationRef.current) : remembered?.navigation ?? createTopPreviewNavigation(source);
        if (!retained) { lastSearch.current = remembered?.query ?? ''; lastSearchDirection.current = remembered?.direction ?? 1; }
        previewNavigationRef.current = next; setPreviewNavigation(next);
      }
      restorePreviewPath.current = null;
      if (linkedFileOpenRef.current === linkedSelection) linkedFileOpenRef.current = null;
    }).catch((error: unknown) => {
      if (!request.current() || !openRef.current || projectRef.current !== expectedProject || scopeRef.current !== expectedScope) return;
      if (linkedFileOpenRef.current === linkedSelection) linkedFileOpenRef.current = null;
      setContent(null); setContentScope(''); setPreviewPhase('error'); setPreviewProblem(errorDetail(error, `Could not open ${expectedPath}.`));
    }).finally(request.finish);
  }, [active, open, resumeRevision, scopeKey, stateScopeIsCurrent, selectedEntry?.kind, selectedEntry?.path]); // selected file is revalidated on every resume and thread handoff

  useEffect(() => {
    if (navigation.index < visibleEntries.length || !navigation.index) return;
    const next = { index: Math.max(0, visibleEntries.length - 1), pending: '' as const, count: '' };
    navigationRef.current = next; setNavigation(next);
  }, [navigation.index, visibleEntries.length]);

  useEffect(() => {
    if (initiallyOpen) openBrowser();
    return () => { listRequests.current.invalidate(); previewRequests.current.invalidate(); };
  }, []); // fixture-only initial authority

  const select = useCallback((index: number) => {
    if (directoryChecking.current) return; linkedFileOpenRef.current = null;
    restorePreviewPath.current = null;
    const next = { index: Math.max(0, Math.min(visibleEntries.length - 1, index)), pending: '' as const, count: '' };
    if (visibleEntries[navigationRef.current.index]?.path !== visibleEntries[next.index]?.path) previewRequests.current.invalidate();
    navigationRef.current = next; setNavigation(next); publishRegion('list');
  }, [visibleEntries]);

  const openEntry = useCallback((index: number) => {
    if (directoryChecking.current) return; const entry = visibleEntries[index];
    if (!entry) return;
    const retryPreview = previewPhaseRef.current === 'error' && visibleEntries[navigationRef.current.index]?.path === entry.path;
    select(index);
    if (entry.kind === 'directory') void loadDirectory(entry.path);
    else { if (retryPreview) setResumeRevision(current => current + 1); publishRegion('preview'); }
  }, [visibleEntries, select, loadDirectory]);

  const parent = () => { if (openRef.current) void loadDirectory(parentProjectFilePath(pathRef.current)); };

  const selectPreviewLine = useProjectFilePreviewLineSelection(visibleContent, previewPhase === 'ready', previewNavigationRef, setPreviewNavigation, publishRegion);

  const handleKey = useCallback((event: HardwareKeyEvent) => {
    if (!openRef.current) return false;
    if (sorting.handleKey(event)) return true;
    const key = normalizedHardwareKey(event);
    const escape = key === 'escape' || (event.control && event.key === '[');
    const quit = !event.control && !event.command && !event.option && key === 'q';
    const search = (query: string, direction: 1 | -1, rememberDirection = false) => {
      if (!query) return;
      if (regionRef.current === 'preview') {
        if (content?.kind !== 'text' || content.projectId !== projectRef.current || contentScope !== scopeRef.current || content.path !== selectedEntry?.path || previewPhase !== 'ready') return;
        lastSearch.current = query; if (rememberDirection) lastSearchDirection.current = direction;
        const buffer = projectFilePreviewBuffer(boundedProjectFilePreviewSource(content.text).source, content.path);
        const found = applyTranscriptSearch(buffer, previewNavigationRef.current, query, direction);
        previewNavigationRef.current = found.state; setPreviewNavigation(found.state);
        if (!found.matched) onStatus(`No match: ${query}`);
      } else {
        if (phaseRef.current !== 'ready' || directoryChecking.current) return;
        lastSearch.current = query; if (rememberDirection) lastSearchDirection.current = direction;
        const index = matchingFileIndex(visibleEntries, navigationRef.current.index, query, direction);
        if (index >= 0) { select(index); return; }
        onStatus(`No match: ${query}`);
      }
    };
    if (searchRef.current !== null) {
      if (escape) publishSearch(null);
      else if (key === 'enter') { search(searchRef.current, searchDirection.current, true); publishSearch(null); }
      else if (key === 'backspace') publishSearch([...searchRef.current].slice(0, -1).join(''));
      else if (!event.control && !event.command && !event.option && (key === 'space' || [...key].length === 1)) publishSearch((searchRef.current + (key === 'space' ? ' ' : key)).slice(0, 256));
      return true;
    }
    if (event.control && !event.command && !event.option && (key === 'j' || key === 'down')) { publishRegion('preview'); return true; }
    if (event.control && !event.command && !event.option && (key === 'k' || key === 'up')) { publishRegion('list'); return true; }
    // Rendered HTML owns interaction. Never yank/edit/move a hidden source cursor.
    const native = nativePreviewRef.current;
    if (regionRef.current === 'preview' && native?.projectId === projectRef.current && native?.scopeKey === scopeRef.current
      && native?.path === content?.path && content?.kind === 'text' && content.mimeType === 'text/html') {
      if (escape) close();
      else if (event.control && key.toLowerCase() === 'r') refresh();
      return true;
    }
    const pendingHelp = regionRef.current === 'preview' ? previewNavigationRef.current.pending === 'g' : navigationRef.current.pending === 'g';
    if (!event.control && !event.command && !event.option && (key === '/' || (key === '?' && !pendingHelp))) {
      searchDirection.current = key === '?' ? -1 : 1; publishSearch(''); return true;
    }
    if (!event.control && !event.command && !event.option && (key === 'n' || key === 'N') && lastSearch.current) {
      search(lastSearch.current, key === 'N' ? lastSearchDirection.current === 1 ? -1 : 1 : lastSearchDirection.current); return true;
    }
    if (regionRef.current === 'preview') {
      if (escape || quit) {
        if (previewNavigationRef.current.visualMode || previewNavigationRef.current.pending || previewNavigationRef.current.count) {
          const source = content?.kind === 'text' ? boundedProjectFilePreviewSource(content.text).source : '';
          const next = handleTranscriptKey(projectFilePreviewBuffer(source, content?.path ?? 'preview'), previewNavigationRef.current, { ...event, key: 'escape', control: false }).state;
          previewNavigationRef.current = next; setPreviewNavigation(next);
        } else close();
        return true;
      }
      if (event.control && event.key.toLowerCase() === 'r') { refresh(); return true; }
      if (!event.control && !event.command && !event.option && key === '-') { void loadDirectory(parentProjectFilePath(pathRef.current)); return true; }
      if (!event.control && !event.command && !event.option && key === '_') { void loadDirectory(''); return true; }
      if (!event.control && !event.command && !event.option && key === 'tab') { publishRegion('list'); return true; }
      if (previewNavigationRef.current.pending === 'g' && !event.control && !event.command && !event.option && (key === '?' || key === '.')) {
        const source = content?.kind === 'text' ? boundedProjectFilePreviewSource(content.text).source : '';
        const buffer = projectFilePreviewBuffer(source, content?.path ?? 'preview');
        const next = handleTranscriptKey(buffer, previewNavigationRef.current, { key: 'escape', shift: false, control: false, option: false, command: false }).state;
        previewNavigationRef.current = next; setPreviewNavigation(next);
        if (key === '?') setHelpVisible((current) => !current);
        else setShowHidden((current) => !current);
        return true;
      }
      // Settled non-text previews return navigation to the list.
      const navigable = previewPhase === 'ready' && content?.projectId === projectRef.current && contentScope === scopeRef.current
        && content.path === selectedEntry?.path && content.kind === 'text';
      // Loading and revalidating reads keep the preview and swallow keys so
      // the cursor resumes on the fresh read.
      const settledWithoutNavigation = previewPhase === 'error'
        || previewPhase === 'ready' && content?.path === selectedEntry?.path && content?.kind !== 'text';
      if (!navigable && !settledWithoutNavigation) return true;
      if (!navigable) publishRegion('list');
      else {
      const bounded = boundedProjectFilePreviewSource(content.text);
      const buffer = projectFilePreviewBuffer(bounded.source, content.path);
      const result = handleTranscriptKey(buffer, previewNavigationRef.current, event);
      previewNavigationRef.current = result.state; setPreviewNavigation(result.state);
      if (previewPhase === 'ready' && result.effect.type === 'yank' && result.effect.text) { onYank(result.effect.text); onStatus(`${result.effect.text.split('\n').length} source line${result.effect.text.includes('\n') ? 's' : ''} yanked`); }
      if (previewPhase === 'ready' && result.effect.type === 'handoff') {
        const cursor = previewNavigationRef.current.cursor;
        const payload = projectFileHandoff(content.text, content.path, cursor.row, cursor.column, result.effect.variant);
        onHandoff({ ...payload, path: content.path });
        if (closeOnHandoff) close();
      }
      return true;
      }
    }
    if (directoryChecking.current && !escape && !quit && !(event.control && key.toLowerCase() === 'r')) return true; const result = handleFileListKey(navigationRef.current, event, visibleEntries.length);
    navigationRef.current = result.state; setNavigation(result.state);
    if (result.effect === 'close') close();
    if (result.effect === 'refresh') refresh();
    if (result.effect === 'parent') void loadDirectory(parentProjectFilePath(pathRef.current));
    if (result.effect === 'root') void loadDirectory('');
    if (result.effect === 'toggle-hidden') setShowHidden((current) => !current);
    if (result.effect === 'sort') sorting.toggle();
    if (result.effect === 'toggle-help') setHelpVisible((current) => !current);
    if (result.effect === 'open') openEntry(result.state.index);
    return true;
  }, [close, closeOnHandoff, content, contentScope, loadDirectory, onHandoff, onStatus, onYank, openEntry, previewPhase, refresh, select, selectedEntry?.path, visibleEntries, sorting]);

  return { projectId, scopeKey, readFileForSharing: port?.readFileForSharing, sorting, open, openBrowser, openFilePath, close, refresh, parent, openEntry, path: stateProjectIsCurrent ? path : '', entries: visibleEntries, selectedIndex: navigation.index, selectedEntry, select, showHidden, phase, problem, content: visibleContent, previewPhase, previewProblem, previewNavigation, selectPreviewLine, setNativePreviewActive, region, setRegion: publishRegion, helpVisible, setHelpVisible, searchQuery, searchDirection: searchDirection.current, handleKey };
}

function errorDetail(error: unknown, fallback: string) { return error instanceof Error && error.message ? error.message : fallback; }
