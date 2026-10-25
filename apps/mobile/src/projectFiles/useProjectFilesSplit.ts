import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder } from 'react-native';
import { loadValue, saveValue } from '../storage/workspaceStore';
import {
  DEFAULT_PROJECT_FILES_LIST_RATIO,
  parsedProjectFilesListRatio,
  projectFilesListRatioForHeight,
  projectFilesSplitGeometry,
  resizedProjectFilesListRatio,
  serializedProjectFilesListRatio,
} from './projectFilesSplit';

export const PROJECT_FILES_SPLIT_KEY = 'ui.projectFiles.split.v1';

export function useProjectFilesSplit(active = true) {
  const [availableHeight, setAvailableHeight] = useState(0);
  const [listRatio, setListRatio] = useState(DEFAULT_PROJECT_FILES_LIST_RATIO);
  const availableHeightRef = useRef(0);
  const listRatioRef = useRef(DEFAULT_PROJECT_FILES_LIST_RATIO);
  const dragStartListHeightRef = useRef(0);
  const dragStartRatioRef = useRef(DEFAULT_PROJECT_FILES_LIST_RATIO);
  const dragStartTouchedRef = useRef(false);
  const draggingRef = useRef(false);
  const pendingRestoredRatioRef = useRef<number | null>(null);
  const touchedRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    let active = true;
    void loadValue(PROJECT_FILES_SPLIT_KEY).then((stored) => {
      const restored = parsedProjectFilesListRatio(stored);
      if (!active || touchedRef.current || restored === null) return;
      if (draggingRef.current) { pendingRestoredRatioRef.current = restored; return; }
      listRatioRef.current = restored;
      setListRatio(restored);
    }).catch(() => undefined);
    return () => { active = false; mountedRef.current = false; };
  }, []);

  const onLayoutHeight = useCallback((height: number) => {
    if (!Number.isFinite(height) || height <= 0 || !mountedRef.current) return;
    availableHeightRef.current = height;
    setAvailableHeight(height);
  }, []);

  const publishRatio = useCallback((next: number, touched = true) => {
    if (!mountedRef.current) return;
    touchedRef.current = touched;
    listRatioRef.current = next;
    setListRatio(next);
  }, []);

  const persist = useCallback((next: number) => {
    if (!mountedRef.current) return;
    void saveValue(PROJECT_FILES_SPLIT_KEY, serializedProjectFilesListRatio(next)).catch(() => undefined);
  }, []);

  const updateFromDrag = useCallback((travel: number) => {
    const next = projectFilesListRatioForHeight(dragStartListHeightRef.current + travel, availableHeightRef.current, dragStartRatioRef.current);
    publishRatio(next);
    return next;
  }, [publishRatio]);

  const cancelDrag = useCallback(() => {
    draggingRef.current = false;
    const restored = pendingRestoredRatioRef.current;
    pendingRestoredRatioRef.current = null;
    if (restored !== null && !dragStartTouchedRef.current) publishRatio(restored, false);
    else publishRatio(dragStartRatioRef.current, dragStartTouchedRef.current);
  }, [publishRatio]);

  const resize = useCallback((direction: 1 | -1) => {
    draggingRef.current = false;
    pendingRestoredRatioRef.current = null;
    const next = resizedProjectFilesListRatio(listRatioRef.current, direction, availableHeightRef.current);
    publishRatio(next);
    persist(next);
  }, [persist, publishRatio]);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dy) >= 2,
    onPanResponderGrant: () => {
      draggingRef.current = true;
      dragStartRatioRef.current = listRatioRef.current;
      dragStartTouchedRef.current = touchedRef.current;
      dragStartListHeightRef.current = projectFilesSplitGeometry(availableHeightRef.current, listRatioRef.current).listHeight;
    },
    onPanResponderMove: (_event, gesture) => {
      if (Math.abs(gesture.dy) >= 2) {
        pendingRestoredRatioRef.current = null;
        updateFromDrag(gesture.dy);
      }
    },
    onPanResponderRelease: (_event, gesture) => {
      if (Math.abs(gesture.dy) < 2) { cancelDrag(); return; }
      draggingRef.current = false;
      pendingRestoredRatioRef.current = null;
      persist(updateFromDrag(gesture.dy));
    },
    onPanResponderTerminate: cancelDrag,
    onPanResponderTerminationRequest: () => false,
  }), [cancelDrag, persist, updateFromDrag]);

  useEffect(() => {
    if (!active && draggingRef.current) cancelDrag();
  }, [active, cancelDrag]);

  const geometry = projectFilesSplitGeometry(availableHeight, listRatio);
  return {
    ...geometry,
    listRatio,
    onLayoutHeight,
    resize,
    dividerPanHandlers: panResponder.panHandlers,
  };
}
