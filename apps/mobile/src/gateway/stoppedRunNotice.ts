import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import type { SessionRunRegistry } from './sessionRunRegistry';

/** A confirmed Stop changes the presentation of its exact native abort, not
 * provider failures or errors from a successor. Keep the receipt's identity
 * and timing so later snapshots still converge with the same visible row. */
export function stoppedRunNotices(messages: WorkspaceMessage[], registry: Pick<SessionRunRegistry, 'stopWasConfirmed'>) {
  let result = messages;
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]!;
    if (message.role !== 'error' || !message.sessionKey || !message.runId
      || !registry.stopWasConfirmed(message.sessionKey, message.runId)
      || !/^(?:session-failure:|live-chat-|live-error-)/.test(message.id)
      || !/^(?:Run failed · )?(?:agent run aborted|CLI run aborted)(?: \| OPENCLAW_DIRECT_ABORT)?$/.test(message.text.trim())) continue;
    if (result === messages) result = [...messages];
    result[i] = { ...message, role: 'command', state: 'complete', text: 'Run stopped at your request.' };
  }
  return result;
}
