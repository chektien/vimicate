import { useMemo } from 'react';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import type { SessionRunRegistry } from './sessionRunRegistry';
import { stoppedRunNotices } from './stoppedRunNotice';

/** Presentation applies equally to live, reloaded and older-review history.
 * The existing run owner remains the sole authority for Stop confirmation. */
export function useStoppedRunNotices(messages: WorkspaceMessage[], registry: SessionRunRegistry): WorkspaceMessage[];
export function useStoppedRunNotices(messages: WorkspaceMessage[] | undefined, registry: SessionRunRegistry): WorkspaceMessage[] | undefined;
export function useStoppedRunNotices(messages: WorkspaceMessage[] | undefined, registry: SessionRunRegistry) {
  const confirmations = messages?.map(row => row.sessionKey && row.runId && registry.stopWasConfirmed(row.sessionKey, row.runId) ? '1' : '0').join('') ?? '';
  return useMemo(() => messages && stoppedRunNotices(messages, registry), [messages, registry, confirmations]);
}
