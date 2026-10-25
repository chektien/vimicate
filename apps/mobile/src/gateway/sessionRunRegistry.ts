import { BoundedSessionCache } from '../workspace/boundedSessionCache';

export type SessionRunPhase = 'submitting' | 'accepted' | 'running' | 'waiting' | 'completed' | 'failed' | 'uncertain';
export type RunTimingObservation = { startedAtMs?: number; endedAtMs?: number; durationMs?: number; observedAtMs?: number };
export type SessionRunTiming = { runId: string; startedAtMs: number; endedAtMs?: number; durationMs?: number };
const MAX_PENDING_STOPS_PER_RUN = 4;
const MAX_CONFIRMED_STOPS_PER_SESSION = 32;

export class SessionRunRegistry {
  private active = new Map<string, string>();
  private submitting = new Set<string>();
  private phases = new Map<string, SessionRunPhase>();
  private phaseRuns = new Map<string, string>();
  private timings = new Map<string, SessionRunTiming>();
  private readonly terminalSessions: BoundedSessionCache<true>;
  private readonly liveFrameRevisions = new BoundedSessionCache<number>();
  private readonly confirmedStops = new BoundedSessionCache<string[]>();
  private readonly pendingStops = new BoundedSessionCache<{ runId: string; requests: Set<symbol> }>();

  constructor(terminalSessionLimit = 64) {
    this.terminalSessions = new BoundedSessionCache(terminalSessionLimit);
  }

