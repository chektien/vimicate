import type { WorkspaceMessage } from '../workspace/workspaceTypes';

export function shouldRefreshCanonicalHistory(runActive: boolean, terminal: boolean) {
  return terminal || !runActive;
}

/**
 * A retained run owner suppresses routine canonical refreshes while live rows
 * stream. It cannot suppress the first real transcript hydration, however:
 * the persisted project rail can be selected before a cold connection is
 * ready, leaving only Vimicate's local startup row (or no rows) mounted when
 * the authoritative session census arrives.
 */
export function shouldHydrateSelectedHistory(
  generationChanged: boolean,
  runActive: boolean,
  visibleMessages: readonly WorkspaceMessage[],
  freshConnection = false,
) {
  return freshConnection
    || generationChanged
    || !runActive
    || visibleMessages.length === 0
    || visibleMessages.some((message) => message.id === 'startup-1' && message.role === 'system' && message.source == null);
}
