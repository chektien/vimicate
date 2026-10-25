import type { WorkspaceProject } from '../workspace/workspaceTypes';

/**
 * Registry refreshes complete asynchronously. An ordinary refresh follows the
 * selection that is live when its result arrives; only a mutation that creates
 * or closes a thread may provide an intentional replacement target.
 */
export function sessionSelectionAfterRefresh(
  projects: WorkspaceProject[],
  currentSelection: string,
  requestedSelection = '',
  currentProjectID = '',
) {
  if (requestedSelection && projects.some((project) => project.sessionKey === requestedSelection)) return requestedSelection;
  if (projects.some((project) => project.sessionKey === currentSelection)) return currentSelection;
  // A durable thread can retain its registry identity while OpenClaw moves
  // its current binding to a different stable session key. Follow that exact
  // durable identity in place; falling back to the first project leaves the
  // completed run's canonical answer parked on the new binding until the user
  // manually reselects the thread.
  if (currentProjectID) {
    const rebound = projects.find((project) => project.id === currentProjectID);
    if (rebound) return rebound.sessionKey;
  }
  return projects[0]?.sessionKey ?? '';
}
