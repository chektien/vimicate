import type { WorkspaceMessage, WorkspaceProject } from '../workspace/workspaceTypes';
import { authoritativeHistoryChronology, messagesFromPayload } from '../workspace/historyMessageProjection';

type Target = { project: WorkspaceProject; token: string; catchup: boolean };
type Context = { revision: string; owns: () => boolean; selectedSessionKey?: string | undefined; catchupSessions?: ReadonlySet<string> };
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
  constructor(private read: (key: string, offset: number) => Promise<unknown>, private publish: (rows: WorkspaceMessage[]) => void) {}

  reconcile(projects: WorkspaceProject[], context: Context) {
    if (this.context?.revision !== context.revision) this.retire();
    this.context = context;
    this.targets = new Map(projects.filter(project => project.sessionId).slice(0, MAX_SESSIONS)
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      .map(project => { const catchup = context.catchupSessions?.has(project.sessionKey) ?? false; return [project.sessionKey, { project, catchup, token: JSON.stringify([asyncQuestionDiscoveryToken(project), catchup]) }]; }));
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
      if (key === context.selectedSessionKey && !target.catchup || this.active.has(key) || this.attempted.get(key) === target.token) continue;
      const epoch = this.epoch; const ticket = {}; this.active.set(key, ticket);
      // Failed reads retry on reconnect, foreground/manual refresh or changed
      // census authority, never spin immediately against a failing Gateway.
      this.attempted.set(key, target.token);
      const owns = () => epoch === this.epoch && context.owns() && this.targets.get(key)?.token === target.token;
      void Promise.resolve().then(() => this.readWindow(key, target, owns)).then(rows => { if (rows && owns()) this.publish(rows); }).catch(() => { /* Retain known facts without inventing an answer or retry loop. */ }).finally(() => {
        if (this.active.get(key) === ticket) this.active.delete(key);
        this.pump();
      });
    }
  }
  private async readWindow(key: string, target: Target, owns: () => boolean) {
    const pages: WorkspaceMessage[][] = []; let offset = 0, total: unknown, bytes = 0;
    for (let page = 0; page < (target.catchup ? 16 : 1); page++) {
      if (!owns()) return;
      const value = await this.read(key, offset);
      if (!owns()) return;
      const projected = asyncQuestionDiscoveryRows(value, target.project); if (!projected) return;
      // This private reconciliation vector retains identities and causal
      // witnesses, not unrelated tool output, media or assistant prose.
      const rows = projected.map(row => {
        const { tool: _tool, attachments: _attachments, chatCumulativeText: _chat, terminalReplyText: _terminal, ...evidence } = row;
        return { ...evidence, text: row.role === 'user' ? row.text : '' };
      });
      bytes += JSON.stringify(rows).length * 2; if (bytes > 4 * 1024 * 1024) return;
      const payload = value as Record<string, unknown>;
      if (target.catchup) {
        // Older adapters without pagination still support the original scoped
        // latest-page reconciliation, but cannot authorize a deeper read.
        if (offset === 0 && payload.offset === undefined && payload.totalMessages === undefined && payload.hasMore === undefined) return rows;
        // All pages must belong to one append-only snapshot. A growing tail
        // restarts only under fresh census/refresh authority, never in a loop.
        if (payload.offset !== offset || !Number.isSafeInteger(payload.totalMessages) || (payload.totalMessages as number) < 0
          || total !== undefined && total !== payload.totalMessages || typeof payload.hasMore !== 'boolean') return;
        total = payload.totalMessages;
      }
      pages.unshift(rows);
      if (!target.catchup || !payload.hasMore) break;
      if (!Number.isSafeInteger(payload.nextOffset) || (payload.nextOffset as number) <= offset
        || (payload.nextOffset as number) > (total as number)) return;
      offset = payload.nextOffset as number;
    }
    // Do not observe an answer-only page before its older question. Publish
    // one bounded chronological vector without touching visible history.
    return authoritativeHistoryChronology(pages.flat());
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
