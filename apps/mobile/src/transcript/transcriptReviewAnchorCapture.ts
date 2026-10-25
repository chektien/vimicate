import type { FlashListRef } from '@shopify/flash-list';

/** Read committed list geometry at capture time, not a deferred viewability callback. */
export function captureTranscriptReviewAnchor(
  list: Pick<FlashListRef<unknown>, 'computeVisibleIndices'> | null,
  itemCount: number,
  cursor: number,
  viewPositionForRow: (row: number) => number | null,
  preference: 'cursor' | 'start' = 'cursor',
): { row: number; viewPosition: number } | null {
  if (!list || itemCount <= 0) return null;
  let range: ReturnType<FlashListRef<unknown>['computeVisibleIndices']>;
  try {
    // FlashList throws before its layout manager is initialized. There is no
    // measured anchor in that state; a prior generation's indices cannot fill in.
    range = list.computeVisibleIndices();
  } catch {
    return null;
  }
  const { startIndex: first, endIndex: last } = range;
  if (!Number.isInteger(first) || !Number.isInteger(last)
    || first < 0 || last < first || last >= itemCount) return null;
  const row = preference === 'start' ? first : Number.isInteger(cursor) && cursor >= first && cursor <= last
    ? cursor : Math.floor((first + last) / 2);
  const viewPosition = viewPositionForRow(row);
  return viewPosition === null || !Number.isFinite(viewPosition) ? null : { row, viewPosition };
}
