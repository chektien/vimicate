import { useState } from 'react';
import type { TranscriptBuffer, TranscriptVimState } from './transcriptVim';
import type { TranscriptRenderRow } from './transcriptRenderRows';
import { transcriptRenderIndexForSourceRow } from './transcriptVisibleRows';
import { transcriptEntryIndex } from './transcriptViewportPolicy';
import { resolveSessionTranscriptViewportPosition, type SessionTranscriptViewportPosition, type SessionViewportCapture, type SessionViewportEntry } from './sessionTranscriptViewportPosition';
import type { TranscriptSessionViewportOptions } from './useTranscriptSessionCapture';
import type { SessionRestoreIntent } from './transcriptReviewRestoreVerification';

type Options = {
  datasetKey: string; rows: TranscriptRenderRow[]; buffer: TranscriptBuffer; navigation: TranscriptVimState;
  entry: SessionViewportEntry | undefined;
  onRetire: ((datasetKey: string, capture: SessionViewportCapture | null) => void) | undefined;
  historyLoading: boolean | undefined;
};

/** The pane's session adapter owns no cache, timer or scroll writer. */
export function useTranscriptSessionPosition({ datasetKey, rows, buffer, navigation, entry, onRetire, historyLoading }: Options) {
  const seed = entry?.kind === 'anchor' ? transcriptRenderIndexForSourceRow(rows, entry.sourceRow)
    : entry ? Math.max(0, rows.length - 1)
      : transcriptEntryIndex(rows.length, navigation.followTail, transcriptRenderIndexForSourceRow(rows, navigation.cursor.row));
  // Fix admission once per dataset's first nonempty render. Abandoned renders
  // cannot leak foreign navigation or an entry index into the committed pane.
  const [admission, setAdmission] = useState(() => ({ datasetKey, hasRows: rows.length > 0, index: seed }));
  let current = admission;
  if (admission.datasetKey !== datasetKey || !admission.hasRows && rows.length > 0) {
    current = { datasetKey, hasRows: rows.length > 0, index: seed }; setAdmission(current);
  }
  const options: TranscriptSessionViewportOptions = {
    historyLoading, entryIndex: current.index, entryTail: entry ? entry.kind === 'tail' : navigation.followTail,
    sessionAnchorForRow: index => {
      const row = rows[index]; return row ? { messageId: row.message.id, lineInMessage: row.lineInMessage } : undefined;
    },
    onSessionRetire: (key, capture) => {
      const row = capture?.kind === 'anchor' ? rows[capture.row] : undefined;
      onRetire?.(key, capture?.kind === 'anchor' ? row ? { ...capture, sourceRow: row.sourceRow } : null : capture);
    },
    resolveSessionAnchor: anchor => {
      const source = resolveSessionTranscriptViewportPosition(buffer, anchor);
      return source === null ? null : transcriptRenderIndexForSourceRow(rows, source);
    },
  };
  const restore = (anchor: SessionTranscriptViewportPosition,
    reveal: (row: number, position: number, rowOffset: number | undefined, intent: SessionRestoreIntent) => void) => {
    const source = resolveSessionTranscriptViewportPosition(buffer, anchor);
    if (source !== null) reveal(transcriptRenderIndexForSourceRow(rows, source), 0, anchor.rowOffset,
      { anchor, endAligned: (anchor.endGap ?? Infinity) <= 1 });
  };
  return { index: current.index, options, restore };
}
