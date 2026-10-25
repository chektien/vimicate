import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import type { TranscriptChronology } from './transcriptChronology';

export type TranscriptLifecycle = { label: 'running' | 'failed' | 'done'; symbol: '●' | '✗' | '✓' };

/** Conversation answers own their timestamp; run completion is represented by
 * a separate `run` row. Treating an assistant's convergence state as a row
 * lifecycle hides the response time and duplicates the terminal marker. */
export function transcriptRowLifecycle(message: WorkspaceMessage): TranscriptLifecycle | null {
  if (!message.state || message.role === 'run' || message.role === 'assistant' || message.role === 'user') return null;
  if (message.state === 'streaming') return { label: 'running', symbol: '●' };
  if (message.state === 'error') return { label: 'failed', symbol: '✗' };
  return { label: 'done', symbol: '✓' };
}

export function transcriptRowTimestamp(
  message: WorkspaceMessage,
  chronology: TranscriptChronology,
  firstInMessage: boolean,
  paneFocused: boolean,
  messageFocused: boolean,
  lifecycle: TranscriptLifecycle | null,
) {
  if (!firstInMessage || lifecycle || !message.timestamp) return undefined;
  if (message.role !== 'assistant' && !(paneFocused && messageFocused)) return undefined;
  return paneFocused && messageFocused ? chronology.focusedTimeLabel : chronology.timeLabel;
}
