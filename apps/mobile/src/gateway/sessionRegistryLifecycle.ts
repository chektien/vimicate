import { gatewayRunTruthReadUnavailable, gatewayRunTargetRefusal } from './gatewayRequestDelivery';
import type { SessionRunPhase, SessionRunRegistry } from './sessionRunRegistry';

export type SessionRegistryLifecycleSignal = {
  sessionKey: string;
  runId: string;
  phase: Extract<SessionRunPhase, 'running' | 'completed' | 'failed'>;
  authoritativeNoActiveRun?: boolean;
};

export type SessionRegistryCensusReader = {
  listSessions: () => Promise<Record<string, unknown>>;
  readSessionRunTruth?: (sessionKey: string) => Promise<Record<string, unknown>>;
};

export function sessionRegistryLifecycleSignals(payload: Record<string, unknown>): SessionRegistryLifecycleSignal[] {
  const rows = ['sessions', 'items', 'results'].flatMap((key) => Array.isArray(payload[key]) ? payload[key] as unknown[] : []).slice(0, 1_000);
  const signals: SessionRegistryLifecycleSignal[] = [];
  for (const value of rows) {
    const session = record(value); const sessionKey = text(session.sessionKey) || text(session.key) || text(session.id); if (!sessionKey) continue;
    const status = (text(session.status) || text(session.state)).toLocaleLowerCase();
    const runId = text(session.runId) || text(session.activeRunId) || firstText(session.activeRunIds);
    const activeRunIds = Array.isArray(session.activeRunIds) ? session.activeRunIds.map(text).filter(Boolean) : null;
    const authoritativeNoActiveRun = session.hasActiveRun === false || activeRunIds?.length === 0;
    // Explicit active-run presence or absence wins over a lagging aggregate
    // status label in either direction.
    if (session.hasActiveRun === true || Boolean(activeRunIds?.length)) signals.push({ sessionKey, runId, phase: 'running' });
    else if (authoritativeNoActiveRun) signals.push({ sessionKey, runId: '', phase: /(?:error|fail|timeout|timed out|killed|abort|cancel)/.test(status) ? 'failed' : 'completed', authoritativeNoActiveRun: true });
    else if (/(?:run|stream|queue|processing)/.test(status)) signals.push({ sessionKey, runId, phase: 'running' });
    else if (/^(?:done|complete|completed|success|succeeded|ok|idle)$/.test(status)) signals.push({ sessionKey, runId, phase: 'completed', ...(authoritativeNoActiveRun ? { authoritativeNoActiveRun: true } : {}) });
    else if (/(?:error|fail|timeout|timed out|killed|abort|cancel)/.test(status)) signals.push({ sessionKey, runId, phase: 'failed', ...(authoritativeNoActiveRun ? { authoritativeNoActiveRun: true } : {}) });
  }
  return signals;
}

/**
 * A complete sessions census is authoritative about the active run identity.
 * Steering RPCs may return short-lived operation ids; when the census names a
 * different active run, replace that local operation ownership instead of
 * rejecting the stronger observation as an out-of-scope event.
 */
export type SessionCensusRequest = { runId: string; liveFrameRevision: number };

export function captureSessionCensusRequests(registry: SessionRunRegistry) {
  return new Map(registry.trackedSessionKeys().map(sessionKey =>
    [sessionKey, { runId: registry.runFor(sessionKey), liveFrameRevision: registry.liveFrameRevisionFor(sessionKey) }] as const));
}

export function applySessionRegistryCensus(registry: SessionRunRegistry, payload: Record<string, unknown>, requests: Map<string, SessionCensusRequest>, onActiveRun: (sessionKey: string, runId: string) => void) {
  let changed = false;
  for (const signal of sessionRegistryLifecycleSignals(payload)) {
    changed = applySessionRegistryLifecycleSignal(registry, signal, requests.get(signal.sessionKey) ?? { runId: '', liveFrameRevision: 0 }) || changed;
    // Active-run truth retires stale presentation, not another run's unread final.
    if (signal.phase === 'running' && signal.runId) onActiveRun(signal.sessionKey, signal.runId);
  }
  return changed;
}

