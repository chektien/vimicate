import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import type { LiveMessagePublicationTimers } from './liveMessagePublication';

// Each refresh rereads the whole narration snapshot, so a streaming run must
// not trigger one per preamble. One fixed, non-extending window per session.
const REFRESH_WINDOW_MS = 2000;

/** Coalesce host-timestamp hydration for untimestamped live preambles. True while one is pending. */
export function scheduleSharedNarrationRefresh(
  timers: LiveMessagePublicationTimers,
  message: WorkspaceMessage | null,
  sessionKey: string,
  refresh: (owner: string) => Promise<void>,
  onFailure: (error: unknown) => void = () => undefined,
) {
  if (message?.role !== 'narration' || !sessionKey) return false;
  timers.schedule(sessionKey, REFRESH_WINDOW_MS, () => refresh(sessionKey), onFailure);
  return true;
}
