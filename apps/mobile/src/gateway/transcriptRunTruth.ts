import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import type { SessionRunRegistry } from './sessionRunRegistry';

/**
 * Canonical history can prove that a newer turn completed after an older
 * failed parent run. Use that fact only to clear a stale failed/uncertain
 * project marker; it must never settle an unrelated active replacement run.
 */
export function reconcileNewerTranscriptCompletion(registry: SessionRunRegistry, sessionKey: string, messages: WorkspaceMessage[]) {
  const phase = registry.phaseFor(sessionKey);
  if (phase !== 'failed' && phase !== 'uncertain') return false;

  const completion = latestTimestampedCompletion(messages, sessionKey);
  if (!completion) return false;
  const activeRun = registry.runFor(sessionKey);
  if (activeRun && completion.runId !== activeRun) return false;

  const timing = registry.timingFor(sessionKey);
  const sameTrackedRun = Boolean(completion.runId && timing?.runId === completion.runId);
  const previousTerminalAt = timing?.endedAtMs ?? timing?.startedAtMs ?? 0;
  if (!sameTrackedRun && completion.completedAtMs <= previousTerminalAt) return false;

  const runId = completion.runId || `history-completion:${completion.messageId}`;
  return registry.observePhase(sessionKey, 'completed', runId, {
    startedAtMs: completion.completedAtMs,
    endedAtMs: completion.completedAtMs,
  });
}

function latestTimestampedCompletion(messages: WorkspaceMessage[], sessionKey: string) {
  let latest: { messageId: string; runId: string; completedAtMs: number } | null = null;
  for (const message of messages) {
    if (message.sessionKey && message.sessionKey !== sessionKey) continue;
    if (message.role !== 'run' || message.state !== 'complete' || !/^✓ done in\b/.test(message.text.trim())) continue;
    const completedAtMs = timestampMilliseconds(message.timestamp);
    if (completedAtMs === null || (latest && latest.completedAtMs > completedAtMs)) continue;
    latest = { messageId: message.id, runId: message.runId ?? '', completedAtMs };
  }
  return latest;
}

function timestampMilliseconds(value: string | undefined) {
  if (!value) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric >= 0) return numeric < 100_000_000_000 ? numeric * 1000 : numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
