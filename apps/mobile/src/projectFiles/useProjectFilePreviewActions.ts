import { useCallback, useRef, type RefObject } from 'react';
import type { HardwareKeyEvent } from '../../modules/vimicate-editor';
import type { ProjectFileContent, ProjectFileEntry } from '../gateway/projectFiles';
import { normalizedHardwareKey } from '../keyboard/hardwareKey';

type PreviewIdentity = { projectId: string; scopeKey: string; path: string };
type FallbackOpen = { projectId: string; scopeKey: string; entry: ProjectFileEntry; action: () => void };

/** Mounted preview actions belong only to their exact file and workspace scope. */
export function useProjectFilePreviewActions(
  projectId: string, scopeKey: string, content: RefObject<ProjectFileContent | null>,
  project: RefObject<string>, scope: RefObject<string>, search: RefObject<string | null>,
  setSearch: (query: string | null) => void,
) {
  const nativePreviewRef = useRef<PreviewIdentity | null>(null);
  const fallbackOpenRef = useRef<FallbackOpen | null>(null);
  const setNativePreviewActive = useCallback((active: boolean) => {
    nativePreviewRef.current = active && content.current ? { projectId: project.current, scopeKey: scope.current, path: content.current.path } : null;
    if (active) { search.current = null; setSearch(null); }
  }, [content, project, scope, search, setSearch]);
  const registerFallbackOpen = useCallback((entry: ProjectFileEntry, action: () => void) => {
    const binding = { projectId, scopeKey, entry, action };
    fallbackOpenRef.current = binding;
    return () => { if (fallbackOpenRef.current === binding) fallbackOpenRef.current = null; };
  }, [projectId, scopeKey]);
  const openFallback = useCallback((event: HardwareKeyEvent, selected: ProjectFileEntry | undefined, previewPhase: string, enabled: boolean) => {
    const binding = fallbackOpenRef.current;
    if (!enabled || normalizedHardwareKey(event) !== 'enter' || event.control || event.command || event.option
      || !binding || binding.projectId !== project.current || binding.scopeKey !== scope.current || binding.entry !== selected
      || (selected?.kind !== 'unsupported' && previewPhase !== 'error')) return false;
    binding.action(); return true;
  }, [project, scope]);
  // Rendered HTML owns interaction, never the hidden source cursor.
  const nativeHTMLPreviewActive = useCallback((current: ProjectFileContent | null) => {
    const native = nativePreviewRef.current;
    return native?.projectId === project.current && native?.scopeKey === scope.current
      && native?.path === current?.path && current?.kind === 'text' && current.mimeType === 'text/html';
  }, [project, scope]);
  return { nativeHTMLPreviewActive, setNativePreviewActive, registerFallbackOpen, openFallback };
}
