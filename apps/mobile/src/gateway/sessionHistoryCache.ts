import { sameTranscriptPublication } from './transcriptPublicationEquality';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { BoundedSessionCache } from '../workspace/boundedSessionCache';
import { coalesceTranscriptIdentities } from './transcriptIdentityWall';

export class SessionHistoryCache {
  private readonly listeners = new Set<() => void>();
  private notificationPending = false;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private readonly values: BoundedSessionCache<WorkspaceMessage[]>;

  constructor(sessionLimit = 64) {
    this.values = new BoundedSessionCache(sessionLimit);
  }

  store(sessionKey: string, messages: WorkspaceMessage[]) {
    const next = coalesceTranscriptIdentities(messages);
    const previous = this.values.restore(sessionKey);
    if (previous && sameTranscriptPublication(previous, next)) return;
    this.values.store(sessionKey, next);
    // Cache writes can occur inside React's history updater. Notify after the
    // transaction, coalesced once, never update another component during render.
    if (this.listeners.size && !this.notificationPending) {
      this.notificationPending = true;
      queueMicrotask(() => { this.notificationPending = false; this.listeners.forEach(listener => listener()); });
    }
  }

  restore(sessionKey: string) {
    return this.values.restore(sessionKey);
  }
}

export function shouldResetHistoryForSelection(currentSessionKey: string, nextSessionKey: string) {
  return Boolean(nextSessionKey && nextSessionKey !== currentSessionKey);
}

export function persistedTranscriptRestorePublication(
  renderedMessages: WorkspaceMessage[],
  selectedSessionTail: WorkspaceMessage[],
  persistedMessages: WorkspaceMessage[],
) {
  // React may evaluate this state updater before the preceding project-switch
  // updater has removed the previous session's rendered rows. Only data owned
  // by the selected session may veto its persisted cold-start restoration.
  return selectedSessionTail.length
    ? { publish: false, messages: renderedMessages }
    : { publish: true, messages: persistedMessages };
}
