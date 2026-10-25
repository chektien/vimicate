import { useCallback, useEffect, useInsertionEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AppState, PanResponder } from 'react-native';
import { loadValue, saveValue } from '../storage/workspaceStore';
import {
  boundedWorkspaceColumnPreferences,
  defaultWorkspaceColumnPreferences,
  parsedWorkspaceColumnPreferences,
  resizedWorkspaceColumnPreferences,
  resizedWorkspaceColumnWidth,
  serializedWorkspaceColumnPreferences,
  workspaceColumnWidths,
  type WorkspaceColumnPreferences,
} from './workspaceColumns';

export const WORKSPACE_COLUMN_WIDTHS_KEY = 'workspace.columnWidths.v1';

type WorkspaceColumnsInput = {
  width: number;
  projectsVisible: boolean;
  filesVisible: boolean;
};

type ColumnSide = 'projects' | 'files';

export function useWorkspaceColumns({ width, projectsVisible, filesVisible }: WorkspaceColumnsInput) {
  const [preferences, setPreferences] = useState(() => defaultWorkspaceColumnPreferences(width));
  const preferencesRef = useRef(preferences);
  const touchedRef = useRef({ projects: false, files: false });
  const mountedRef = useRef(true);
  const foregroundRef = useRef(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  const activeDragRef = useRef<{ side: ColumnSide; stateID: number } | null>(null);

  const geometry = workspaceColumnWidths({
    width,
    projectsVisible,
    filesVisible,
    preferredProjectsWidth: preferences.projects,
    preferredFilesWidth: preferences.files,
  });
  const layoutRef = useRef({ width, projectsVisible, filesVisible });
  const geometryRef = useRef(geometry);
  const dragStartRef = useRef(geometry);
  const dragPreferencesRef = useRef(preferences);
  const dragTouchedRef = useRef(touchedRef.current);
  useInsertionEffect(() => {
    layoutRef.current = { width, projectsVisible, filesVisible };
    geometryRef.current = geometry;
  });

  const cancelDrag = useCallback(() => {
    if (!mountedRef.current || !activeDragRef.current) return;
    activeDragRef.current = null;
    preferencesRef.current = dragPreferencesRef.current;
    geometryRef.current = workspaceColumnWidths({ ...layoutRef.current,
      preferredProjectsWidth: dragPreferencesRef.current.projects, preferredFilesWidth: dragPreferencesRef.current.files });
    touchedRef.current = dragTouchedRef.current;
    setPreferences(dragPreferencesRef.current);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    let active = true;
    void loadValue(WORKSPACE_COLUMN_WIDTHS_KEY).then((stored) => {
      if (!active) return;
      const restored = parsedWorkspaceColumnPreferences(stored);
      if (!restored) return;
      // Hydration replaces the coordinate baseline captured by a held touch.
      cancelDrag();
      const current = preferencesRef.current;
      const next = boundedWorkspaceColumnPreferences({
        projects: touchedRef.current.projects ? current.projects : restored.projects ?? current.projects,
        files: touchedRef.current.files ? current.files : restored.files ?? current.files,
      });
      preferencesRef.current = next;
      setPreferences(next);
    }).catch(() => undefined);
    return () => { active = false; mountedRef.current = false; activeDragRef.current = null; };
  }, [cancelDrag]);

  const persist = useCallback((next: WorkspaceColumnPreferences) => {
    if (!mountedRef.current) return;
    void saveValue(WORKSPACE_COLUMN_WIDTHS_KEY, serializedWorkspaceColumnPreferences(next)).catch(() => undefined);
  }, []);

  const markVisibleColumnsTouched = useCallback(() => {
    if (projectsVisible) touchedRef.current.projects = true;
    if (filesVisible) touchedRef.current.files = true;
  }, [filesVisible, projectsVisible]);

  const updateFromDrag = useCallback((side: ColumnSide, signedTravel: number) => {
    if (!mountedRef.current) return null;
    const rendered = side === 'projects' ? dragStartRef.current.projectsWidth : dragStartRef.current.filesWidth;
    const next = resizedWorkspaceColumnPreferences({
      width,
      projectsVisible,
      filesVisible,
      preferredProjectsWidth: dragPreferencesRef.current.projects,
      preferredFilesWidth: dragPreferencesRef.current.files,
      geometry: dragStartRef.current,
      side,
      requestedWidth: rendered + signedTravel,
    });
    markVisibleColumnsTouched();
    preferencesRef.current = next;
    setPreferences(next);
    return next;
  }, [filesVisible, markVisibleColumnsTouched, projectsVisible, width]);

  useLayoutEffect(() => { cancelDrag(); }, [cancelDrag, width, projectsVisible, filesVisible]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      foregroundRef.current = state === 'active';
      if (!foregroundRef.current) cancelDrag();
    });
    return () => subscription.remove();
  }, [cancelDrag]);

  const resize = useCallback((side: ColumnSide, direction: 1 | -1) => {
    if (!mountedRef.current || !foregroundRef.current) return;
    cancelDrag();
    geometryRef.current = workspaceColumnWidths({ width, projectsVisible, filesVisible,
      preferredProjectsWidth: preferencesRef.current.projects, preferredFilesWidth: preferencesRef.current.files });
    const rendered = side === 'projects' ? geometryRef.current.projectsWidth : geometryRef.current.filesWidth;
    const next = resizedWorkspaceColumnPreferences({
      width,
      projectsVisible,
      filesVisible,
      preferredProjectsWidth: preferencesRef.current.projects,
      preferredFilesWidth: preferencesRef.current.files,
      geometry: geometryRef.current,
      side,
      requestedWidth: resizedWorkspaceColumnWidth(rendered, direction),
    });
    markVisibleColumnsTouched();
    preferencesRef.current = next;
    setPreferences(next);
    persist(next);
  }, [cancelDrag, filesVisible, markVisibleColumnsTouched, persist, projectsVisible, width]);

  const dragCallbacks = useRef({ updateFromDrag, cancelDrag });
  // Native events keep using the painted pane while a replacement render is
  // suspended or abandoned. Never publish speculative geometry/callbacks.
  useInsertionEffect(() => { dragCallbacks.current = { updateFromDrag, cancelDrag }; });
  // Native PanResponder owns accumulated travel. Keep its instance for the
  // mount, and retire our drag authority when layout or scene changes.
  const responders = useMemo(() => {
    const create = (side: ColumnSide) => {
      const owns = (stateID: number) => mountedRef.current && foregroundRef.current
        && activeDragRef.current?.side === side && activeDragRef.current.stateID === stateID;
      return PanResponder.create({
        onStartShouldSetPanResponder: () => mountedRef.current && foregroundRef.current,
        onMoveShouldSetPanResponder: (_event, gesture) => mountedRef.current && foregroundRef.current && Math.abs(gesture.dx) >= 2,
        onPanResponderGrant: (_event, gesture) => {
          if (!mountedRef.current || !foregroundRef.current) return;
          dragCallbacks.current.cancelDrag();
          dragStartRef.current = geometryRef.current;
          dragPreferencesRef.current = preferencesRef.current;
          dragTouchedRef.current = { ...touchedRef.current };
          activeDragRef.current = { side, stateID: gesture.stateID };
        },
        onPanResponderMove: (_event, gesture) => {
          if (!owns(gesture.stateID) || Math.abs(gesture.dx) < 2) return;
          dragCallbacks.current.updateFromDrag(side, side === 'projects' ? gesture.dx : -gesture.dx);
        },
        onPanResponderRelease: (_event, gesture) => {
          if (!owns(gesture.stateID)) return;
          if (Math.abs(gesture.dx) < 2) { dragCallbacks.current.cancelDrag(); return; }
          const next = dragCallbacks.current.updateFromDrag(side, side === 'projects' ? gesture.dx : -gesture.dx);
          activeDragRef.current = null;
          if (next) persist(next);
        },
        onPanResponderTerminate: (_event, gesture) => {
          if (owns(gesture.stateID)) dragCallbacks.current.cancelDrag();
        },
        onPanResponderTerminationRequest: (_event, gesture) => !owns(gesture.stateID),
      });
    };
    return { left: create('projects'), right: create('files') };
  }, [persist]);

  return {
    projectsWidth: geometry.projectsWidth,
    conversationWidth: geometry.conversationWidth,
    filesWidth: geometry.filesWidth,
    leftDividerPanHandlers: responders.left.panHandlers,
    rightDividerPanHandlers: responders.right.panHandlers,
    resizeProjects: useCallback((direction: 1 | -1) => resize('projects', direction), [resize]),
    resizeFiles: useCallback((direction: 1 | -1) => resize('files', direction), [resize]),
  };
}
