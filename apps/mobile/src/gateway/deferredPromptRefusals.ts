import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { SessionHistoryCache } from './sessionHistoryCache';
import type { Dispatch, SetStateAction } from 'react';
import type { HistoryPublicationAuthority } from './historyPublicationAuthority';
import type { SessionHistoryViewCache } from './sessionHistoryView';

type Cell<T> = { current: T };

/** Exact local-row removals held by the existing history owner while its scene
 * is suspended. No sender state, replay, timer or background publication. */
export class DeferredPromptRefusals {
  private readonly rejected = new Map<string, { sessionKey: string; optimisticID: string }>();
  constructor(private readonly limit = 256) {}

  reject(sessionKey: string, optimisticID: string) {
    if (!sessionKey.trim() || !optimisticID.startsWith('local-') || optimisticID.length <= 6 || this.limit < 1) return false;
    const key = JSON.stringify([sessionKey, optimisticID]);
    this.rejected.delete(key);
    this.rejected.set(key, { sessionKey, optimisticID });
    while (this.rejected.size > this.limit) this.rejected.delete(this.rejected.keys().next().value!);
    return true;
  }

  sessionKeys() { return [...new Set([...this.rejected.values()].map(value => value.sessionKey))]; }

  filter(sessionKey: string, rows: WorkspaceMessage[]) {
    const next = rows.filter(row => !this.removes(sessionKey, row));
    return next.length === rows.length ? rows : next;
  }

  filterVisible(rows: WorkspaceMessage[]) {
    const next = rows.filter(row => !row.sessionKey || !this.removes(row.sessionKey, row));
    return next.length === rows.length ? rows : next;
  }

  statePublisher(authority: Cell<HistoryPublicationAuthority | null>, setState: Dispatch<SetStateAction<WorkspaceMessage[]>>) {
    return (action: SetStateAction<WorkspaceMessage[]>) => {
      const owner = authority.current; if (!owner?.isActive) return;
      const revision = owner.capture();
      setState(current => owner.owns(revision) ? this.filterVisible(typeof action === 'function' ? action(current) : action) : current);
    };
  }

  flush(context: { authority: Cell<HistoryPublicationAuthority | null>; history: Cell<SessionHistoryCache>; latest: Cell<SessionHistoryCache>;
    views: Cell<SessionHistoryViewCache>; persist: (key: string, rows: WorkspaceMessage[]) => void;
    persistReview: (key: string, rows: WorkspaceMessage[]) => void; publish: Dispatch<SetStateAction<WorkspaceMessage[]>> }) {
    if (!context.authority.current?.isActive) return;
    for (const key of this.sessionKeys()) {
      const visible = context.history.current.restore(key); const latest = context.latest.current.restore(key);
      if (visible) context.history.current.store(key, visible);
      if (latest) { context.latest.current.store(key, latest); context.persist(key, context.latest.current.restore(key) ?? []); }
      if (visible && context.views.current.restore(key)?.windowMode === 'older') context.persistReview(key, context.history.current.restore(key) ?? []);
    }
    context.publish(current => current);
  }

  private removes(sessionKey: string, row: WorkspaceMessage) {
    return row.sessionKey === sessionKey && row.role === 'user' && row.source === 'local'
      && !row.transcriptSessionId && !row.displayPosition && !row.narrationItemId
      && this.rejected.has(JSON.stringify([sessionKey, row.id]));
  }
}

/** Every existing merge/cache writer shares the same refusal filter. Reads
 * stay stable for useSyncExternalStore; resume owns pruning dormant caches. */
export class RefusalFilteredHistoryCache extends SessionHistoryCache {
  constructor(private readonly refusals: DeferredPromptRefusals) { super(); }
  override store(sessionKey: string, rows: WorkspaceMessage[]) { super.store(sessionKey, this.refusals.filter(sessionKey, rows)); }
}
