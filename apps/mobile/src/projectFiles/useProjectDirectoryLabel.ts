import { useCallback, useState } from 'react';
import type { ProjectFileList } from '../gateway/projectFiles';

/** A directory's host label has exactly the same authority as its admitted listing. */
export function useProjectDirectoryLabel(projectId: string, scope: string, path: string) {
  const [label, setLabel] = useState<{ scope: string; projectId: string; path: string; value: string } | null>(null);
  const setDirectoryLabel = useCallback((list: ProjectFileList | null, scope = '') => {
    setLabel(list?.directoryLabel ? { scope, projectId: list.projectId, path: list.path, value: list.directoryLabel } : null);
  }, []);
  const directoryLabel = label?.scope === scope && label.projectId === projectId && label.path === path ? label.value : undefined;
  return { directoryLabel, setDirectoryLabel };
}
