import type { WorkspaceMessage } from '../workspace/workspaceTypes';

/** A decoration of real retained identities, never a fabricated message. */
export function withHistoryOmission(rows: WorkspaceMessage[], promptMessageId?: string): WorkspaceMessage[] {
  const index = promptMessageId ? 1 : 0;
  const tail = rows[index];
  if (!tail) return rows;
  return rows.map((row, at) => at === index ? { ...row, historyOmission: {
    ...(promptMessageId ? { promptMessageId } : {}), firstTailMessageId: tail.id,
  } } : withoutOmission(row));
}
function withoutOmission(row: WorkspaceMessage): WorkspaceMessage {
  if (!row.historyOmission) return row;
  const { historyOmission: _omission, ...canonical } = row;
  return canonical;
}

/** Accepted consecutive older pages move the continuation toward its prompt. */
export function reconcileHistoryOmissions(older: WorkspaceMessage[], current: WorkspaceMessage[], merged: WorkspaceMessage[]): WorkspaceMessage[] {
  const omission = current.find(row => row.historyOmission)?.historyOmission;
  if (!omission || !older.length) return merged;
  const tail = current.find(row => row.id === omission.firstTailMessageId);
  const incoming = older.filter(row => row.sessionKey === tail?.sessionKey && row.transcriptSessionId === tail?.transcriptSessionId);
  const clean = merged.map(withoutOmission);
  if (incoming.some(row => row.id === omission.promptMessageId || !omission.promptMessageId && row.role === 'user')) return clean;
  const earliest = clean.find(row => row.id !== omission.promptMessageId && incoming.some(candidate => candidate.id === row.id));
  if (!earliest) return merged;
  return clean.map(row => row === earliest ? { ...row, historyOmission: { ...omission, firstTailMessageId: row.id } } : row);
}

/** Only the exact retained tail can own a restored presentation descriptor. */
export function validatedHistoryOmission(value: unknown, messageId: string): WorkspaceMessage['historyOmission'] {
  if (!value || typeof value !== 'object') return undefined;
  const row = value as Record<string, unknown>;
  const valid = (id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length <= 512;
  if (row.firstTailMessageId !== messageId || !valid(row.firstTailMessageId)
    || row.promptMessageId !== undefined && (!valid(row.promptMessageId) || row.promptMessageId === messageId)) return undefined;
  return { firstTailMessageId: messageId, ...(valid(row.promptMessageId) ? { promptMessageId: row.promptMessageId } : {}) };
}
