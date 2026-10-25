import { useCallback, useEffect, useMemo, useState, useRef, useLayoutEffect } from 'react';
import { loadValue, saveValue } from '../storage/workspaceStore';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { transcriptOptionCommand, visibleTranscriptMessages, type TranscriptDisplayOptions } from './transcriptDisplayOptions';
import { launchGuardedBackgroundTask } from '../async/guardedBackgroundTask';
import { projectTranscriptDisplayGroups } from './transcriptDisplayProjection';
const VERBOSE_KEY = 'transcript.verbose';
const PROGRESS_KEY = 'transcript.progress';

export function useTranscriptDisplayOptions(messages: WorkspaceMessage[], sessionKey: string) {
  const [options, setOptions] = useState<TranscriptDisplayOptions>({ verbose: true, progress: true });
  useEffect(() => { void Promise.all([loadValue(VERBOSE_KEY), loadValue(PROGRESS_KEY)]).then(([verbose, progress]) => setOptions({ verbose: verbose !== 'off', progress: progress !== 'off' })).catch(() => undefined); }, []);
  const applyCommand = useCallback((input: string) => {
    const result = transcriptOptionCommand(input, options); if (!result.message) return null;
    if (result.options) {
      const next = result.options;
      setOptions(next);
      launchGuardedBackgroundTask(() => Promise.all([saveValue(VERBOSE_KEY, next.verbose ? 'on' : 'off'), saveValue(PROGRESS_KEY, next.progress ? 'on' : 'off')]));
    }
    return result.message;
  }, [options]);
  // Only committed projections establish group identity. A suspended render
  // must not replace the visible session's keys or another session's history.
  const committedGroups = useRef(new Map<string, WorkspaceMessage[]>());
  const grouped = useMemo(() => projectTranscriptDisplayGroups(messages, committedGroups.current.get(sessionKey)), [messages, sessionKey]);
  useLayoutEffect(() => {
    const cache = committedGroups.current;
    cache.delete(sessionKey); cache.set(sessionKey, grouped);
    while (cache.size > 64) cache.delete(cache.keys().next().value!);
  }, [grouped, sessionKey]);
  const visibleMessages = useMemo(() => visibleTranscriptMessages(grouped, options), [grouped, options]);
  return { options, messages: visibleMessages, applyCommand };
}
