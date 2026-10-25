/**
 * FlashList's data identity describes recycler structure, not row content.
 * Retain it while the ordered keys are unchanged so a streaming text revision
 * does not synchronously rebuild the native recycler data model.
 */
export function retainTranscriptRecyclerTopology<T extends { key: string }>(
  previous: T[],
  current: T[],
): T[] {
  if (previous.length === current.length
    && previous.every((row, index) => row.key === current[index]?.key)) return previous;
  return current;
}
