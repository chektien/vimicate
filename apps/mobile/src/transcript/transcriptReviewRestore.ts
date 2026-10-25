export type TranscriptReviewRestoreState = Readonly<{
  writes: number;
  confirmations: number;
  settleUntil?: number;
}>;

export type TranscriptReviewRestoreDecision =
  | Readonly<{ action: 'wait'; state: TranscriptReviewRestoreState }>
  | Readonly<{ action: 'confirm'; state: TranscriptReviewRestoreState }>
  | Readonly<{ action: 'correct'; state: TranscriptReviewRestoreState }>
  | Readonly<{ action: 'complete'; state: TranscriptReviewRestoreState }>
  | Readonly<{ action: 'exhaust'; state: TranscriptReviewRestoreState }>;

// This normalized value stays below one physical point for the supported
// transcript viewport heights. The previous 5.5% tolerance could bless a
// 30.5-point pagination jump as settled on iPad even though the exact source
// row and height were otherwise preserved.
const DEFAULT_POSITION_TOLERANCE = 0.0015;
const DEFAULT_MAX_WRITES = 4;

export function transcriptReviewTargetVisible(
  target: number,
  visible: Readonly<{ first: number; last: number }> | null,
) {
  return visible !== null && target >= visible.first && target <= visible.last;
}

/**
 * A freshly mounted recycler first exposes estimated layouts, then publishes
 * measured layouts. One scroll can therefore address the right source row at
 * the wrong screen-relative position. Require two settled observations and
 * cap all corrective writes so restoration cannot become a render loop.
 */
export function nextTranscriptReviewRestoreDecision(
  state: TranscriptReviewRestoreState,
  actualPosition: number | null,
  requestedPosition: number,
  tolerance = DEFAULT_POSITION_TOLERANCE,
  maxWrites = DEFAULT_MAX_WRITES,
  now = Number.POSITIVE_INFINITY,
): TranscriptReviewRestoreDecision {
  // FlashList may keep refining its prepend anchor for roughly 100 ms after
  // the data revision. Geometry observed inside that window is provisional:
  // accepting it can release Vimicate's exact selected-row owner just before
  // the recycler applies one final native correction.
  if (state.settleUntil !== undefined && now < state.settleUntil) return { action: 'wait', state };
  if (actualPosition === null || !Number.isFinite(actualPosition)) return { action: 'wait', state };
  if (Math.abs(actualPosition - requestedPosition) <= tolerance) {
    const confirmations = state.confirmations + 1;
    const next = { ...state, confirmations };
    return confirmations >= 2 ? { action: 'complete', state: next } : { action: 'confirm', state: next };
  }
  if (state.writes >= maxWrites) return { action: 'exhaust', state: { ...state, confirmations: 0 } };
  return { action: 'correct', state: { writes: state.writes + 1, confirmations: 0 } };
}
