import { type WorkspaceMessage } from '../workspace/workspaceTypes';
import { absorbedLiveMessageMatches } from './transcriptIdentityWall';

/**
 * Where a row stood in the previous publication, and how a merged history
 * page keeps it there. Canonical rows replace their optimistic counterparts
 * in place; these anchors never invent chronology from text alone.
 */
export function sameMeaning(left: WorkspaceMessage, right: WorkspaceMessage) {
  if (left.role !== right.role) return false;
  // Explicit submissions can intentionally repeat the same prose and clock.
  // Conflicting keys disprove this alias before any legacy content fallback.
  if (left.idempotencyKey && right.idempotencyKey) return sameSubmissionIdentity(left.idempotencyKey, right.idempotencyKey);
  return left.text === right.text && (!left.timestamp || !right.timestamp || left.timestamp === right.timestamp);
}

export function sameSubmissionIdentity(left: string, right: string) {
  const base = (value: string) => value.replace(/:(?:user|assistant)$/i, '');
  return base(left) === base(right);
}

export function insertAtPreviousPublicationPosition(result: WorkspaceMessage[], message: WorkspaceMessage, previous: WorkspaceMessage[], previousIndex: number, replacements: ReadonlyMap<WorkspaceMessage, WorkspaceMessage>) {
  const anchorIndex = precedingPublishedAnchorIndex(result, previous, previousIndex, replacements);
  let insertionIndex = Math.max(0, anchorIndex + 1);
  while (insertionIndex < result.length && result[insertionIndex]?.source !== 'history') {
    const candidatePreviousIndex = previous.indexOf(result[insertionIndex]!);
    if (candidatePreviousIndex < 0 || candidatePreviousIndex >= previousIndex) break;
    insertionIndex += 1;
  }
  result.splice(insertionIndex, 0, message);
}

/** Whether this row's unbroken run of same-run live rows contains the run's live text. */
export function livePublicationFollowsRunText(previous: WorkspaceMessage[], index: number, runId: string | undefined) {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const row = previous[cursor]!;
    if (row.runId !== runId || row.source !== 'live') return false;
    if (row.role === 'assistant') return true;
  }
  return false;
}

/** Where a row of the merged result stood in the previous publication, or -1. */
export function previousPublicationIndex(previous: WorkspaceMessage[], row: WorkspaceMessage, replacements: ReadonlyMap<WorkspaceMessage, WorkspaceMessage>) {
  return previous.findIndex((candidate) => candidate === row || replacements.get(candidate)?.id === row.id || samePublicationIdentity(row, candidate));
}

function precedingPublishedAnchorIndex(result: WorkspaceMessage[], previous: WorkspaceMessage[], beforeIndex: number, replacements: ReadonlyMap<WorkspaceMessage, WorkspaceMessage>) {
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    const anchor = previous[index]!;
    const replacement = replacements.get(anchor);
    if (replacement) {
      const replacementIndex = result.findIndex((candidate) => candidate.id === replacement.id);
      if (replacementIndex >= 0) return replacementIndex;
    }
    // Prefer an exact surviving occurrence before the semantic fallback. With
    // equal repeated prompts, scanning with the fallback first resolves every
    // later local occurrence to the first canonical row even when its own
    // exact local row is still present farther down the result.
    const exactIndex = result.findIndex((candidate) => samePublicationIdentity(candidate, anchor));
    if (exactIndex >= 0) return exactIndex;
    const publishedIndex = result.findIndex((candidate) => samePublicationAnchor(candidate, anchor));
    if (publishedIndex >= 0) return publishedIndex;
  }
  return -1;
}

function samePublicationIdentity(left: WorkspaceMessage, right: WorkspaceMessage) {
  if (left.id === right.id) return true;
  // Canonicalization retires the live answer's ID but retains its proven
  // alias. A follow-up already painted after that answer must anchor to the
  // replacement, not fall back to the preceding prompt while history lags.
  if (absorbedLiveMessageMatches(left, right)) return true;
  return Boolean(left.role === right.role
    && left.idempotencyKey && right.idempotencyKey
    && sameSubmissionIdentity(left.idempotencyKey, right.idempotencyKey));
}

/** The semantic fallback, consulted only after no row shares the anchor's publication identity. */
function samePublicationAnchor(left: WorkspaceMessage, right: WorkspaceMessage) {
  // Older and cross-device history can omit the submission key. The latest
  // page still consumes matching optimistic prompts in publication order, so
  // an unmatched repeated prompt must be allowed to anchor to the canonical
  // replacement of the preceding occurrence. Restrict the semantic fallback
  // to a history/local pair: equal live narration or tool prose is not an
  // identity and must never become a chronology anchor by text alone.
  return left.source === 'history' && right.source === 'local' && sameMeaning(left, right);
}
