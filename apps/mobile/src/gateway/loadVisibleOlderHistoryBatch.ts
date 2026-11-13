import { HistoryTraversalChanged, continueHistoryScan, recordHistoryTransport, revalidateHistoryCursor } from './historyTransport';
import { transcriptPublicationIdentity } from './transcriptIdentityWall';
import type { OpenClawClient } from './OpenClawClient';
import { loadNextArchivedSegment, type ArchivedHistoryState } from './archivedHistory';
import { historyCursorFromPayload, type HistoryCursor } from './historyPagination';
import { olderPageHistoryPublication } from './historyReviewPublication';
import { loadPresentationBoundedOlderPage } from './olderHistoryPageAdmission';
import { addedOlderVisibleRowCount, olderReviewBytes, OLDER_READ_LIMIT, OLDER_REVIEW_BYTE_LIMIT, OLDER_REVIEW_COST_LIMIT, OLDER_VISIBLE_ROW_TARGET, type OlderHistoryVisibleContext } from './olderHistoryVisibleRows';
import { type WorkspaceMessage } from '../workspace/workspaceTypes';
import { messagesFromPayload } from '../workspace/historyMessageProjection';

const readLimit = Symbol('older history read limit');
type Batch = { older: WorkspaceMessage[]; cursor: HistoryCursor | null; archive: ArchivedHistoryState | null;
  addedVisibleRowCount: number; outcome: 'extension' | 'overlap' | 'scan' | 'partial' | 'exhausted' | 'budget'; problem?: unknown };

