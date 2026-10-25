import type { WorkspaceMessage } from '../workspace/workspaceTypes';

export function runElapsedDescription(elapsedMs: number) {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60); const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60); const remainingMinutes = minutes % 60;
  return remainingMinutes === 0 ? `${hours}h` : `${hours}h ${remainingMinutes}m`;
}

export function runLifecycleMessageID(sessionKey: string, runId: string) {
  return `live-run-${runId || `session-${stableHash(sessionKey)}`}`;
}

export function completedRunMessage(sessionKey: string, runId: string, elapsedMs: number): WorkspaceMessage {
  return { id: runLifecycleMessageID(sessionKey, runId), role: 'run', text: `✓ done in ${runElapsedDescription(elapsedMs)}`, state: 'complete', runId, sessionKey, source: 'live', asyncQuestionRunOutcome: 'successful' };
}

export function pendingFinalRunMessage(sessionKey: string, runId: string): WorkspaceMessage {
  return { id: runLifecycleMessageID(sessionKey, runId), role: 'run', text: '… run completed · final answer pending', state: 'streaming', runId, sessionKey, source: 'live' };
}

/** Pending-final UI belongs only to the session's currently tracked run. */
export function reconcileOwnedPendingFinal(messages: WorkspaceMessage[], sessionKey: string, runId: string, ownsRun: boolean) {
  const pending = pendingFinalRunMessage(sessionKey, runId);
  if (ownsRun) return reconcileCompletedRunMessage(messages, pending);
  // Retire a stale pending notice, never a verified completion from an older run.
  return messages.filter(message => !(message.id === pending.id && message.sessionKey === sessionKey
    && message.state === 'streaming' && message.text === pending.text));
}

export function failedRunMessage(sessionKey: string, runId: string, elapsedMs: number, detail: string): WorkspaceMessage {
  const reason = detail.trim() || 'run failed';
  return {
    id: runLifecycleMessageID(sessionKey, runId),
    role: 'error',
    text: `● failed after ${runElapsedDescription(elapsedMs)} · ${reason}`,
    state: 'error',
    runId,
    sessionKey,
    source: 'live',
  };
}

export function reconcileCompletedRunMessage(messages: WorkspaceMessage[], completion: WorkspaceMessage) {
  const index = messages.findIndex((message) => message.id === completion.id);
  if (index < 0) return [...messages, completion];
  return messages.map((message, candidateIndex) => candidateIndex === index
    ? { ...completion, ...(message.terminalReplyText ? { terminalReplyText: message.terminalReplyText } : {}),
      ...(message.terminalReplyText && message.transcriptSessionId ? { transcriptSessionId: message.transcriptSessionId } : {}) }
    : message);
}

export function reconcileAuthoritativeActiveRunLifecycle(messages: WorkspaceMessage[], sessionKey: string, activeRunId: string) {
  if (!sessionKey || !activeRunId) return messages;
  const retained = messages.filter((message) => !(
    message.source === 'live'
    && message.sessionKey === sessionKey
    && message.runId
    && message.runId !== activeRunId
    && message.id === runLifecycleMessageID(sessionKey, message.runId)
    && (message.text === '… run completed · final answer pending'
      || /^● incomplete after .* · run finished without a final answer$/.test(message.text))
  ));
  return retained.length === messages.length ? messages : retained;
}

export function removeUnansweredRunLifecycle(messages: WorkspaceMessage[], sessionKey: string, runId: string) {
  const id = runLifecycleMessageID(sessionKey, runId);
  return messages.filter((message) => message.id !== id);
}

/**
 * Gateway history does not consistently retain runId on its durable assistant
 * row. Accept that canonical final only when it is structurally inside the
 * turn opened by this run's accepted prompt. This deliberately refuses an
 * older answer, an answer beyond a newer prompt/boundary, and progress-only
 * narration/tool rows.
 */
export function hasRenderedAssistantFinalForRun(messages: WorkspaceMessage[], runId: string) {
  if (messages.some((message) => hasFinalAssistantContent(message) && (!runId || message.runId === runId))) return true;
  if (!runId) return false;
  const promptIndex = messages.findLastIndex((message) => message.role === 'user' && message.runId === runId);
  if (promptIndex < 0) return false;
  for (let index = promptIndex + 1; index < messages.length; index += 1) {
    const message = messages[index]!;
    if (message.role === 'user' || message.role === 'boundary') return false;
    if (!message.runId && hasFinalAssistantContent(message)) return true;
  }
  return false;
}

function hasFinalAssistantContent(message: WorkspaceMessage) {
  // Run completion can precede its final chat frame. A visible cumulative
  // fragment must not retire the owner still confirming that missing final.
  return message.role === 'assistant' && !message.asyncMessage && !message.asyncQuestion && message.state !== 'streaming'
    && Boolean(message.text.trim() || message.attachments?.length);
}

function stableHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 0x01000193); }
  return (hash >>> 0).toString(36);
}
