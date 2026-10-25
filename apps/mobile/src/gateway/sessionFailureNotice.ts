import type { WorkspaceMessage, WorkspaceProject } from '../workspace/workspaceTypes';
import { transcriptSessionIdentity } from '../workspace/transcriptMetadata';
import { isAssistantProjectionDiagnostic } from './gatewayDiagnosticProjection';

/** A terminal session snapshot is a receipt, not authority over the current run.
 * Use only its own run/generation/time. Never infer an owner from selection. */
export function sessionFailureNotice(value: unknown): WorkspaceMessage | null {
  const row = record(value);
  const sessionKey = text(row.sessionKey) || text(row.key);
  const status = text(row.status) || text(row.state);
  if (!sessionKey || sessionKey.length > 1024 || !/^(failed|failure|error|timeout)$/i.test(status)) return null;
  const runId = text(row.lastRunId);
  if (runId.length > 256) return null;
  const generation = transcriptSessionIdentity(row.sessionId);
  const endedAt = timestamp(row.endedAt);
  if (!runId && (!generation || !endedAt)) return null;
  const detail = text(row.lastRunError).slice(0, 2048);
  if (isAssistantProjectionDiagnostic(detail)) return null;
  const background = runId.startsWith('announce:');
  const label = background ? 'Background result delivery failed' : status === 'timeout' ? 'Run timed out' : 'Run failed';
  return {
    id: `session-failure:${JSON.stringify([sessionKey, generation ?? '', runId || endedAt])}`,
    role: 'error', state: 'error', source: 'live', sessionKey,
    text: `${label} · ${detail || 'OpenClaw did not provide an error detail.'}${background ? '\nA background result may not have reached this conversation. Completed work is not automatically undone.' : ''}`,
    ...(runId ? { runId } : {}),
    ...(generation ? { transcriptSessionId: generation } : {}),
    ...(endedAt ? { timestamp: endedAt } : {}),
  };
}

export function sessionFailureNotices(payload: Record<string, unknown>, projects: Array<Pick<WorkspaceProject, 'sessionKey' | 'sessionId'>>) {
  const allowed = new Map(projects.map(project => [project.sessionKey, project]));
  const rows = ['sessions', 'items', 'results'].flatMap(key => Array.isArray(payload[key]) ? payload[key] as unknown[] : []).slice(0, 1000);
  return rows.flatMap(row => {
    const notice = sessionFailureNotice(row);
    const owner = notice?.sessionKey ? allowed.get(notice.sessionKey) : undefined;
    return notice && owner && !(notice.transcriptSessionId && owner.sessionId && notice.transcriptSessionId !== owner.sessionId) ? [notice] : [];
  });
}

/** Lifecycle frames can omit the generation that a later census supplies.
 * The explicit run identity joins those receipts, never equal error text. */
export function convergeSessionFailureNotice(messages: WorkspaceMessage[], incoming: WorkspaceMessage) {
  if (!incoming.id.startsWith('session-failure:') || !incoming.runId) return incoming;
  const previous = messages.find(row => row.id.startsWith('session-failure:') && row.sessionKey === incoming.sessionKey && row.runId === incoming.runId
    && !(row.transcriptSessionId && incoming.transcriptSessionId && row.transcriptSessionId !== incoming.transcriptSessionId));
  if (!previous) return incoming;
  return { ...previous, ...incoming, id: previous.id,
    text: previous.text.includes('did not provide an error detail') || incoming.text.length > previous.text.length ? incoming.text : previous.text };
}

function record(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function text(value: unknown) { return typeof value === 'string' ? value.trim() : ''; }
function timestamp(value: unknown) { return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? String(value) : ''; }