/** Stage one bounded user-visible increment before publishing any cursor or row. */
export async function loadVisibleOlderHistoryBatch(input: {
  client: OpenClawClient; sessionKey: string; path: string; visible: WorkspaceMessage[];
  narration: WorkspaceMessage[]; cursor: HistoryCursor | null; archive: ArchivedHistoryState | null;
  projectionContext?: (() => WorkspaceMessage[]) | undefined;
  context: OlderHistoryVisibleContext; owns: () => boolean;
}): Promise<Batch> {
  let { cursor, archive } = input;
  let older: WorkspaceMessage[] = [];
  let reads = 0;
  let problem: unknown;
  let revalidating = Boolean(cursor?.transport?.scan?.revalidate);
  let scanning = false;
  let rebase = false;
  let revalidatedGeneration: string | undefined;
  const transport = {
    projectionContext: () => [...input.visible, ...older, ...(input.projectionContext?.() ?? [])],
    archivedHistoryRequest: async (params: Record<string, unknown>) => {
      if (reads >= OLDER_READ_LIMIT) throw readLimit;
      reads++;
      return input.client.archivedHistoryRequest(params);
    },
    decorateMessages: (messages: WorkspaceMessage[], sessionKey: string) => input.client.decorateMessages(messages, sessionKey),
  };
  const review = (page: WorkspaceMessage[], retainBoundary: boolean) => olderPageHistoryPublication(
    input.visible, [], [...page, ...older], input.sessionKey, input.narration,
    retainBoundary, OLDER_REVIEW_COST_LIMIT,
  ).visible;
  const fits = (page: WorkspaceMessage[]) => {
    const bounded = review(page, false);
    const retained = review(page, true);
    return bounded.length === retained.length
      && retained.length <= OLDER_REVIEW_COST_LIMIT
      && olderReviewBytes(retained) <= OLDER_REVIEW_BYTE_LIMIT;
  };
  try {
    while (input.owns() && reads < OLDER_READ_LIMIT) {
      const currentOffset = cursor?.sessionKey === input.sessionKey && cursor.hasMore ? cursor.nextOffset : null;
      if (currentOffset !== null) {
        const payload = await loadPresentationBoundedOlderPage(80, async limit => {
          if (reads >= OLDER_READ_LIMIT) throw readLimit;
          reads++;
          return input.client.history(input.sessionKey, limit, currentOffset);
        }, input.owns, value => fits(input.client.decorateMessages(messagesFromPayload(value, input.path, [...input.visible, ...older, ...(input.projectionContext?.() ?? [])]), input.sessionKey)));
        if (!payload) break;
        const next = historyCursorFromPayload(payload, input.sessionKey);
        if (next.hasMore && (next.nextOffset ?? -1) <= currentOffset) throw new Error('older history cursor did not advance');
        const page = input.client.decorateMessages(messagesFromPayload(payload, input.path, [...input.visible, ...older, ...(input.projectionContext?.() ?? [])]), input.sessionKey);
        if (!fits(page) && older.length) break;
        let recorded: HistoryCursor;
        try {
          recorded = recordHistoryTransport(next, currentOffset, page, payload, cursor);
        } catch (error) {
          // One bounded restart inside this request. Discard the unwitnessed
          // page and scan to the retained edge using real transport receipts.
          // Repeated mutation, foreign generations and ordinary failures still
          // stop safely, retaining any earlier admitted pages for retry.
          if (!(error instanceof HistoryTraversalChanged) || revalidatedGeneration) throw error;
          revalidatedGeneration = cursor?.transport?.receipts.find(receipt => receipt.sessionId)?.sessionId;
          cursor = revalidateHistoryCursor(cursor, review([], true), input.sessionKey);
          revalidating = true;
          continue;
        }
        if (revalidatedGeneration && recorded.transport?.receipts.at(-1)?.sessionId !== revalidatedGeneration) {
          throw new Error('History concrete generation changed.');
        }
        scanning = true;
        if (revalidating) {
          const boundary = cursor?.transport?.boundary;
          const at = page.findIndex(row => transcriptPublicationIdentity(row) === boundary);
          cursor = recorded;
          if (at < 0) {
            cursor = continueHistoryScan(cursor, review([], true), true);
            if (!next.hasMore) throw new Error('Older history boundary is no longer available.');
            continue;
          }
          // Only the witnessed older side is eligible. Newer scanned pages
          // are not a publication or evidence of mounted coverage.
          older = [...page.slice(0, at), ...older];
          revalidating = false;
        } else { older = [...page, ...older]; cursor = recorded; }
      } else if (archive && !archive.exhausted) {
        const prior = archive;
        const result = await loadPresentationBoundedOlderPage(128,
          limit => loadNextArchivedSegment(transport, prior, limit), input.owns,
          value => fits(value.messages));
        if (!result) break;
        if (!result.state.exhausted && JSON.stringify(result.state) === JSON.stringify(prior)) throw new Error('archived history cursor did not advance');
        if (!fits(result.messages) && older.length) break;
        older = [...result.messages, ...older];
        archive = result.state;
      } else break;
      const retained = review([], true);
      // A full rolling review is not a full *batch*: the next admitted page
      // may evict its newer tail while preserving the original review edge.
      // Stopping here turns a collapsed tool continuation back into one raw
      // transport page with no visible progress.
      if (addedOlderVisibleRowCount(input.visible, retained, input.context) >= OLDER_VISIBLE_ROW_TARGET
        || olderReviewBytes(retained) >= OLDER_REVIEW_BYTE_LIMIT) break;
    }
  } catch (error) {
    if (error !== readLimit) {
      problem = error;
      rebase = error instanceof Error && /History changed|generation changed|boundary is no longer available/.test(error.message);
    }
  }
  const retained = review([], true);
  if (cursor && (scanning || revalidating || rebase)) cursor = rebase
    ? revalidateHistoryCursor(cursor, retained, input.sessionKey)
    : continueHistoryScan(cursor, retained, revalidating);
  const visibleCount = addedOlderVisibleRowCount(input.visible, retained, input.context);
  const outcome: Batch['outcome'] = problem ? 'partial' : visibleCount ? 'extension'
    : reads >= OLDER_READ_LIMIT ? 'budget' : scanning && !older.length ? 'scan'
    : older.length ? 'overlap' : 'exhausted';
  return { older, cursor, archive, outcome,
    addedVisibleRowCount: visibleCount,
    ...(problem ? { problem } : {}) };
}
