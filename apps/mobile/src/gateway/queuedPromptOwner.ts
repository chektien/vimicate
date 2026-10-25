import type { WorkspaceMessage } from '../workspace/workspaceTypes';

export type QueuedPromptState = 'preparing' | 'accepted' | 'queued' | 'consumed' | 'interrupted' | 'cancelled' | 'unknown';
export type QueuedPromptPreparation = {
  runId: string; originalSubmissionId: string; sessionKey: string; sessionId: string;
  predecessorRunId: string; createdAt: number; text: string; agentId?: string;
};
export type QueuedPromptRecord = QueuedPromptPreparation & { id: string; state: QueuedPromptState; detail?: string; actionFailure?: string; consumedByEventId?: string };
const LIMIT = 64; const SESSION_LIMIT = 16; const BYTE_LIMIT = 512_000; const TERMINAL_AGE = 7 * 24 * 60 * 60 * 1000;
const terminal = (state: QueuedPromptState) => state === 'consumed' || state === 'cancelled' || state === 'interrupted';

/** Durable input custody metadata, not an outbox. No method sends or replays a prompt. */
export class QueuedPromptOwner {
  private records = new Map<string, QueuedPromptRecord>();
  revision = 0;
  prepare(request: QueuedPromptPreparation, now = Date.now()) {
    const parsed = restoredRecord({ ...request, id: request.runId, state: 'preparing', text: request.text.slice(0, 4096) });
    if (!parsed || parsed.runId === parsed.originalSubmissionId || parsed.runId === parsed.predecessorRunId) throw new Error('A queued message needs a distinct identity and a concrete conversation.');
    if (this.records.has(parsed.runId) || [...this.records.values()].some(record => record.originalSubmissionId === parsed.originalSubmissionId)) throw new Error('This message already has a queued follow-up. Check its delivery status.');
    this.prune(now);
    if (this.records.size >= LIMIT) {
      const disposable = [...this.records.values()].filter(record => terminal(record.state)).sort((a, b) => a.createdAt - b.createdAt)[0];
      if (disposable) this.records.delete(disposable.runId);
    }
    if (this.records.size >= LIMIT || this.pending(parsed.sessionKey, parsed.sessionId).length >= SESSION_LIMIT) throw new Error('Too many messages have unconfirmed queue status. Check existing messages first.');
    this.records.set(parsed.runId, parsed);
    if (reservedSize([...this.records.values()]) > BYTE_LIMIT) { this.records.delete(parsed.runId); throw new Error('Queued-message status storage is full. Check existing messages first.'); }
    this.revision++; return parsed;
  }
  rollbackPreparation(runId: string) {
    if (['preparing', 'unknown'].includes(this.records.get(runId)?.state ?? '')) { this.records.delete(runId); this.revision++; }
  }
  get(runId: string) { const record = this.records.get(runId); return record ? { ...record } : undefined; }
  recordActionFailure(runId: string, detail: string) {
    const record = this.records.get(runId); if (!record || terminal(record.state)) return;
    record.actionFailure = detail.slice(0, 512); this.revision++;
  }
  update(runId: string, state: QueuedPromptState, detail?: string, consumedByEventId?: string) {
    const record = this.records.get(runId); if (!record || terminal(record.state)) return;
    // A delayed send ack cannot erase a newer exact queued receipt.
    if (record.state === 'queued' && ['preparing', 'accepted'].includes(state)) {
      if (detail && detail !== record.detail) { record.detail = detail.slice(0, 512); this.revision++; } return;
    }
    const next = { ...record, state, ...(detail ? { detail: detail.slice(0, 512) } : {}), ...(consumedByEventId ? { consumedByEventId: consumedByEventId.slice(0, 512) } : {}) };
    if (!detail) delete next.detail;
    if (terminal(state)) delete next.actionFailure;
    if (JSON.stringify(record) !== JSON.stringify(next)) { this.records.set(runId, next); this.revision++; }
  }
  view(message: WorkspaceMessage) {
    if (message.role !== 'user' || !message.sessionKey) return;
    const record = [...this.records.values()].find(value => value.sessionKey === message.sessionKey
      && (!message.transcriptSessionId || value.sessionId === message.transcriptSessionId)
      && (message.idempotencyKey === value.runId || message.inputReceiptRunId === value.runId
        || message.source === 'history' && message.transcriptSessionId === value.sessionId && message.idempotencyKey === `${value.runId}:user`));
    return record ? { ...record } : undefined;
  }
  pending(sessionKey: string, sessionId: string) {
    return [...this.records.values()].filter(record => record.sessionKey === sessionKey && record.sessionId === sessionId && !terminal(record.state)).map(record => ({ ...record }));
  }
  // Action progress/outcomes are connection-local, unlike custody identity.
  serialize() { return JSON.stringify([...this.records.values()].map(({ actionFailure: _failure, ...record }) => record)); }
  restore(payload: string | null, now = Date.now()) {
    if (!payload || payload.length > BYTE_LIMIT) return;
    try {
      const raw: unknown = JSON.parse(payload); if (!Array.isArray(raw) || raw.length > LIMIT) return;
      const records = raw.map(restoredRecord); if (records.some(record => !record) || reservedSize(records as QueuedPromptRecord[]) > BYTE_LIMIT) return;
      const ids = new Set<string>(); const originals = new Set<string>();
      for (const record of records as QueuedPromptRecord[]) {
        if (ids.has(record.runId) || originals.has(record.originalSubmissionId)) return;
        ids.add(record.runId); originals.add(record.originalSubmissionId);
      }
      for (const record of records as QueuedPromptRecord[]) {
        if (this.records.has(record.runId)) continue;
        if (!terminal(record.state)) { record.state = 'unknown'; delete record.detail; }
        this.records.set(record.runId, record); this.revision++;
      }
      this.prune(now);
    } catch { /* Invalid metadata never authorizes a mutation or resend. */ }
  }
  private prune(now: number) {
    for (const [id, record] of this.records) if (terminal(record.state) && now - record.createdAt > TERMINAL_AGE) { this.records.delete(id); this.revision++; }
  }
}
function restoredRecord(value: unknown): QueuedPromptRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as QueuedPromptRecord;
  if (!['id', 'runId', 'originalSubmissionId', 'sessionKey', 'sessionId', 'predecessorRunId'].every(key => bounded((record as unknown as Record<string, unknown>)[key], key === 'sessionKey' ? 2048 : 256))
    || record.id !== record.runId || record.runId === record.originalSubmissionId || record.runId === record.predecessorRunId
    || !Number.isSafeInteger(record.createdAt) || record.createdAt < 0 || typeof record.text !== 'string' || record.text.length > 4096
    || !['preparing', 'accepted', 'queued', 'consumed', 'interrupted', 'cancelled', 'unknown'].includes(record.state)
    || record.agentId !== undefined && !bounded(record.agentId, 128) || record.detail !== undefined && !bounded(record.detail, 512)
    || record.consumedByEventId !== undefined && !bounded(record.consumedByEventId, 512)) return null;
  return { id: record.runId, runId: record.runId, originalSubmissionId: record.originalSubmissionId, sessionKey: record.sessionKey,
    sessionId: record.sessionId, predecessorRunId: record.predecessorRunId, createdAt: record.createdAt, text: record.text, state: record.state,
    ...(record.agentId ? { agentId: record.agentId } : {}), ...(record.detail ? { detail: record.detail } : {}), ...(record.consumedByEventId ? { consumedByEventId: record.consumedByEventId } : {}) };
}
function bounded(value: unknown, max: number): value is string { return typeof value === 'string' && value.trim().length > 0 && value.length <= max; }

// Reserve worst-case escaped metadata growth before the network can own an input.
function reservedSize(records: QueuedPromptRecord[]) {
  return JSON.stringify(records.map(({ detail: _detail, consumedByEventId: _event, ...record }) => record)).length + records.length * 6500;
}
