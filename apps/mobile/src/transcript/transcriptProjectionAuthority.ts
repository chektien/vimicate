import type { TranscriptVimState } from './transcriptVim';

/**
 * A render may finish projecting folded rows after a newer hardware key has
 * already advanced the synchronous Vim state. Only the exact state that
 * requested a projection may commit it; otherwise the newer key owns.
 */
export function authorizedTranscriptProjection(
  current: TranscriptVimState,
  expected: TranscriptVimState,
  projected: TranscriptVimState,
) {
  return current === expected ? projected : current;
}
