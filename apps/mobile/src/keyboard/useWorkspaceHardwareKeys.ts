import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { HardwareKeyEvent } from '../../modules/vimicate-editor';
import type { WorkspaceFocus } from '../workspace/focusRouting';
import { isWorkspaceNavigationKey, shouldAcceptSynthesizedRepeat } from './workspaceRepeatPolicy';

type KeyContext = { pane: WorkspaceFocus | 'files'; pending: string; commandLineActive: boolean; scope: string };

/** Coalesces held motions only while the same pane/session still owns them. */
export function useWorkspaceHardwareKeys(dispatch: (event: HardwareKeyEvent) => void, context: () => KeyContext, owner: string) {
  const [repeating, setRepeating] = useState(false);
  const callbacks = useRef({ dispatch, context });
  useLayoutEffect(() => { callbacks.current = { dispatch, context }; });
  const frame = useRef<number | null>(null);
  const release = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queued = useRef<{ event: HardwareKeyEvent; context: KeyContext } | null>(null);
  const active = useRef(true);
  const cancel = useCallback(() => {
    queued.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    if (release.current !== null) clearTimeout(release.current);
    frame.current = null;
    release.current = null;
  }, []);
  useLayoutEffect(() => { cancel(); setRepeating(false); }, [cancel, owner]);
  useEffect(() => { active.current = true; return () => { active.current = false; cancel(); }; }, [cancel]);

  const onHardwareKey = useCallback((event: HardwareKeyEvent) => {
    if (!active.current) return;
    const current = callbacks.current.context();
    if (!shouldAcceptSynthesizedRepeat(event, current.pane, current.pending, current.commandLineActive)) return;
    if (!event.isRepeat || !isWorkspaceNavigationKey(event) || current.commandLineActive) {
      callbacks.current.dispatch(event);
      return;
    }
    queued.current = { event, context: current };
    setRepeating(true);
    if (release.current !== null) clearTimeout(release.current);
    release.current = setTimeout(() => { release.current = null; if (active.current) setRepeating(false); }, 250);
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const next = queued.current;
      queued.current = null;
      if (!next || !active.current) return;
      const latest = callbacks.current.context();
      if (latest.pane !== next.context.pane || latest.scope !== next.context.scope || latest.commandLineActive) return;
      if (shouldAcceptSynthesizedRepeat(next.event, latest.pane, latest.pending, false)) callbacks.current.dispatch(next.event);
    });
  }, []);
  return { onHardwareKey, repeating };
}
