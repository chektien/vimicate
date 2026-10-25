import type { GatewayFrame } from './gatewayEvents';
import type { SessionRunPhase, SessionRunRegistry } from './sessionRunRegistry';
import { isAssistantProjectionDiagnostic } from './gatewayDiagnosticProjection';

export type RunLifecycleSignal = { sessionKey: string; runId: string; phase: SessionRunPhase; startedAtMs?: number; endedAtMs?: number; durationMs?: number };

/**
 * Bind only non-terminal session activity to an already-authoritative active
 * run. A delayed terminal frame without run identity must never finish or fail
 * whichever newer run happens to own the session when the frame arrives.
 */
export function bindRunLifecycleSignal(signal: RunLifecycleSignal | null, activeRunId: string) {
  if (!signal) return null;
  if (signal.runId) return signal;
  if (signal.phase === 'completed' || signal.phase === 'failed' || !activeRunId) return null;
  return { ...signal, runId: activeRunId };
}

/** A terminal chat frame settles only a run already owned by this session. */
export function ownedRunLifecycleSignal(signal: RunLifecycleSignal | null, registry: SessionRunRegistry) {
  if (!signal) return null;
  return (signal.phase === 'completed' || signal.phase === 'failed')
    && !registry.ownsRun(signal.sessionKey, signal.runId) ? null : signal;
}

export function noteTrackedLiveFrame(registry: SessionRunRegistry, signal: RunLifecycleSignal | null) {
  if (signal?.phase === 'running' && signal.runId) registry.noteLiveFrame(signal.sessionKey, signal.runId);
  return signal;
}

export function runLifecycleSignalForGatewayFrame(frame: GatewayFrame): RunLifecycleSignal | null {
  const event = text(frame.event).toLocaleLowerCase(); const payload = record(frame.payload); const data = record(payload.data); const request = record(payload.request);
  const sessionKey = text(payload.sessionKey) || text(request.sessionKey); if (!sessionKey) return null;
  const runId = text(payload.runId) || text(data.runId);
  const timing = lifecycleTiming(payload, data);
  if (event === 'chat') {
    const state = text(payload.state).toLocaleLowerCase();
    if (state === 'error' || state === 'failed') return { sessionKey, runId, phase: isAssistantProjectionDiagnostic(printable(payload)) ? 'uncertain' : 'failed', ...timing };
    if (state === 'final' || state === 'complete' || state === 'completed') return { sessionKey, runId, phase: 'completed', ...timing };
    if (state === 'delta' || state === 'streaming') return { sessionKey, runId, phase: 'running', ...timing };
  }
  if (event === 'agent') {
    const stream = text(payload.stream).toLocaleLowerCase(); const phase = text(data.phase).toLocaleLowerCase();
    if (stream === 'error' || phase === 'error' || phase === 'failed') return { sessionKey, runId, phase: isAssistantProjectionDiagnostic(printable(data)) ? 'uncertain' : 'failed', ...timing };
    if (stream === 'lifecycle' && ['end', 'done', 'complete', 'completed'].includes(phase)) return { sessionKey, runId, phase: 'completed', ...timing };
    if (phase === 'waiting' || phase === 'approval') return { sessionKey, runId, phase: 'waiting', ...timing };
    if (['tool', 'item', 'lifecycle', 'fallback'].includes(stream)) return { sessionKey, runId, phase: 'running', ...timing };
  }
  if (event.endsWith('.approval.requested')) return { sessionKey, runId, phase: 'waiting' };
  if (event.endsWith('.approval.resolved')) return { sessionKey, runId, phase: 'running' };
  if (event.endsWith('.run.started')) return { sessionKey, runId, phase: 'running' };
  if (event.endsWith('.run.completed')) return { sessionKey, runId, phase: 'completed' };
  if (event.endsWith('.run.failed')) return { sessionKey, runId, phase: 'failed' };
  return null;
}

function record(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function text(value: unknown) { return typeof value === 'string' ? value : ''; }
function lifecycleTiming(payload: Record<string, unknown>, data: Record<string, unknown>) {
  const startedAtMs = epochMs(data.startedAt ?? data.startedAtMs ?? payload.startedAt ?? payload.startedAtMs);
  const endedAtMs = epochMs(data.endedAt ?? data.endedAtMs ?? payload.endedAt ?? payload.endedAtMs);
  const durationMs = duration(data.durationMs ?? payload.durationMs);
  return { ...(startedAtMs !== undefined ? { startedAtMs } : {}), ...(endedAtMs !== undefined ? { endedAtMs } : {}), ...(durationMs !== undefined ? { durationMs } : {}) };
}
function epochMs(value: unknown) { if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined; return value < 100_000_000_000 ? value * 1000 : value; }
function duration(value: unknown) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined; }
function printable(value: unknown) { try { return JSON.stringify(value); } catch { return String(value); } }
