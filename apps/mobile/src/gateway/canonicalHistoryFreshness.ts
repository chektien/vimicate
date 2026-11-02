import { BoundedSessionCache } from '../workspace/boundedSessionCache';
import type { WorkspaceProject } from '../workspace/workspaceTypes';
import { gatewaySessionGeneration } from './registrySessionIdentity';

const MAX_REUSE_AGE_MS = 10 * 60_000;

/**
 * Remembers which census/event state each successful canonical latest read
 * reflected. Thread re-entry and reconnect hydration may reuse the retained
 * tail only while that state is unchanged; every other history caller still
 * reads the Gateway. Missing activity time means never reusable.
 */
export class CanonicalHistoryFreshness {
  tokenFor: (sessionKey: string) => string | undefined = () => undefined;
  private readonly recorded = new BoundedSessionCache<{ token: string; at: number }>(64);

  token(sessionKey: string) { return this.tokenFor(sessionKey); }

  record(sessionKey: string, token: string, now = Date.now()) { this.recorded.store(sessionKey, { token, at: now }); }

  isFresh(sessionKey: string, now = Date.now()) {
    const token = this.tokenFor(sessionKey); const entry = this.recorded.restore(sessionKey);
    return Boolean(token && entry && entry.token === token && now - entry.at <= MAX_REUSE_AGE_MS);
  }
}

/** Event revision covers live changes; census activity covers changes missed while disconnected. */
export function canonicalHistoryToken(eventRevision: string, project: WorkspaceProject | undefined, registry: Record<string, unknown> | null) {
  if (!project || typeof project.updatedAt !== 'number') return undefined;
  return JSON.stringify([eventRevision, project.sessionId ?? '', project.updatedAt, project.state, project.runPhase ?? '', gatewaySessionGeneration(project, registry)]);
}
