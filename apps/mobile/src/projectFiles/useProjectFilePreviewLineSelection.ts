import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { ProjectFileContent } from '../gateway/projectFiles';
import { focusTranscriptMessage, type TranscriptVimState } from '../transcript/transcriptVim';
import { boundedProjectFilePreviewSource, projectFilePreviewBuffer } from './projectFilePreview';

/** Receives only the controller's scope-validated visible content. */
export function useProjectFilePreviewLineSelection(content: ProjectFileContent | null, ready: boolean,
  navigation: { current: TranscriptVimState }, setNavigation: Dispatch<SetStateAction<TranscriptVimState>>,
  setRegion: (region: 'list' | 'preview') => void) {
  return useCallback((line: number) => {
    if (!ready || content?.kind !== 'text') return;
    const buffer = projectFilePreviewBuffer(boundedProjectFilePreviewSource(content.text).source, content.path);
    setNavigation(current => {
      const next = focusTranscriptMessage(buffer, current, 0, line);
      navigation.current = next;
      return next;
    });
    setRegion('preview');
  }, [content, ready, navigation, setNavigation, setRegion]);
}
