import type { TranscriptRenderRow } from './transcriptRenderRows';

/** Keep question-card height averages out of ordinary source-line estimates. */
export function transcriptItemType(row: TranscriptRenderRow | undefined) {
  return row?.lastInMessage && (row.message.question || row.message.asyncQuestion) ? 'question' : 'source';
}
