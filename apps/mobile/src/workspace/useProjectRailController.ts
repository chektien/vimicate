import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HardwareKeyEvent } from '../../modules/vimicate-editor';
import { normalizedHardwareKey } from '../keyboard/hardwareKey';
import { findProjectSearchMatch } from '../search/paneSearch';
import { loadValue, saveValue } from '../storage/workspaceStore';
import { applyProjectNavigation } from './focusRouting';
import { presentWorkspaceProjects, visibleWorkspaceProjects } from './workspacePresentation';
import type { WorkspaceProject } from './workspaceTypes';
import { threadSortCommand, type ThreadSortMode } from './threadSortCommand';
import { launchGuardedBackgroundTask } from '../async/guardedBackgroundTask';

const COLLAPSED_PROJECT_KEYS = 'workspace.collapsedProjectKeys';
const PROJECT_SORT_MODE = 'workspace.projectSortMode';

export function useProjectRailController(projects: WorkspaceProject[], selectedKey: string, onActivate: (key: string) => void, onRemove: (key: string) => void) {
  const [sortMode, setSortMode] = useState<ThreadSortMode>('manual');
  const [collapsedRootKeys, setCollapsedRootKeys] = useState<Set<string>>(new Set());
  const [focusedKey, setFocusedKeyState] = useState(selectedKey);
  const focusedKeyRef = useRef(selectedKey);
  const reconciledSelectionRef = useRef(selectedKey);
  const prefixRef = useRef<'' | 'g' | 'd' | 'z'>('');
  const ordered = useMemo(() => presentWorkspaceProjects(projects, sortMode), [projects, sortMode]);
  const visible = useMemo(() => visibleWorkspaceProjects(ordered, sortMode, collapsedRootKeys), [collapsedRootKeys, ordered, sortMode]);

  const setFocusedKey = useCallback((key: string) => { focusedKeyRef.current = key; setFocusedKeyState(key); }, []);

  useEffect(() => {
    void Promise.all([loadValue(COLLAPSED_PROJECT_KEYS), loadValue(PROJECT_SORT_MODE)]).then(([folds, sort]) => {
      if (folds) {
        try { setCollapsedRootKeys(new Set((JSON.parse(folds) as unknown[]).filter((key): key is string => typeof key === 'string'))); }
        catch { setCollapsedRootKeys(new Set()); }
      }
      if (sort === 'activity' || sort === 'manual') setSortMode(sort);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    const selected = ordered.find((project) => project.sessionKey === selectedKey);
    const selectionChanged = reconciledSelectionRef.current !== selectedKey;
    // Restore the exact selected child when asynchronous startup/rebinding
    // publishes it. A still-valid browsing cursor survives ordinary refreshes.
    if ((!selectionChanged || !selected) && visible.some((project) => project.sessionKey === focusedKey)) return;
    if (selected) reconciledSelectionRef.current = selectedKey;
    const visibleSelection = visible.find((project) => project.sessionKey === selectedKey);
    const visibleParent = visible.find((project) => project.sessionKey === selected?.rootSessionKey);
    setFocusedKey(visibleSelection?.sessionKey || visibleParent?.sessionKey || visible[0]?.sessionKey || '');
  }, [focusedKey, ordered, selectedKey, setFocusedKey, visible]);

  const toggleFold = useCallback((sessionKey: string, force?: 'collapse' | 'expand') => {
    const selected = ordered.find((project) => project.sessionKey === sessionKey);
    const rootKey = selected?.rootSessionKey || selected?.sessionKey;
    if (!rootKey) return;
    setCollapsedRootKeys((current) => {
      const next = new Set(current);
      const collapse = force ? force === 'collapse' : !next.has(rootKey);
      if (collapse) next.add(rootKey); else next.delete(rootKey);
      launchGuardedBackgroundTask(() => saveValue(COLLAPSED_PROJECT_KEYS, JSON.stringify([...next])));
      return next;
    });
    if (selected?.kind === 'thread' || force === 'collapse') setFocusedKey(rootKey);
  }, [ordered, setFocusedKey]);

  const setThreadSortMode = useCallback((mode: ThreadSortMode) => {
    setSortMode(mode); launchGuardedBackgroundTask(() => saveValue(PROJECT_SORT_MODE, mode));
  }, []);
  const toggleSort = useCallback(() => setSortMode((current) => { const next = current === 'manual' ? 'activity' : 'manual'; launchGuardedBackgroundTask(() => saveValue(PROJECT_SORT_MODE, next)); return next; }), []);
  const applyThreadSortCommand = useCallback((argumentsInput: string) => {
    const result = threadSortCommand(argumentsInput, sortMode);
    if (result.mode) setThreadSortMode(result.mode);
    return result.message;
  }, [setThreadSortMode, sortMode]);

  const activate = useCallback((key: string) => { if (key) { setFocusedKey(key); onActivate(key); } }, [onActivate, setFocusedKey]);

  const handleKey = useCallback((event: HardwareKeyEvent, onClose: () => void) => {
    const keys = visible.map((project) => project.sessionKey);
    const raw = normalizedHardwareKey(event);
    if (raw === 'escape' || (raw === 'q' && !event.control && !event.command && !event.option)) {
      prefixRef.current = '';
      onClose();
      return;
    }
    if (prefixRef.current === 'z') {
      prefixRef.current = '';
      if (raw === 'a' && sortMode === 'manual') toggleFold(focusedKeyRef.current);
      return;
    }
    if (prefixRef.current === 'd' || raw === 'd') {
      const result = applyProjectNavigation(keys, { focusedKey: focusedKeyRef.current, prefix: prefixRef.current === 'd' ? 'd' : '' }, event);
      prefixRef.current = result.state.prefix;
      setFocusedKey(result.state.focusedKey);
      if (result.removeKey) onRemove(result.removeKey);
      return;
    }
    if (raw === 'z') { prefixRef.current = 'z'; return; }
    const selected = ordered.find((project) => project.sessionKey === focusedKeyRef.current);
    if (sortMode === 'manual' && (raw === 'h' || raw === 'left')) {
      if (selected?.kind === 'thread' && selected.rootSessionKey) setFocusedKey(selected.rootSessionKey);
      else if (selected && selected.threadCount > 1) toggleFold(selected.sessionKey, 'collapse');
      prefixRef.current = ''; return;
    }
    if (sortMode === 'manual' && (raw === 'l' || raw === 'right')) {
      const rootKey = selected?.rootSessionKey || selected?.sessionKey;
      if (rootKey && collapsedRootKeys.has(rootKey)) toggleFold(rootKey, 'expand');
      else if (selected?.kind !== 'thread') {
        const child = ordered.find((project) => project.kind === 'thread' && project.rootSessionKey === selected?.sessionKey);
        if (child) setFocusedKey(child.sessionKey);
      }
      prefixRef.current = ''; return;
    }
    const navigationPrefix = prefixRef.current === 'g' ? 'g' : '';
    const result = applyProjectNavigation(keys, { focusedKey: focusedKeyRef.current, prefix: navigationPrefix }, event);
    prefixRef.current = result.state.prefix;
    setFocusedKey(result.state.focusedKey);
    if (result.activateKey) activate(result.activateKey);
  }, [activate, collapsedRootKeys, onRemove, ordered, setFocusedKey, sortMode, toggleFold, visible]);

  const revealSearch = useCallback((query: string, direction: 1 | -1) => {
    const candidates = sortMode === 'manual' ? ordered : visible;
    const key = findProjectSearchMatch(candidates, query, focusedKeyRef.current, direction);
    const match = candidates.find((project) => project.sessionKey === key);
    if (match?.kind === 'thread' && match.rootSessionKey && collapsedRootKeys.has(match.rootSessionKey)) toggleFold(match.rootSessionKey, 'expand');
    setFocusedKey(key);
    return { key, matched: candidates.some((candidate) => `${candidate.name}\n${candidate.path}\n${candidate.branch}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) };
  }, [collapsedRootKeys, ordered, setFocusedKey, sortMode, toggleFold, visible]);

  return { projects: visible, orderedProjects: ordered, focusedKey, sortMode, collapsedRootKeys, setFocusedKey, toggleFold, toggleSort, applyThreadSortCommand, activate, handleKey, revealSearch };
}
