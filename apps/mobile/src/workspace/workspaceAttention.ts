import { sessionActivityTimestamp } from './sessionActivityTimestamp';
import type { GatewayFrame } from '../gateway/gatewayEvents';

const MAX_IDENTITIES = 2_048;

export type WorkspaceAttentionSignal = { sessionKey: string; identity: string; occurredAt: number };
type SessionCensusPhase = 'active' | 'terminal' | 'other';
type SessionCensusSnapshot = {
  activityAt: number;
  phase: SessionCensusPhase;
  runId: string;
  sessionId: string;
};

export function workspaceAttentionSignal(frame: GatewayFrame, now = Date.now()): WorkspaceAttentionSignal | null {
  const event = text(frame.event).toLocaleLowerCase();
  const payload = record(frame.payload);
  const request = record(payload.request);
  const data = record(payload.data);
  const sessionKey = text(payload.destinationSessionKey) || text(payload.sessionKey) || text(request.sessionKey);
  if (!sessionKey) return null;
  const chatFinal = event === 'chat' && ['final', 'complete', 'completed'].includes(text(payload.state).toLocaleLowerCase());
  const scheduledCompletion = /(?:cron|schedule|delivery)/.test(event) && /(?:complete|completed|result|delivered)/.test(event);
  const lifecycleTerminal = event === 'agent'
    && ['lifecycle', 'fallback'].includes(text(payload.stream).toLocaleLowerCase())
    && /^(?:end|complete|completed|failed|error)$/.test(text(data.phase).toLocaleLowerCase());
  if (!chatFinal && !scheduledCompletion && !lifecycleTerminal) return null;
  const runId = text(payload.runId) || text(data.runId);
  const explicitID = text(payload.deliveryId) || text(payload.id) || text(payload.jobRunId) || runId;
  const occurredAt = timestamp(data.endedAt ?? data.endedAtMs ?? payload.timestamp ?? payload.updatedAt ?? payload.completedAt ?? payload.endedAt) ?? now;
  const fallbackID = `${occurredAt}\u0000${stableHash(printable(payload.message ?? payload.result ?? data))}`;
  const identity = `${scheduledCompletion ? 'delivery.complete' : 'session.complete'}\u0000${sessionKey}\u0000${explicitID || fallbackID}`;
  return { sessionKey, identity, occurredAt };
}

export class WorkspaceAttentionLedger {
  private identities = new Set<string>();
  private unreadSessions = new Set<string>();
  private sessionCensus = new Map<string, SessionCensusSnapshot>();

  restore(raw: string | null) {
    this.identities.clear();
    this.unreadSessions.clear();
    this.sessionCensus.clear();
    if (!raw) return;
    try {
      const value: unknown = JSON.parse(raw);
      const identities = Array.isArray(value) ? value : record(value).identities;
      const unread = Array.isArray(value) ? [] : record(value).unreadSessions;
      // Old snapshots used the metadata clock; rebasing avoids suppressing real
      // activity until it catches up with a previous read acknowledgement.
      const census = record(value).activityClockVersion === 1 ? record(value).sessionCensus : [];
      if (Array.isArray(identities)) {
        for (const identity of identities.slice(-MAX_IDENTITIES)) if (typeof identity === 'string') this.identities.add(identity);
      }
      if (Array.isArray(unread)) {
        for (const sessionKey of unread.slice(-MAX_IDENTITIES)) if (typeof sessionKey === 'string') this.unreadSessions.add(sessionKey);
      }
      if (Array.isArray(census)) {
        for (const entry of census.slice(-MAX_IDENTITIES)) {
          if (!Array.isArray(entry) || typeof entry[0] !== 'string') continue;
          this.sessionCensus.set(entry[0], {
            activityAt: positiveNumber(entry[1]),
            phase: censusPhase(entry[2]),
            runId: text(entry[3]),
            sessionId: text(entry[4]),
          });
        }
      }
    } catch { /* Ignore invalid local projection state. */ }
  }

  accept(identity: string) {
    if (!identity || this.identities.has(identity)) return false;
    this.identities.add(identity);
    while (this.identities.size > MAX_IDENTITIES) this.identities.delete(this.identities.values().next().value!);
    return true;
  }

  markUnread(sessionKey: string) {
    if (!sessionKey) return;
    this.unreadSessions.delete(sessionKey);
    this.unreadSessions.add(sessionKey);
    while (this.unreadSessions.size > MAX_IDENTITIES) this.unreadSessions.delete(this.unreadSessions.values().next().value!);
  }
  clearUnread(sessionKey: string) { this.unreadSessions.delete(sessionKey); }
  isUnread(sessionKey: string) { return this.unreadSessions.has(sessionKey); }

