import type { WorkspaceMessage, WorkspaceProject } from '../workspace/workspaceTypes';
import { authoritativeHistoryChronology, messagesFromPayload } from '../workspace/historyMessageProjection';

type Target = { project: WorkspaceProject; token: string };
type Context = { revision: string; owns: () => boolean; selectedSessionKey?: string | undefined };
const MAX_SESSIONS = 1000;
const CONCURRENCY = 2;
export function asyncQuestionDiscoveryToken(project: WorkspaceProject) {
  return JSON.stringify([project.sessionKey, project.sessionId, project.sessionStartedAtMs, project.updatedAt]);
}

/** Read-only, bounded latest-history reconciliation. Never selects, subscribes,
 * acknowledges a read, or publishes transcript/unread/recency state. */
export class AsyncQuestionDiscovery {
  private context: Context | null = null;
  private targets = new Map<string, Target>();
  private attempted = new Map<string, string>();
  private active = new Map<string, object>();
  private epoch = 0;
  constructor(private read: (key: string) => Promise<unknown>, private publish: (rows: WorkspaceMessage[]) => void) {}

  reconcile(projects: WorkspaceProject[], context: Context) {
    if (this.context?.revision !== context.revision) this.retire();
    this.context = context;
    this.targets = new Map(projects.filter(project => project.sessionId).slice(0, MAX_SESSIONS)
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      .map(project => [project.sessionKey, { project, token: asyncQuestionDiscoveryToken(project) }]));
    for (const key of this.attempted.keys()) if (!this.targets.has(key)) this.attempted.delete(key);
    this.pump();
  }

  retire() {
    this.epoch++; this.context = null; this.targets.clear(); this.attempted.clear();
    // Keep transport flights counted until they settle. Retiring authority does
    // not cancel another consumer's socket or exceed the concurrency bound.
  }

  private pump() {
    const context = this.context;
    if (!context?.owns()) return;
    for (const [key, target] of this.targets) {
      if (this.active.size >= CONCURRENCY) break;
      if (key === context.selectedSessionKey || this.active.has(key) || this.attempted.get(key) === target.token) continue;
      const epoch = this.epoch; const ticket = {}; this.active.set(key, ticket);
      // Failed reads retry on reconnect, foreground/manual refresh or changed
      // census authority, never spin immediately against a failing Gateway.
      this.attempted.set(key, target.token);
      const owns = () => epoch === this.epoch && context.owns() && this.targets.get(key)?.token === target.token;
      void Promise.resolve().then(() => owns() ? this.read(key) : undefined).then(payload => {
        if (!owns()) return;
        const rows = asyncQuestionDiscoveryRows(payload, target.project);
        if (rows) this.publish(rows);
      }).catch(() => { /* Retain known facts without inventing an answer or retry loop. */ }).finally(() => {
        if (this.active.get(key) === ticket) this.active.delete(key);
        this.pump();
      });
    }
  }
}

/** The response must prove both its route and immutable history generation. */
export function asyncQuestionDiscoveryRows(value: unknown, project: WorkspaceProject): WorkspaceMessage[] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  if (payload.sessionKey !== project.sessionKey || payload.sessionId !== project.sessionId
    || !Array.isArray(payload.messages) || payload.messages.length > 80) return null;
  return authoritativeHistoryChronology(messagesFromPayload(payload, project.path));
}