  beginSubmission(sessionKey: string, startedAtMs = Date.now()) {
    this.terminalSessions.delete(sessionKey);
    this.submitting.add(sessionKey); this.phases.set(sessionKey, 'submitting'); this.phaseRuns.delete(sessionKey);
    this.timings.set(sessionKey, { runId: '', startedAtMs: validTime(startedAtMs) ?? Date.now() });
  }
  finishSubmission(sessionKey: string) {
    this.submitting.delete(sessionKey);
    if (!this.active.has(sessionKey) && this.phases.get(sessionKey) === 'submitting') {
      this.phases.delete(sessionKey); this.phaseRuns.delete(sessionKey); this.timings.delete(sessionKey); this.terminalSessions.delete(sessionKey);
    }
  }
  rejectSubmission(sessionKey: string) {
    // A prompt rejected before OpenClaw accepts a run is a send error, not a
    // thread that crashed halfway. Keep the error in the detail line without
    // leaving a terminal failure marker on the project.
    this.submitting.delete(sessionKey); this.phases.delete(sessionKey); this.phaseRuns.delete(sessionKey); this.timings.delete(sessionKey); this.terminalSessions.delete(sessionKey);
  }
  registerRun(sessionKey: string, runId: string, timing: RunTimingObservation = {}) {
    if (!sessionKey || !runId) return;
    const phase = this.phases.get(sessionKey); const observedRun = this.phaseRuns.get(sessionKey);
    if ((phase === 'completed' || phase === 'failed') && observedRun === runId) return;
    this.terminalSessions.delete(sessionKey);
    this.beginOrUpdateTiming(sessionKey, runId, timing);
    this.active.set(sessionKey, runId); this.phases.set(sessionKey, 'accepted'); this.phaseRuns.set(sessionKey, runId);
  }
  runFor(sessionKey: string) { return this.active.get(sessionKey) ?? ''; }
  /** Only a confirmed exact-run Stop may reinterpret a terminal failure. */
  beginStopRequest(sessionKey: string, runId: string) {
    const ownedAtRequest = this.ownsRun(sessionKey, runId);
    const existing = this.pendingStops.restore(sessionKey);
    const pending = existing?.runId === runId ? existing : { runId, requests: new Set<symbol>() };
    if (pending.requests.size >= MAX_PENDING_STOPS_PER_RUN) throw new Error('Stop requests are already pending for this run.');
    const request = Symbol('stop');
    pending.requests.add(request); this.pendingStops.store(sessionKey, pending);
    return (confirmed: boolean) => {
      if (this.pendingStops.restore(sessionKey) !== pending || !pending.requests.delete(request)) return;
      if (!pending.requests.size) this.pendingStops.delete(sessionKey);
      if (!confirmed || !runId || !ownedAtRequest) return;
      const previous = this.confirmedStops.restore(sessionKey) ?? [];
      this.confirmedStops.store(sessionKey, [...previous.filter(id => id !== runId), runId].slice(-MAX_CONFIRMED_STOPS_PER_SESSION));
      // A terminal event can arrive before the RPC receipt. Upgrade that exact
      // failed run only after confirmation; never resurrect or finish a successor.
      if (this.phaseRuns.get(sessionKey) === runId && this.phases.get(sessionKey) === 'failed') this.observePhase(sessionKey, 'completed', runId, this.timings.get(sessionKey));
    };
  }
  stopWasConfirmed(sessionKey: string, runId: string) { return Boolean(runId && this.confirmedStops.restore(sessionKey)?.includes(runId)); }
  private stoppedOrFailed(sessionKey: string, runId: string): 'completed' | 'failed' { return this.stopWasConfirmed(sessionKey, runId) ? 'completed' : 'failed'; }
  liveFrameRevisionFor(sessionKey: string) { return this.liveFrameRevisions.restore(sessionKey) ?? 0; }
  noteLiveFrame(sessionKey: string, runId: string) {
    if (runId && this.active.get(sessionKey) === runId) {
      this.liveFrameRevisions.store(sessionKey, this.liveFrameRevisionFor(sessionKey) + 1);
    }
  }
  ownsRun(sessionKey: string, runId: string) {
    return Boolean(runId && (this.active.get(sessionKey) === runId || this.phaseRuns.get(sessionKey) === runId));
  }
  /** Local recovery uncertainty cannot introduce or resurrect a run. */
  markRunUncertain(sessionKey: string, expectedRunId: string) {
    return this.ownsRun(sessionKey, expectedRunId) && this.observePhase(sessionKey, 'uncertain', expectedRunId);
  }
  phaseFor(sessionKey: string) { return this.phases.get(sessionKey); }
  isBusy(sessionKey: string) { return this.submitting.has(sessionKey) || this.active.has(sessionKey); }
  timingFor(sessionKey: string, runId = '') {
    const timing = this.timings.get(sessionKey);
    return timing && (!runId || !timing.runId || timing.runId === runId) ? timing : undefined;
  }
  elapsedMsFor(sessionKey: string, runId = '', observedAtMs = Date.now()) {
    const timing = this.timingFor(sessionKey, runId); if (!timing) return 0;
    if (timing.durationMs !== undefined) return timing.durationMs;
    return Math.max(0, (timing.endedAtMs ?? observedAtMs) - timing.startedAtMs);
  }
  observePhase(sessionKey: string, observed: SessionRunPhase, runId = '', timing: RunTimingObservation = {}) {
    if (!sessionKey) return false;
    const phase = observed === 'failed' ? this.stoppedOrFailed(sessionKey, runId) : observed;
    const currentRun = this.active.get(sessionKey);
    const terminal = phase === 'completed' || phase === 'failed';
    // Terminal state is a run fact, not merely a session fact. Refuse to clear
    // an active/recent run when the observation cannot name its exact owner.
    if (terminal && !runId) return false;
    if (currentRun && runId && currentRun !== runId) return false;
    const currentPhase = this.phases.get(sessionKey); const observedRun = this.phaseRuns.get(sessionKey);
    const sameObservedRun = Boolean(observedRun && (!runId || observedRun === runId));
    // A visible final answer is stronger terminal evidence than a late stream
    // error or delayed progress frame. Terminal state for one run is monotonic;
    // only a later completed signal may upgrade an earlier failure.
    if ((currentPhase === 'completed' || currentPhase === 'failed') && sameObservedRun) {
      if (currentPhase === 'completed') return false;
      // Some Gateway progress frames are session-scoped and omit runId. A
      // later live running/waiting frame is stronger evidence than an older
      // local recovery failure; allow it to clear the false terminal state.
      if (phase !== 'completed' && (runId || (phase !== 'running' && phase !== 'waiting'))) return false;
    }
    const sameRun = !runId || currentRun === runId || observedRun === runId;
    if (currentPhase === phase && sameRun && !timingObservationChanges(this.timings.get(sessionKey), timing)) return false;
    this.beginOrUpdateTiming(sessionKey, runId || currentRun || observedRun || '', timing);
    if (!terminal && runId) this.active.set(sessionKey, runId);
    if (terminal && (!runId || !currentRun || currentRun === runId)) this.active.delete(sessionKey);
    if (terminal) this.finishTiming(sessionKey, runId, timing);
    if (runId) this.phaseRuns.set(sessionKey, runId);
    this.phases.set(sessionKey, phase);
    if (terminal) this.rememberTerminal(sessionKey); else this.terminalSessions.delete(sessionKey);
    return true;
  }
  finishRun(sessionKey: string, expectedRunId: string, phase: Extract<SessionRunPhase, 'completed' | 'failed'> = 'completed', timing: RunTimingObservation = {}) {
    if (this.active.get(sessionKey) !== expectedRunId) return false;
    this.active.delete(sessionKey); this.phases.set(sessionKey, phase === 'failed' ? this.stoppedOrFailed(sessionKey, expectedRunId) : phase); this.phaseRuns.set(sessionKey, expectedRunId); this.finishTiming(sessionKey, expectedRunId, timing); this.rememberTerminal(sessionKey); return true;
  }
  markIncompleteRun(sessionKey: string, expectedRunId: string, timing: RunTimingObservation = {}) {
    const currentRun = this.active.get(sessionKey); const observedRun = this.phaseRuns.get(sessionKey);
    if (currentRun !== expectedRunId && observedRun !== expectedRunId) return false;
    this.active.delete(sessionKey); this.submitting.delete(sessionKey); this.phases.set(sessionKey, this.stoppedOrFailed(sessionKey, expectedRunId)); this.phaseRuns.set(sessionKey, expectedRunId);
    this.finishTiming(sessionKey, expectedRunId, timing); this.rememberTerminal(sessionKey); return true;
  }
  entries() { return [...this.active.entries()]; }
  trackedSessionKeys() { return [...new Set([...this.active.keys(), ...this.phases.keys()])]; }
  snapshot() { return Object.fromEntries(this.active); }
  restore(raw: string | null) {
    this.active.clear(); this.submitting.clear(); this.phases.clear(); this.phaseRuns.clear(); this.timings.clear(); this.terminalSessions.clear(); this.liveFrameRevisions.clear(); this.confirmedStops.clear(); this.pendingStops.clear(); if (!raw) return;
    try {
      const parsed: unknown = JSON.parse(raw); if (!isRecord(parsed)) return;
      for (const [sessionKey, runId] of Object.entries(parsed)) if (sessionKey && typeof runId === 'string' && runId.length > 0 && runId.length <= 256) { this.active.set(sessionKey, runId); this.phases.set(sessionKey, 'uncertain'); this.phaseRuns.set(sessionKey, runId); this.timings.set(sessionKey, { runId, startedAtMs: Date.now() }); }
    } catch { /* Invalid local recovery state is ignored. */ }
  }
  clear() { this.active.clear(); this.submitting.clear(); this.phases.clear(); this.phaseRuns.clear(); this.timings.clear(); this.terminalSessions.clear(); this.liveFrameRevisions.clear(); this.confirmedStops.clear(); this.pendingStops.clear(); }

