import { useCallback, useLayoutEffect, useRef } from 'react';
import type { HardwareKeyEvent } from '../../modules/vimicate-editor';
import { applyPaneShortcut, resolvePaneShortcutPrefix, type FocusRouting, type PaneShortcutContext } from './focusRouting';

/** One prefix and pane policy for the prompt and nested answer editors. */
export function useWorkspacePaneShortcuts(
  owner: string,
  read: () => { state: FocusRouting; context: PaneShortcutContext },
  commit: (result: ReturnType<typeof applyPaneShortcut>) => void,
) {
  const prefix = useRef({ owner, pending: false });
  const cancel = useCallback(() => { prefix.current = { owner, pending: false }; }, [owner]);
  useLayoutEffect(cancel, [owner]);
  const route = (event: HardwareKeyEvent, prefixEnabled: boolean, releaseEditor?: () => void, scope?: string): HardwareKeyEvent | null => {
    const inputOwner = JSON.stringify([owner, scope]);
    if (prefix.current.owner !== inputOwner) prefix.current = { owner: inputOwner, pending: false };
    if (!prefixEnabled) prefix.current.pending = false;
    const prefixed = resolvePaneShortcutPrefix(prefix.current.pending, event, prefixEnabled);
    prefix.current.pending = prefixed.pending;
    if (!prefixed.input) return null;
    const current = read();
    const routed = applyPaneShortcut(current.state, prefixed.input, current.context);
    if (!routed.handled) return prefixed.input;
    releaseEditor?.();
    commit(routed);
    return null;
  };
  return { route, cancel };
}
