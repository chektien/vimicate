import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { BoundedSessionCache } from '../workspace/boundedSessionCache';

type Facts = { resolved: Map<string, boolean>; pendingCount: number; overflowPending: boolean };
const MAX_APPROVAL_IDENTITIES = 1024;

/** Presentation facts only. Absence from a bounded transcript is not resolution.
 * Terminal identities are monotonic until their session owner is evicted. At
 * capacity retain identities rather than admitting a replay after forgetting its
 * terminal fact. An overflow request conservatively keeps attention until reset.
 */
export class SessionApprovalAttention {
  private readonly sessions: BoundedSessionCache<Facts>;
  revision = 0;
  constructor(sessionLimit = 64, private readonly onResolved?: (sessionKey: string) => void) { this.sessions = new BoundedSessionCache(sessionLimit); }
  needsUser(sessionKey: string) {
    const facts = this.sessions.restore(sessionKey);
    return Boolean(facts && (facts.overflowPending || facts.pendingCount > 0));
  }
  pendingIds(sessionKey: string) {
    return [...(this.sessions.restore(sessionKey)?.resolved ?? [])].flatMap(([id, resolved]) => resolved ? [] : [id]);
  }
  observe(sessionKey: string, rows: WorkspaceMessage[]) {
    const approvals = rows.flatMap(row => row.sessionKey === sessionKey && row.approval ? [row.approval] : []);
    if (!sessionKey || !approvals.length) return false;
    const before = this.needsUser(sessionKey);
    const facts = this.sessions.restore(sessionKey) ?? { resolved: new Map<string, boolean>(), pendingCount: 0, overflowPending: false };
    for (const approval of approvals) {
      if (!approval.id) continue;
      const previous = facts.resolved.get(approval.id);
      if (previous === true) continue;
      if (previous === undefined && facts.resolved.size >= MAX_APPROVAL_IDENTITIES) {
        if (!approval.resolved) facts.overflowPending = true;
        continue;
      }
      if (previous === false && approval.resolved) facts.pendingCount -= 1;
      else if (previous === undefined && !approval.resolved) facts.pendingCount += 1;
      facts.resolved.set(approval.id, approval.resolved);
    }
    const evicted = this.sessions.store(sessionKey, facts);
    const after = this.needsUser(sessionKey);
    if (before && !after) this.onResolved?.(sessionKey);
    const changed = before !== after || Boolean(evicted);
    if (changed) this.revision += 1;
    return changed;
  }
  resolveAbsent(sessionKey: string, candidates: readonly string[], pending: readonly string[]) {
    const facts = this.sessions.restore(sessionKey);
    if (!facts) return false;
    const before = this.needsUser(sessionKey); const retained = new Set(pending);
    for (const id of candidates) if (facts.resolved.get(id) === false && !retained.has(id)) { facts.resolved.set(id, true); facts.pendingCount -= 1; }
    const after = this.needsUser(sessionKey);
    if (before && !after) this.onResolved?.(sessionKey);
    const changed = before !== after;
    if (changed) this.revision += 1;
    return changed;
  }
  clear() { this.sessions.clear(); this.revision += 1; }
}