export function applySessionRegistryLifecycleSignal(registry: SessionRunRegistry, signal: SessionRegistryLifecycleSignal, request?: SessionCensusRequest) {
  const trackedRun = registry.runFor(signal.sessionKey);
  const trackedPhase = registry.phaseFor(signal.sessionKey);
  if (request && (request.runId !== trackedRun
    || registry.liveFrameRevisionFor(signal.sessionKey) > request.liveFrameRevision)) return false;
  if (signal.phase === 'running') {
    if (signal.runId && trackedRun !== signal.runId) {
      registry.registerRun(signal.sessionKey, signal.runId);
      registry.observePhase(signal.sessionKey, 'running', signal.runId);
      return true;
    }
    return trackedRun || trackedPhase === 'uncertain' || trackedPhase === 'waiting' || trackedPhase === 'running'
      ? registry.observePhase(signal.sessionKey, 'running', signal.runId)
      : false;
  }
  // A terminal label alone cannot distinguish an older completed run from a
  // newer tracked replacement. A complete census that explicitly reports no
  // active run can: bind that negative fact to the one locally tracked owner
  // so a completed thread cannot retain a stale Stop button indefinitely.
  if (!signal.runId) {
    if (!signal.authoritativeNoActiveRun || !trackedRun) return false;
    return registry.observePhase(signal.sessionKey, signal.phase, trackedRun);
  }
  return trackedRun || trackedPhase === 'uncertain' || trackedPhase === 'waiting' || trackedPhase === 'running'
    ? registry.observePhase(signal.sessionKey, signal.phase, signal.runId)
    : false;
}

/**
 * Reconcile one selected session from a fresh, complete census without
 * republishing the project list or transcript. Project reselection uses this
 * narrow path so a restored local run owner cannot leave Stop visible after
 * OpenClaw has already reported that the thread is terminal.
 */
export async function refreshSelectedSessionRunTruth(
  reader: SessionRegistryCensusReader,
  registry: SessionRunRegistry,
  sessionKey: string,
  isCurrent: () => boolean = () => true,
) {
  if (!sessionKey) return false;
  const request = { runId: registry.runFor(sessionKey), liveFrameRevision: registry.liveFrameRevisionFor(sessionKey) };
  let payload: Record<string, unknown>;
  try {
    payload = reader.readSessionRunTruth
      ? { sessions: [(await reader.readSessionRunTruth(sessionKey)).session] }
      : await reader.listSessions();
  } catch (error) {
    if (!reader.readSessionRunTruth || !gatewayRunTruthReadUnavailable(error) || !isCurrent()) throw error;
    payload = await reader.listSessions(); // Older hosts retain census recovery, never guessed IDs.
  }
  if (!isCurrent()) return false;
  const signal = sessionRegistryLifecycleSignals(payload).find((candidate) => candidate.sessionKey === sessionKey);
  return signal ? applySessionRegistryLifecycleSignal(registry, signal, request) : false;
}

function record(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function text(value: unknown) { return typeof value === 'string' ? value.trim() : ''; }
function firstText(value: unknown) { return Array.isArray(value) ? value.map(text).find(Boolean) ?? '' : ''; }


/** A refusal permits identity repair, never replay or rebinding to IDs in the
 * error payload. A later explicit Send uses the newly published runtime fact. */
export async function recoverRefusedSessionRunTruth(
  error: unknown, reader: SessionRegistryCensusReader, registry: SessionRunRegistry,
  sessionKey: string, expectedRunId: string, isCurrent: () => boolean, onChanged: () => void,
) {
  if (!expectedRunId || gatewayRunTargetRefusal(error)?.expectedActiveRunId !== expectedRunId) return '';
  try { if (registry.runFor(sessionKey) === expectedRunId && await refreshSelectedSessionRunTruth(reader, registry, sessionKey, isCurrent)) onChanged(); }
  catch { /* Preserve the original refusal and draft if recovery is unavailable. */ }
  return isCurrent() && error instanceof Error ? error.message : '';
}
