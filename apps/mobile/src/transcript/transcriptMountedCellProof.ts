import { transcriptViewportIsOffContent } from './transcriptViewportPolicy';

type Proof = { revision: object; contentHeight: number; viewportHeight: number };

/** Empty viewability alone cannot revoke a still-mounted native cell. */
export function nextTranscriptMountedCellProof(indices: readonly number[], prior: Proof | null,
  revision: object, metrics: { offset: number; contentHeight: number; viewportHeight: number }): Proof | null {
  if (indices.length) return { revision, contentHeight: metrics.contentHeight, viewportHeight: metrics.viewportHeight };
  if (!prior || transcriptViewportIsOffContent(metrics.offset, metrics.contentHeight, metrics.viewportHeight)
    || prior.revision !== revision || Math.abs(prior.contentHeight - metrics.contentHeight) > 0.5
    || Math.abs(prior.viewportHeight - metrics.viewportHeight) > 0.5) return null;
  return prior;
}
