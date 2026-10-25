import type { HardwareKeyEvent } from '../../modules/vimicate-editor';
import { normalizedHardwareKey } from '../keyboard/hardwareKey';

export type MediaViewerKeyDisposition = 'pass' | 'close' | 'block';

export function mediaViewerKeyDisposition(open: boolean, event: HardwareKeyEvent): MediaViewerKeyDisposition {
  if (!open) return 'pass';
  return normalizedHardwareKey(event) === 'escape' || (event.control && normalizedHardwareKey(event) === '[') ? 'close' : 'block';
}
