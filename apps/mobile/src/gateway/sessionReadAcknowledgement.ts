import { launchGuardedBackgroundTask } from '../async/guardedBackgroundTask';
import type { WorkspaceProject } from '../workspace/workspaceTypes';
import type { OpenClawClient } from './OpenClawClient';

/** A read belongs to the concrete row opened, never a later selected route. */
export function acknowledgeSelectedSessionRead(
  client: Pick<OpenClawClient, 'status' | 'request'>,
  project: WorkspaceProject | undefined,
  ownsSelection: () => boolean,
  refresh: () => Promise<unknown>,
  onFailure: () => void,
) {
  if (client.status !== 'connected' || !project?.sessionId || !ownsSelection()) return;
  const params = {
    key: project.sessionKey, unread: false,
    expectedSessionId: project.sessionId,
    // Guard a newer explicit mark-unread made while this request is in flight.
    expectedMarkedUnreadAt: project.markedUnreadAt ?? null,
  };
  launchGuardedBackgroundTask(async () => {
    await client.request('sessions.patch', params);
    // Re-read authority even when a newer unread marker refused this ack.
    // Selection/scene retirement must not revive work or publish stale detail.
    if (ownsSelection()) await refresh();
  }, () => { if (ownsSelection()) onFailure(); });
}
