import type { HardwareKeyEvent } from '../../modules/vimicate-editor';
import { normalizedHardwareKey } from '../keyboard/hardwareKey';
import type { TranscriptVimState } from './transcriptVim';
import type { TranscriptBuffer } from './transcriptBuffer';

export type TranscriptFoldTarget = { messageId: string; messageIndex: number; sourceRow: number; expanded: boolean };
export type TranscriptRecoveryTarget = {
  messageId: string;
  state: 'available' | 'loading' | 'failed' | 'unavailable' | 'recovered';
};
export type TranscriptDisclosureCommand =
  | { type: 'fold'; target: TranscriptFoldTarget; expanded: boolean }
  | { type: 'recover'; messageId: string };

export function transcriptFoldLineInMessage(buffer: TranscriptBuffer, messageIndex: number, sourceRow: number) {
  return sourceRow - (buffer.firstRowByMessage[messageIndex] ?? sourceRow);
}

export function transcriptFoldExpansionForKey(state: TranscriptVimState, input: HardwareKeyEvent, fold: TranscriptFoldTarget | null | undefined) {
  if (!fold || input.control || input.command || input.option || state.pending || state.count || state.visualMode) return null;
  const key = normalizedHardwareKey(input);
  if (key === 'enter') return !fold.expanded;
  if (key === 'l' || key === 'right') return true;
  if (key === 'h' || key === 'left') return false;
  return null;
}

export function transcriptDisclosureCommandForKey(
  state: TranscriptVimState,
  input: HardwareKeyEvent,
  fold: TranscriptFoldTarget | null | undefined,
  recovery: TranscriptRecoveryTarget | null | undefined,
): TranscriptDisclosureCommand | null {
  const foldExpansion = transcriptFoldExpansionForKey(state, input, fold);
  // A mounted fold is the visible disclosure control and therefore owns its
  // Enter/arrow keys even when the same truncated message is also recoverable.
  // Recovery must never consume the collapse half of an Enter toggle.
  if (fold && foldExpansion !== null) return { type: 'fold', target: fold, expanded: foldExpansion };
  if (!recovery
    || recovery.state === 'loading'
    || recovery.state === 'recovered'
    || input.control
    || input.command
    || input.option
    || state.pending
    || state.count
    || state.visualMode) return null;
  const key = normalizedHardwareKey(input);
  return key === 'enter' || key === 'right' ? { type: 'recover', messageId: recovery.messageId } : null;
}
