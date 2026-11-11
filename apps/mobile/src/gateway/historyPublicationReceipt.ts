import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { sameTranscriptPublication } from './transcriptPublicationEquality';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';

export type OlderHistoryLoadResult = Readonly<{
  continuation?: 'budget';
  mutation?: 'prepend' | 'refresh' | 'unchanged' | 'scan' | 'partial';
  boundaryMessageID?: string;
  committed: boolean;
  published: boolean;
  addedMessageCount: number;
  addedVisibleRowCount?: number;
}>;

/** One receipt, resolved by the React commit queued alongside its page. */
export class HistoryPublicationReceiptOwner {
  private revision = 0;
  private pending: { revision: number; before: readonly WorkspaceMessage[];
    owns: () => boolean; resolve: (result: OlderHistoryLoadResult) => void } | null = null;

  stage(before: readonly WorkspaceMessage[], owns: () => boolean) {
    this.retire();
    const revision = ++this.revision;
    const publication = new Promise<OlderHistoryLoadResult>(resolve => {
      this.pending = { revision, before, owns, resolve };
    });
    return { revision, publication };
  }

  commit(revision: number, messages: readonly WorkspaceMessage[]) {
    const pending = this.pending;
    if (!pending) return;
    if (!pending.owns()) { this.retire(); return; }
    if (revision !== pending.revision) return;
    this.pending = null;
    const beforeIDs = new Set(pending.before.map(message => message.id));
    const mutation = historyPublicationMutation(pending.before, messages);
    pending.resolve({ ...mutation, committed: true, published: !sameTranscriptPublication(pending.before, messages),
      addedMessageCount: messages.filter(message => !beforeIDs.has(message.id)).length });
  }

  retire() {
    const pending = this.pending;
    this.pending = null;
    pending?.resolve({ committed: false, published: false, addedMessageCount: 0 });
  }
}


/** A prepend preserves the original edge and every retained old row's order.
 * Bounded newer-tail eviction is legal, but reordering is not a prepend. */
export function historyPublicationMutation(before: readonly WorkspaceMessage[], after: readonly WorkspaceMessage[]): Pick<OlderHistoryLoadResult, 'mutation' | 'boundaryMessageID'> {
  if (sameTranscriptPublication(before, after)) return { mutation: 'unchanged' };
  const positions = new Map(before.map((row, index) => [row.id, index]));
  const retained = after.filter(row => positions.has(row.id));
  const omission = before.find(row => row.historyOmission)?.historyOmission;
  const edge = omission ? before.find(row => row.id === omission.firstTailMessageId) : before[0];
  const at = edge ? after.findIndex(row => row.id === edge.id) : -1;
  const ordered = retained.every((row, index) => index === 0 || positions.get(retained[index - 1]!.id)! < positions.get(row.id)!);
  const prefix = after.slice(0, at);
  return edge && at > 0 && ordered && prefix.some(row => !positions.has(row.id))
    && prefix.every(row => !positions.has(row.id) || row.id === omission?.promptMessageId)
    ? { mutation: 'prepend', boundaryMessageID: edge.id } : { mutation: 'refresh' };
}

export function useHistoryPublicationReceipt(messages: readonly WorkspaceMessage[]) {
  const owner = useRef(new HistoryPublicationReceiptOwner());
  const committed = useRef(messages);
  const [revision, setRevision] = useState(0);
  useLayoutEffect(() => {
    committed.current = messages;
    owner.current.commit(revision, messages);
  });
  useLayoutEffect(() => () => owner.current.retire(), []);
  // Call immediately after queuing the page state, in the same update lane.
  // Completion is outside the state updater and cannot precede its commit.
  return useCallback((owns: () => boolean) => {
    const ticket = owner.current.stage(committed.current, owns);
    setRevision(ticket.revision);
    return { publication: ticket.publication };
  }, []);
}
