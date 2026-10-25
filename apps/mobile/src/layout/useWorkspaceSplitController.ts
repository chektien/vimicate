import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder } from 'react-native';
import { loadValue, saveValue } from '../storage/workspaceStore';
import { clampedPromptHeight, DEFAULT_PROMPT_HEIGHT, resizedPromptHeight, workspacePersistenceSizeClass } from './workspaceSplit';
import { launchGuardedBackgroundTask } from '../async/guardedBackgroundTask';

const STORAGE_PREFIX = 'workspace.promptHeight';

export function useWorkspaceSplitController(stableViewportHeight = 0) {
  const [availableHeight, setAvailableHeight] = useState(0);
  const [promptHeight, setPromptHeight] = useState(DEFAULT_PROMPT_HEIGHT);
  const availableHeightRef = useRef(0);
  const promptHeightRef = useRef(DEFAULT_PROMPT_HEIGHT);
  const dragStartHeight = useRef(DEFAULT_PROMPT_HEIGHT);
  const loadedSizeClass = useRef('');

  const commitHeight = useCallback((requested: number, persist = true) => {
    const next = clampedPromptHeight(requested, availableHeightRef.current || 900);
    promptHeightRef.current = next;
    setPromptHeight(next);
    if (persist && availableHeightRef.current) launchGuardedBackgroundTask(() => saveValue(`${STORAGE_PREFIX}.${workspacePersistenceSizeClass(availableHeightRef.current, stableViewportHeight)}`, String(next)));
  }, [stableViewportHeight]);

  const onLayoutHeight = useCallback((height: number) => {
    if (!Number.isFinite(height) || height <= 0) return;
    availableHeightRef.current = height;
    setAvailableHeight(height);
    const sizeClass = workspacePersistenceSizeClass(height, stableViewportHeight);
    if (loadedSizeClass.current === sizeClass) {
      commitHeight(promptHeightRef.current, false);
      return;
    }
    loadedSizeClass.current = sizeClass;
    void loadValue(`${STORAGE_PREFIX}.${sizeClass}`).then((stored) => {
      if (loadedSizeClass.current !== sizeClass) return;
      const parsed = Number(stored);
      commitHeight(Number.isFinite(parsed) ? parsed : DEFAULT_PROMPT_HEIGHT, false);
    }).catch(() => commitHeight(DEFAULT_PROMPT_HEIGHT, false));
  }, [commitHeight, stableViewportHeight]);

  const resize = useCallback((direction: 1 | -1) => {
    commitHeight(resizedPromptHeight(promptHeightRef.current, direction, availableHeightRef.current || 900));
  }, [commitHeight]);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dy) >= 2,
    onPanResponderGrant: () => { dragStartHeight.current = promptHeightRef.current; },
    onPanResponderMove: (_event, gesture) => commitHeight(dragStartHeight.current - gesture.dy, false),
    onPanResponderRelease: () => commitHeight(promptHeightRef.current),
    onPanResponderTerminate: () => commitHeight(promptHeightRef.current),
  }), [commitHeight]);

  useEffect(() => { if (availableHeight) commitHeight(promptHeightRef.current, false); }, [availableHeight, commitHeight]);

  return { promptHeight, onLayoutHeight, resize, dividerPanHandlers: panResponder.panHandlers };
}
