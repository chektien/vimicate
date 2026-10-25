import type { AgentWaitResult } from './OpenClawClient';
import type { SessionRunPhase } from './sessionRunRegistry';

export function isRunWaitTimeout(result: AgentWaitResult) {
  return result.status === 'timeout';
}

export function isRunWaitRequestTimeout(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /(?:^|\s)agent\.wait timed out(?:\s|$)/i.test(message);
}

export function runTerminalDetail(result: AgentWaitResult) {
  const status = result.status?.trim() || 'complete';
  if (result.error?.trim()) return `${status}: ${result.error.trim()}`;
  if (result.stopReason?.trim()) return `${status}: ${result.stopReason.trim()}`;
  return status;
}

export function runPhaseForWaitResult(result: AgentWaitResult): SessionRunPhase {
  const status = result.status?.trim().toLocaleLowerCase() ?? '';
  if (result.error?.trim() || ['error', 'failed', 'failure', 'killed', 'aborted', 'cancelled', 'canceled'].includes(status)) return 'failed';
  if (status === 'timeout') return 'waiting';
  if (['done', 'complete', 'completed', 'success', 'succeeded', 'ok'].includes(status)) return 'completed';
  return 'uncertain';
}

export function runTimingForWaitResult(result: AgentWaitResult) {
  const startedAtMs = epochMs(result.startedAt); const endedAtMs = epochMs(result.endedAt);
  return { ...(startedAtMs !== undefined ? { startedAtMs } : {}), ...(endedAtMs !== undefined ? { endedAtMs } : {}) };
}

export function isRecoverableRunInterruption(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /disconnect|socket closed|transport|not connected|network/i.test(message);
}

function epochMs(value: number | undefined) { if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined; return value < 100_000_000_000 ? value * 1000 : value; }
