export const TRANSCRIPT_PANE_BORDER_WIDTH = 2;

/** Focus may reveal richer text, but it must not alter measured row metrics. */
export function transcriptFocusMetrics(fontScale: number, _focused: boolean) {
  return {
    paneBorderWidth: TRANSCRIPT_PANE_BORDER_WIDTH,
    timestampWidth: 92 * fontScale,
  };
}
