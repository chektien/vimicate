export type TranscriptRevealOwnership = 'review' | 'tail' | 'preserve';

export function transcriptTailFollowForReveal(current: boolean, ownership: TranscriptRevealOwnership) {
  // Cursor geometry is not user intent. In particular, k/j inside the final
  // two rows is still reader-owned review and must not let a streaming frame
  // reclaim the viewport. Only G, submit, or the explicit tail affordance
  // grants tail ownership; recovery preserves whichever owner was active.
  if (ownership === 'preserve') return current;
  return ownership === 'tail';
}

export function shouldCancelTranscriptTailWriter(ownership: TranscriptRevealOwnership, pendingFrame: number | null) {
  return ownership === 'review' && pendingFrame !== null;
}

export function shouldScrollTranscriptTailReveal(force: boolean, target: number, visible: { first: number; last: number } | null, distanceFromBottom: number, tolerance: number) {
  if (force || !visible) return true;
  if (target < visible.first || target > visible.last) return true;
  return distanceFromBottom > tolerance;
}

export function transcriptTailFollowOnDragBegin() { return false; }

export function transcriptDragWillMomentum(velocityY: number | undefined) {
  return Number.isFinite(velocityY) && Math.abs(velocityY ?? 0) > 0.01;
}

export function transcriptMomentumBelongsToUser(expectedFromDrag: boolean) {
  return expectedFromDrag;
}

export function transcriptTailFollowAfterScroll(current: boolean, userOwned: boolean, distanceFromBottom: number, tolerance: number) {
  // Review is latched intent. Content shrink, keyboard resize, or a native
  // anchoring sample at the bottom cannot opt the reader back into following.
  return current && (!userOwned || distanceFromBottom <= tolerance);
}

/** An omitted drag-start still needs motion evidence, not distance from a growing tail. */
export function transcriptScrollMovedIntoReview(
  previous: { offset: number; contentHeight: number; viewportHeight: number } | null,
  next: { offset: number; contentHeight: number; viewportHeight: number }, fallbackOffset: number | null,
) {
  const from = previous?.offset ?? fallbackOffset;
  return from !== null && next.offset < from - 1
    && (!previous || (next.viewportHeight === previous.viewportHeight && next.contentHeight >= previous.contentHeight));
}
