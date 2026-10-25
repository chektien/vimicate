import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import type { LiveMessagePublicationTimers } from './liveMessagePublication';

const REFRESH_DELAY_MS = 120;

/** Coalesce host-timestamp hydration for untimestamped live preambles. */
export function scheduleSharedNarrationRefresh(
  timers: LiveMessagePublicationTimers,
  message: WorkspaceMessage | null,
  sessionKey: string,
  refresh: (owner: string) => Promise<void>,
  onFailure: (error: unknown) => void = () => undefined,
) {
  if (message?.role !== 'narration' || !sessionKey) return false;
  timers.cancel(sessionKey);
  return timers.schedule(
    sessionKey,
    REFRESH_DELAY_MS,
    () => refresh(sessionKey),
    onFailure,
  );
}
