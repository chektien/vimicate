import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { embeddedTimestampMilliseconds } from './liveAssistantHistoryPlacement';

/** A timestamped commentary is not necessarily a preamble. Flushed assistant
 * rows can already precede it in the same active run. Use the host timeline
 * before falling back to legacy run-level placement; local clocks are fences,
 * not comparable timestamps. Never reorder canonical rows or tool activity. */
export function liveNarrationInsertionIndex(rows: WorkspaceMessage[], message: WorkspaceMessage): number | null {
  if (message.role !== 'narration' || message.source !== 'live' || !message.sessionKey) return null;
  const time = embeddedTimestampMilliseconds(message.timestamp);
  if (time === null) return null;
  const fence = rows.findLastIndex(row => row.sessionKey === message.sessionKey && row.source === 'local'
    && row.role === 'user' && (!row.runId || row.runId === message.runId));
  const comparable = rows.flatMap((row, index) => {
    if (index <= fence || row.sessionKey !== message.sessionKey || row.source === 'local'
      || !['user', 'assistant', 'narration'].includes(row.role)
      || message.transcriptSessionId && row.transcriptSessionId && row.transcriptSessionId !== message.transcriptSessionId) return [];
    const timestamp = embeddedTimestampMilliseconds(row.timestamp);
    return timestamp === null ? [] : [{ index, timestamp }];
  });
  const next = comparable.find(row => row.timestamp > time);
  if (next) return next.index;
  if (!comparable.length) return null;
  // Untimed terminal footers still own the end of their run. Other untimed
  // live detail retains its publication order ahead of this new commentary.
  const terminal = rows.findIndex((row, index) => index > fence && row.sessionKey === message.sessionKey
    && message.runId && row.runId === message.runId && row.role === 'run' && row.state === 'complete');
  return terminal < 0 ? rows.length : terminal;
}
