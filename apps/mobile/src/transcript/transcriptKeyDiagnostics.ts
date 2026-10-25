import { recordViewportDiagnostic } from '../../modules/vimicate-diagnostics';
import { normalizedHardwareKey } from '../keyboard/hardwareKey';
import { handleTranscriptKey } from './transcriptVim';

/** Observe the admitted command boundary, never prompt text or message content. */
export function handleTranscriptKeyWithDiagnostics(...args: Parameters<typeof handleTranscriptKey>) {
  const result = handleTranscriptKey(...args);
  const key = normalizedHardwareKey(args[2]);
  if (key === 'g' || key === 'G') {
    recordViewportDiagnostic(`key-result key=${key} before=${args[1].cursor.row} pendingBefore=${args[1].pending || 'none'} after=${result.state.cursor.row} pendingAfter=${result.state.pending || 'none'} repeat=${args[2].isRepeat ? 1 : 0} handled=${result.handled ? 1 : 0}`);
  }
  return result;
}
