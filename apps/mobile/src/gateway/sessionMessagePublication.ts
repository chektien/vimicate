import type { SetStateAction } from 'react';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import type { HistoryPublicationAuthority } from './historyPublicationAuthority';
import type { SessionHistoryCache } from './sessionHistoryCache';
import type { SessionHistoryViewCache } from './sessionHistoryView';
import { parkedSessionHistoryPublication, type SessionMessagePublicationIntent } from './historyReviewPublication';
import { sessionOwnsVisiblePublication } from './sessionPublicationOwnership';
import { sameTranscriptPublication } from './transcriptPublicationEquality';

type Cell<T> = { current: T };
type MessageAction = SetStateAction<WorkspaceMessage[]>;
type Context = {
  selectedRef: Cell<string>;
  activeSessionKey: Cell<string>;
  publicationAuthority: Cell<HistoryPublicationAuthority | null>;
  windowMode: Cell<'latest' | 'older'>;
  historyCache: Cell<SessionHistoryCache>;
  latestTailCache: Cell<SessionHistoryCache>;
  historyViewCache: Cell<SessionHistoryViewCache>;
  setMessageState: (action: MessageAction) => void;
  persistLater: (key: string, rows: WorkspaceMessage[]) => void;
  persistHistoryReview: (key: string, rows: WorkspaceMessage[]) => void;
};

/** Actions over the existing history owner: no new state, timer or authority. */
export function createSessionMessagePublisher(context: Context) {
  const { selectedRef, activeSessionKey, publicationAuthority, windowMode, historyCache,
    latestTailCache, historyViewCache, setMessageState, persistLater, persistHistoryReview } = context;
  return (sessionKey: string, action: MessageAction, intent: SessionMessagePublicationIntent = 'live') => {
    if (!sessionKey || !publicationAuthority.current?.isActive) return;
    const activityRevision = publicationAuthority.current.capture();
    const ownsVisible = () => sessionOwnsVisiblePublication(sessionKey, selectedRef.current, activeSessionKey.current);
    const publish = (visible: WorkspaceMessage[], mode: 'latest' | 'older') => {
      const latest = latestTailCache.current.restore(sessionKey) ?? visible;
      const result = parkedSessionHistoryPublication(mode, visible, latest, action, intent);
      const visibleChanged = result.replaceVisible && !sameTranscriptPublication(visible, result.visible);
      if (visibleChanged) {
        historyCache.current.store(sessionKey, result.visible);
        if (mode === 'older') persistHistoryReview(sessionKey, result.visible);
      }
      if (!sameTranscriptPublication(latest, result.latest)) {
        latestTailCache.current.store(sessionKey, result.latest);
        persistLater(sessionKey, result.latest);
      }
      return visibleChanged ? result.visible : visible;
    };
    const publishParked = () => publish(historyCache.current.restore(sessionKey) ?? [],
      historyViewCache.current.restore(sessionKey)?.windowMode ?? 'latest');
    if (intent === 'optimistic-prompt') {
      if (!ownsVisible()) return;
      // A prompt is accepted into the local transcript before the first
      // Gateway await. Stage it in the session owner before React can defer its
      // updater across a project round trip; the later UI commit then consumes
      // the newest cached tail rather than evaluating the append a second time.
      publish(historyCache.current.restore(sessionKey) ?? [], windowMode.current);
      setMessageState(current => {
        if (!publicationAuthority.current?.owns(activityRevision) || !ownsVisible() || windowMode.current === 'older') return current;
        const staged = latestTailCache.current.restore(sessionKey) ?? current;
        return sameTranscriptPublication(current, staged) ? current : staged;
      });
      return;
    }
    if (!ownsVisible()) { publishParked(); return; }
    if (windowMode.current === 'older' && intent === 'live') {
      publish(historyCache.current.restore(sessionKey) ?? [], 'older');
      return;
    }
    setMessageState(current => {
      if (!publicationAuthority.current?.owns(activityRevision)) return current;
      if (!ownsVisible()) { publishParked(); return current; }
      return publish(current, windowMode.current);
    });
  };
}