  /**
   * Global session subscriptions can report only that the census changed.
   * Derive output attention from an advancing authoritative terminal snapshot,
   * while treating the first observed census as a baseline rather than making
   * every historical completion unread after install.
   */
  reconcileSessionCensus(payload: Record<string, unknown>) {
    const signals: WorkspaceAttentionSignal[] = [];
    let changed = false;
    for (const value of sessionRows(payload)) {
      const session = record(value);
      const sessionKey = text(session.sessionKey) || text(session.key) || text(session.id);
      if (!sessionKey) continue;
      const candidate = censusSnapshot(session);
      const previous = this.sessionCensus.get(sessionKey);
      if (!previous) {
        this.recordSessionCensus(sessionKey, candidate);
        changed = true;
        continue;
      }
      if (candidate.activityAt > 0 && previous.activityAt > 0 && candidate.activityAt < previous.activityAt) continue;
      const timestampAdvanced = candidate.activityAt > previous.activityAt;
      const ownerChanged = Boolean(
        (candidate.runId && candidate.runId !== previous.runId)
        || (candidate.sessionId && candidate.sessionId !== previous.sessionId),
      );
      const becameTerminal = candidate.phase === 'terminal' && previous.phase !== 'terminal';
      const equivalent = candidate.activityAt === previous.activityAt
        && candidate.phase === previous.phase
        && candidate.runId === previous.runId
        && candidate.sessionId === previous.sessionId;
      if (equivalent) continue;
      // A late same-owner running row must not reopen a completion. A genuinely
      // newer activity timestamp or owner may start the next generation.
      if (previous.phase === 'terminal' && candidate.phase === 'active' && !timestampAdvanced && !ownerChanged) continue;
      if (!timestampAdvanced && !ownerChanged && !becameTerminal) continue;
      this.recordSessionCensus(sessionKey, candidate);
      changed = true;
      if (candidate.phase !== 'terminal' || (!timestampAdvanced && !ownerChanged && previous.phase !== 'active')) continue;
      // OpenClaw's authoritative terminal census intentionally clears
      // `activeRunIds`. The run that just ended therefore belongs to the
      // preceding active snapshot, not to the now-idle candidate.
      const occurrenceID = candidate.runId || previous.runId || candidate.sessionId || String(candidate.activityAt);
      if (!occurrenceID) continue;
      signals.push({
        sessionKey,
        identity: `session.complete\u0000${sessionKey}\u0000${occurrenceID}`,
        occurredAt: candidate.activityAt || Date.now(),
      });
    }
    return { changed, signals };
  }

  serialized() {
    return JSON.stringify({
      activityClockVersion: 1,
      identities: [...this.identities],
      unreadSessions: [...this.unreadSessions],
      sessionCensus: [...this.sessionCensus].map(([sessionKey, snapshot]) => [
        sessionKey,
        snapshot.activityAt,
        snapshot.phase,
        snapshot.runId,
        snapshot.sessionId,
      ]),
    });
  }

  private recordSessionCensus(sessionKey: string, snapshot: SessionCensusSnapshot) {
    this.sessionCensus.delete(sessionKey);
    this.sessionCensus.set(sessionKey, snapshot);
    while (this.sessionCensus.size > MAX_IDENTITIES) this.sessionCensus.delete(this.sessionCensus.keys().next().value!);
  }
}

export function acceptWorkspaceAttention(
  ledger: WorkspaceAttentionLedger,
  signal: WorkspaceAttentionSignal,
  selectedSessionKey: string,
) {
  if (!ledger.accept(signal.identity)) return { accepted: false, unread: false };
  const unread = signal.sessionKey !== selectedSessionKey;
  if (unread) ledger.markUnread(signal.sessionKey);
  return { accepted: true, unread };
}

export function acceptSessionCensusAttention(
  ledger: WorkspaceAttentionLedger,
  payload: Record<string, unknown>,
  selectedSessionKey: string,
  onAccepted: (sessionKey: string, occurredAt: number, unread: boolean) => void,
) {
  const reconciliation = ledger.reconcileSessionCensus(payload);
  let accepted = false;
  for (const signal of reconciliation.signals) {
    const acceptance = acceptWorkspaceAttention(ledger, signal, selectedSessionKey);
    if (!acceptance.accepted) continue;
    accepted = true;
    onAccepted(signal.sessionKey, signal.occurredAt, acceptance.unread);
  }
  return reconciliation.changed || accepted;
}

function record(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function text(value: unknown) { return typeof value === 'string' ? value.trim() : ''; }
function timestamp(value: unknown) { if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null; return value < 100_000_000_000 ? value * 1_000 : value; }
function printable(value: unknown) { try { return JSON.stringify(value); } catch { return String(value); } }
function stableHash(value: string) { let hash = 0x811c9dc5; for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 0x01000193); } return (hash >>> 0).toString(36); }
function positiveNumber(value: unknown) { return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0; }
function censusPhase(value: unknown): SessionCensusPhase { return value === 'active' || value === 'terminal' ? value : 'other'; }
function sessionRows(payload: Record<string, unknown>) {
  for (const key of ['sessions', 'items', 'results']) if (Array.isArray(payload[key])) return (payload[key] as unknown[]).slice(0, 1_000);
  return [];
}
function censusSnapshot(session: Record<string, unknown>): SessionCensusSnapshot {
  const status = (text(session.status) || text(session.state)).toLocaleLowerCase();
  const activeRunIds = Array.isArray(session.activeRunIds) ? session.activeRunIds.map(text).filter(Boolean) : null;
  const runId = text(session.runId) || text(session.activeRunId) || text(session.lastRunId) || activeRunIds?.[0] || '';
  const sessionId = text(session.sessionId);
  const explicitlyInactive = session.hasActiveRun === false || activeRunIds?.length === 0;
  const active = !explicitlyInactive && (session.hasActiveRun === true || Boolean(activeRunIds?.length) || /(?:run|stream|queue|processing)/.test(status));
  const terminalTimestamp = timestamp(session.completedAt ?? session.endedAt ?? session.endedAtMs);
  const terminal = !active && (explicitlyInactive || /^(?:done|complete|completed|finished|success|succeeded|ok|idle|failed|failure|error|timeout|cancelled|canceled)$/.test(status) || terminalTimestamp !== null);
  const activityAt = terminalTimestamp
    ?? timestamp(sessionActivityTimestamp(session))
    ?? 0;
  return { activityAt, phase: active ? 'active' : terminal ? 'terminal' : 'other', runId, sessionId };
}
