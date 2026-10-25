import { useEffect } from 'react';
import type { HardwareKeyEvent } from '../../modules/vimicate-editor';
import type { WorkspaceAttachment } from '../workspace/workspaceTypes';
import { normalizedHardwareKey } from '../keyboard/hardwareKey';
import { mediaViewerKeyDisposition } from '../transcript/mediaViewerKeyboardPolicy';
import { useSynchronousState } from './useSynchronousState';

export function useWorkspaceOverlays(scope: string, hideKeyboard: () => void) {
  const [mediaViewer, setMediaViewer, mediaViewerRef] = useSynchronousState<{ attachments: WorkspaceAttachment[]; initialID: string } | null>(null);
  const [shortcuts, setShortcuts, shortcutsRef] = useSynchronousState(false);
  useEffect(() => { setMediaViewer(null); setShortcuts(false); }, [scope, setMediaViewer, setShortcuts]);
  const showShortcuts = () => { hideKeyboard(); setShortcuts(true); };
  const closeShortcuts = () => setShortcuts(false);
  const handleOverlayKey = (event: HardwareKeyEvent) => {
    const media = mediaViewerKeyDisposition(Boolean(mediaViewerRef.current), event);
    if (media === 'close') { setMediaViewer(null); return true; }
    if (media === 'block') return true;
    const key = normalizedHardwareKey(event).toLowerCase();
    const helpKey = event.command && !event.control && !event.option && !event.shift && key === '/';
    if (helpKey && event.isRepeat) return true;
    if (shortcutsRef.current) {
      if (key === 'escape' || (event.control && key === '[') || (!event.control && !event.command && !event.option && key === 'q') || helpKey) closeShortcuts();
      return true;
    }
    if (helpKey) { if (!event.isRepeat) showShortcuts(); return true; }
    return false;
  };
  return { mediaViewer, setMediaViewer, shortcuts, showShortcuts, closeShortcuts, handleOverlayKey };
}
