import { useLayoutEffect, useRef, type RefObject } from 'react';
import type { ProjectFileContent } from '../gateway/projectFiles';
import type { TranscriptVimState } from '../transcript/transcriptVim';
import { fileViewKey } from './projectFileViewStore';
import { createTopPreviewNavigation, restorePreviewNavigation } from './projectFilePreview';

type Position = { row: number; column: number; query: string; direction: 1 | -1 };
const keyFor = (projectId: string, scopeKey: string, path: string) => `${fileViewKey(projectId, scopeKey)}\0${path}`;

// Controller-local metadata only: no duplicate content cache or durable state.
export class ProjectFilePreviewPositions {
  private positions = new Map<string, Position>();
  set(projectId: string, scopeKey: string, path: string, position: Position) {
    const key = keyFor(projectId, scopeKey, path);
    if (key.length + position.query.length > 16_384) return;
    this.positions.delete(key); this.positions.set(key, { ...position });
    if (this.positions.size > 64) this.positions.delete(this.positions.keys().next().value!);
  }
  restore(projectId: string, scopeKey: string, path: string, source: string) {
    const key = keyFor(projectId, scopeKey, path); const position = this.positions.get(key);
    if (!position) return null;
    this.positions.delete(key); this.positions.set(key, position);
    const top = createTopPreviewNavigation(source);
    return { navigation: restorePreviewNavigation(source, { ...top, cursor: { row: position.row, column: position.column }, searchQuery: position.query }), query: position.query, direction: position.direction };
  }
}

export function useProjectFilePreviewPositions(content: ProjectFileContent | null, ready: boolean, scopeKey: string, navigation: TranscriptVimState, lastSearch: RefObject<string>, lastSearchDirection: RefObject<1 | -1>) {
  const positions = useRef(new ProjectFilePreviewPositions());
  useLayoutEffect(() => {
    if (ready && content?.kind === 'text') positions.current.set(content.projectId, scopeKey, content.path,
      { row: navigation.cursor.row, column: navigation.cursor.column, query: lastSearch.current, direction: lastSearchDirection.current });
  }, [content, ready, scopeKey, navigation, lastSearch, lastSearchDirection]);
  return positions.current;
}