  private rememberTerminal(sessionKey: string) {
    const evictedSessionKey = this.terminalSessions.store(sessionKey, true);
    if (!evictedSessionKey) return;
    this.submitting.delete(evictedSessionKey);
    this.phases.delete(evictedSessionKey);
    this.phaseRuns.delete(evictedSessionKey);
    this.timings.delete(evictedSessionKey);
    this.confirmedStops.delete(evictedSessionKey); this.pendingStops.delete(evictedSessionKey);
  }

  private beginOrUpdateTiming(sessionKey: string, runId: string, observation: RunTimingObservation) {
    const existing = this.timings.get(sessionKey); const startedAtMs = validTime(observation.startedAtMs);
    const observedAtMs = validTime(observation.observedAtMs);
    const endedAtMs = validTime(observation.endedAtMs);
    const durationMs = validDuration(observation.durationMs);
    if (!existing || (runId && existing.runId && existing.runId !== runId)) {
      this.timings.set(sessionKey, { runId, startedAtMs: startedAtMs ?? observedAtMs ?? Date.now(), ...(durationMs !== undefined ? { durationMs } : {}) });
      return;
    }
    this.timings.set(sessionKey, { ...existing, runId: runId || existing.runId, ...(startedAtMs !== undefined ? { startedAtMs } : {}), ...(endedAtMs !== undefined ? { endedAtMs } : {}), ...(durationMs !== undefined ? { durationMs } : {}) });
  }
  private finishTiming(sessionKey: string, runId: string, observation: RunTimingObservation) {
    this.beginOrUpdateTiming(sessionKey, runId || this.phaseRuns.get(sessionKey) || '', observation);
    const current = this.timings.get(sessionKey); if (!current) return;
    const endedAtMs = validTime(observation.endedAtMs) ?? validTime(observation.observedAtMs) ?? Date.now();
    const durationMs = validDuration(observation.durationMs);
    this.timings.set(sessionKey, { ...current, endedAtMs, ...(durationMs !== undefined ? { durationMs } : {}) });
  }
}

export function allowsSessionSubmission(registry: SessionRunRegistry, sessionKey: string, runSafeCommand: boolean) {
  return !registry.isBusy(sessionKey) || runSafeCommand;
}

export type SessionSubmissionDisposition = 'new-run' | 'active-run-input' | 'run-safe' | 'blocked';

/**
 * Ordinary input during a run explicitly requests steering, not interruption.
 * OpenClaw owns authority checks. The client requires injection or refusal,
 * keeps the existing run, and offers interruption only as an explicit command.
 */
export function sessionSubmissionDisposition(registry: SessionRunRegistry, sessionKey: string, runSafeCommand: boolean, ordinaryPrompt: boolean): SessionSubmissionDisposition {
  if (!registry.isBusy(sessionKey)) return 'new-run';
  if (runSafeCommand) return 'run-safe';
  return ordinaryPrompt ? 'active-run-input' : 'blocked';
}

export function selectedRunPresentation(registry: SessionRunRegistry, selectedSessionKey: string) {
  return { runId: registry.runFor(selectedSessionKey), sending: registry.isBusy(selectedSessionKey) };
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function validTime(value: number | undefined) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined; }
function validDuration(value: number | undefined) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined; }
function timingObservationChanges(current: SessionRunTiming | undefined, observation: RunTimingObservation) {
  const startedAtMs = validTime(observation.startedAtMs);
  const endedAtMs = validTime(observation.endedAtMs);
  const durationMs = validDuration(observation.durationMs);
  if (startedAtMs === undefined && endedAtMs === undefined && durationMs === undefined) return false;
  if (!current) return true;
  return (startedAtMs !== undefined && startedAtMs !== current.startedAtMs)
    || (endedAtMs !== undefined && endedAtMs !== current.endedAtMs)
    || (durationMs !== undefined && durationMs !== current.durationMs);
}
