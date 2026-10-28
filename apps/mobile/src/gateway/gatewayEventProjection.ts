import { asyncQuestionMetadata, privateQuestionText } from '../questions/asyncQuestionContract';
import { liveNarrationInsertionIndex } from './liveNarrationPlacement';
import { semanticWorkspaceRole, type ApprovalDecision, type WorkspaceMessage, type WorkspaceProject } from '../workspace/workspaceTypes';
import { messagesFromPayload, gatewayAttachments, gatewayContentText } from '../workspace/historyMessageProjection';
import { machineActivitySummary, preferredToolSummary, toolActivityFromContent, toolActivityFromLiveEvent, toolRowText, toolSkillEvidence } from '../tooling/toolActivity';
import { embeddedToolProtocolFromText } from '../tooling/embeddedToolProtocol';
import { gatewayFrameSessionKey, type GatewayFrame } from './gatewayEvents';
import { runLifecycleMessageID } from './runCompletionMessage';
import { projectAssistantProtocolContent } from './assistantProtocolProjection';
import { isAssistantProjectionDiagnostic } from './gatewayDiagnosticProjection';
import { reconcileApprovalAbsence } from './approvalFinalization';
import { convergedLiveMessage } from './liveMessageConvergence';
import { absorbedLiveMessageMatches, convergedTranscriptRepresentation } from './transcriptIdentityWall';
import { canonicalIndexForFirstLiveFinal } from './liveAssistantHistoryPlacement';
import { reconcileClaudeNativeLive } from './claudeNativeLiveConvergence';
import { reconcileChatAfterRunDetail, uncoveredLiveChat } from './livePreambleChatConvergence';
import { transcriptSessionIdentity } from '../workspace/transcriptMetadata';
import { sessionApprovalMessage } from './sessionApprovalEvents';
import { sessionFailureNotice, convergeSessionFailureNotice } from './sessionFailureNotice';

export type GatewayEventProjection = {
  sessionKey: string;
  message: WorkspaceMessage;
};

export function projectGatewayEvent(frame: GatewayFrame, selectedSessionKey: string, workspacePath = ''): GatewayEventProjection | null {
  const event = stringValue(frame.event);
  const payload = recordValue(frame.payload);
  const request = recordValue(payload.request);
  // A live frame without session authority must never be attributed to
  // whichever project happens to be selected when it arrives.
  const sessionKey = gatewayFrameSessionKey(frame);
  if (!sessionKey || sessionKey !== selectedSessionKey) return null;
  if (event === 'sessions.changed') {
    const message = sessionFailureNotice(payload);
    return message ? { sessionKey, message } : null;
  }
  if (event === 'session.approval') {
    const message = sessionApprovalMessage(frame, sessionKey);
    return message ? { sessionKey, message } : null;
  }
  // OpenClaw's public ChatEvent and AgentEvent schemas require a non-empty
  // runId. Never borrow the session's current run for an ownerless frame: a
  // delayed frame from the preceding run could otherwise mutate the new turn.
  const runId = stringValue(payload.runId) || stringValue(request.runId) || stringValue(recordValue(payload.data).runId);
  const eventTimestamp = gatewayEventTimestamp(frame, payload);

  if (event === 'session.message' && asyncQuestionMetadata(recordValue(payload.message)).asyncMessage) {
    const message = messagesFromPayload({ sessionKey, messages: [payload.message], ...(payload.sessionId ? { sessionId: payload.sessionId } : {}) }, workspacePath)[0];
    return message ? { sessionKey, message } : null;
  }

  if (event === 'chat') {
    if (!runId) return null;
    const state = stringValue(payload.state);
    const wireMessage = recordValue(payload.message);
    const asyncMetadata = asyncQuestionMetadata(wireMessage);
    const content = wireMessage.content ?? payload.message;
    if (semanticWorkspaceRole('assistant', content) === 'tool') {
      const activity = toolActivityFromContent(content, gatewayContentText(content));
      if (!activity) return null;
      const toolCallId = activity.callId || String(payload.seq ?? 'tool');
      const failed = state === 'error' || activity.status === 'failed';
      return projection(sessionKey, {
        id: `live-tool-${runId}-${toolCallId}`,
        role: 'tool',
        text: toolRowText(activity),
        state: failed ? 'error' : state === 'delta' ? 'streaming' : 'complete',
        runId,
        tool: { name: activity.name, summary: activity.summary, ...toolSkillEvidence(failed ? { ...activity, status: 'failed' } : activity) },
      }, eventTimestamp);
    }
    const extractedText = gatewayContentText(content) || stringValue(payload.errorMessage);
    if (state === 'error' && isAssistantProjectionDiagnostic(extractedText)) return null;
    const extractedAttachments = gatewayAttachments(content, workspacePath);
    // A runtime whose tool protocol reached the client as assistant text
    // publishes only the prose it authored. Its executions have no live
    // identity to reconcile against, so the canonical page — which can publish
    // one row per execution — is the boundary that recovers them.
    const embedded = state === 'error' ? null : embeddedToolProtocolFromText(extractedText);
    const authoredText = embedded ? embedded.prose : extractedText;
    const assistantContent = state === 'error'
      ? { text: extractedText, attachments: extractedAttachments, deferred: false }
      : projectAssistantProtocolContent(authoredText, extractedAttachments, state !== 'delta');
    const { text, attachments } = assistantContent;
    const transcriptSessionId = transcriptSessionIdentity(payload.sessionId);
    if (assistantContent.deferred) return null;
    if (!text && !attachments.length && !asyncMetadata.asyncQuestion) return null;
    return projection(sessionKey, {
      id: asyncMetadata.asyncQuestion ? `live-async-${runId}-${asyncMetadata.asyncQuestion.itemId}` : `live-chat-${runId}`,
      ...(transcriptSessionId ? { transcriptSessionId } : {}),
      ...asyncMetadata,
      role: state === 'error' ? 'error' : 'assistant',
      text: wireMessage.openclawAsyncDelivery ? asyncMetadata.asyncQuestionPrivate ? 'Private input · Answer elsewhere in OpenClaw.' : privateQuestionText(text) : text,
      state: state === 'delta' ? 'streaming' : state === 'error' ? 'error' : 'complete',
      runId,
      ...(state !== 'error' && !wireMessage.openclawAsyncDelivery ? { chatCumulativeText: text } : {}),
      ...(attachments.length ? { attachments } : {}),
    }, eventTimestamp);
  }

  if (event === 'agent') {
    if (!runId) return null;
    const stream = stringValue(payload.stream);
    const data = recordValue(payload.data);
    if (stream === 'tool') {
      const activity = toolActivityFromLiveEvent(data);
      const toolCallId = activity.callId || String(payload.seq ?? 'tool');
      const phase = stringValue(data.phase);
      const result = recordValue(data.result);
      const durationMs = numberValue(data.durationMs) || numberValue(result.durationMs);
      return projection(sessionKey, {
        id: `live-tool-${runId}-${toolCallId}`,
        role: 'tool',
        text: toolRowText(activity),
        // A CLI runtime reports a failed call as a `result` phase carrying
        // `isError`; only the activity owner knows that is a failure.
        state: activity.status === 'failed' ? 'error' : phase === 'result' ? 'complete' : 'streaming',
        runId,
        tool: { name: activity.name, summary: activity.summary, ...toolSkillEvidence(activity), ...(durationMs ? { durationMs } : {}) },
      }, eventTimestamp);
    }
    if (stream === 'item' && stringValue(data.kind) === 'preamble') {
      const text = stringValue(data.progressText);
      if (!text) return null;
      // A preamble frame updates one logical announcement, and a runtime that
      // omits `itemId` still sends every update of it. `payload.seq` differs on
      // every frame, so it can never identify that announcement: keying on it
      // published one visible copy per update instead of revising the row.
      return projection(sessionKey, { id: `live-item-${runId}-${stringValue(data.itemId) || 'item'}`, role: 'narration', text, state: 'streaming', runId }, eventTimestamp);
    }
    if (stream === 'lifecycle' || stream === 'fallback') {
      const phase = stringValue(data.phase) || stream;
      const detail = stringValue(data.reasonSummary) || stringValue(data.reason) || stringValue(data.error);
      if (phase === 'error' || phase === 'failed') {
        const message = sessionFailureNotice({ sessionKey, sessionId: payload.sessionId, status: 'failed', lastRunId: runId,
          lastRunError: detail, endedAt: data.endedAt ?? data.endedAtMs ?? (eventTimestamp ? Number(eventTimestamp) : undefined) });
        return message ? { sessionKey, message } : null;
      }
      const terminalReply = recordValue(data.terminalReply);
      const transcriptSessionId = transcriptSessionIdentity(payload.sessionId);
      // The Gateway can emit a bare `model` phase during a run. It is
      // operational metadata, not a useful transcript update; run tracking
      // still consumes the frame independently of this visible projection.
      if (phase === 'model' && !detail) return null;
      return projection(sessionKey, { id: runLifecycleMessageID(sessionKey, runId), role: detail ? 'error' : 'run', text: [phase, detail].filter(Boolean).join(' · '), state: phase === 'end' ? 'complete' : phase === 'error' ? 'error' : 'streaming', runId,
        ...(transcriptSessionId ? { transcriptSessionId } : {}),
        ...(phase === 'end' && terminalReply.disposition === 'visible' && stringValue(terminalReply.text)
          ? { terminalReplyText: stringValue(terminalReply.text) } : {}) }, eventTimestamp);
    }
    if (stream === 'error') {
      const reason = stringValue(data.reason);
      const projected = reason ? { summary: reason, detail: '' } : machineActivitySummary(data, 'agent stream error');
      if (isAssistantProjectionDiagnostic(projected.summary)) return null;
      return projection(sessionKey, { id: `live-error-${runId}-${payload.seq ?? 'event'}`, role: 'error', text: [projected.summary, projected.detail].filter(Boolean).join('\n'), state: 'error', runId }, eventTimestamp);
    }
  }

  if (event === 'exec.approval.requested' || event === 'plugin.approval.requested') {
    const id = stringValue(payload.id) || 'pending';
    const requestSessionKey = stringValue(request.sessionKey);
    if (requestSessionKey && requestSessionKey !== selectedSessionKey) return null;
    const requested = stringValue(request.command) || stringValue(request.description);
    const projected = requested ? { summary: requested, detail: '' } : machineActivitySummary(request, 'Approval required');
    const summary = [projected.summary, projected.detail].filter(Boolean).join('\n');
    const allowedDecisions = Array.isArray(request.allowedDecisions)
      ? request.allowedDecisions.filter(isApprovalDecision)
      : ['allow-once', 'deny'] satisfies ApprovalDecision[];
    const expiresAtMs = numberValue(payload.expiresAtMs);
    return projection(sessionKey, { id: `live-approval-${id}`, role: 'approval', text: summary || 'Approval required', state: 'streaming', runId, approval: { id, kind: event.startsWith('plugin') ? 'plugin' : 'exec', allowedDecisions, resolved: false, ...(expiresAtMs ? { expiresAtMs } : {}) } }, eventTimestamp);
  }

  if (event === 'exec.approval.resolved' || event === 'plugin.approval.resolved') {
    const id = stringValue(payload.id) || 'pending';
    const decision = stringValue(payload.decision) || 'resolved';
    return projection(sessionKey, { id: `live-approval-${id}`, role: 'approval', text: `approval ${decision}`, state: 'complete', runId, approval: { id, kind: event.startsWith('plugin') ? 'plugin' : 'exec', allowedDecisions: [], resolved: true, outcome: decision === 'deny' ? 'denied' : 'allowed' } }, eventTimestamp);
  }

  return null;
}

/**
 * Project a live frame into its registered originating session, even when the
 * user has already selected a different project. Unknown or unscoped sessions
 * still fail closed; callers can safely publish the result into a parked
 * per-session cache without ever attributing it to current selection.
 */
export function projectRegisteredGatewayEvent(
  frame: GatewayFrame,
  projects: Array<Pick<WorkspaceProject, 'sessionKey' | 'path' | 'sessionId'>>,
) {
  const sessionKey = gatewayFrameSessionKey(frame);
  if (!sessionKey) return null;
  const owner = projects.find((project) => project.sessionKey === sessionKey);
  if (!owner) return null;
  const projected = projectGatewayEvent(frame, sessionKey, owner.path);
  const generation = projected?.message.transcriptSessionId;
  return projected?.message.id.startsWith('session-failure:') && generation && owner.sessionId && generation !== owner.sessionId ? null : projected;
}

export function pendingApprovalMessages(payload: unknown, kind: 'exec' | 'plugin', selectedSessionKey: string) {
  if (!Array.isArray(payload)) return [];
  return payload.flatMap((record) => {
    if (!recordValue(record).id) return [];
    const projected = projectGatewayEvent({ event: `${kind}.approval.requested`, payload: record }, selectedSessionKey);
    return projected ? [projected.message] : [];
  });
}

export function reconcilePendingApprovalMessages(current: WorkspaceMessage[], pending: WorkspaceMessage[], sessionKey: string) {
  return reconcileApprovalAbsence(current, pending, sessionKey).messages;
}

export function upsertLiveMessage(messages: WorkspaceMessage[], message: WorkspaceMessage) {
  const chat = uncoveredLiveChat(message, messages);
  const covered = chat !== message && chat.text === '' && !chat.attachments?.length && message.role === 'assistant';
  const previous = covered ? messages.find(row => row.id === message.id && row.sessionKey === message.sessionKey
    && row.runId === message.runId && row.source === 'live') : undefined;
  const previousUncovered = previous ? uncoveredLiveChat(previous, messages) : undefined;
  const next = covered
    ? previousUncovered && (previousUncovered.text || previousUncovered.attachments?.length)
      ? messages
      : messages.filter(row => row.id !== message.id || row.sessionKey !== message.sessionKey
        || row.runId !== message.runId || row.source !== 'live')
    : upsertLiveMessageRaw(messages, chat);
  return reconcileClaudeNativeLive(reconcileChatAfterRunDetail(next, message));
}

function upsertLiveMessageRaw(messages: WorkspaceMessage[], message: WorkspaceMessage) {
  message = convergeSessionFailureNotice(messages, message);
  const absorbedIndex = messages.findIndex((candidate) => absorbedLiveMessageMatches(candidate, message));
  const migratedIndex = absorbedIndex >= 0 ? absorbedIndex : canonicalIndexForFirstLiveFinal(messages, message);
  if (migratedIndex >= 0) {
    const converged = convergedTranscriptRepresentation(messages[migratedIndex]!, message);
    return messages.flatMap((candidate, index) => index === migratedIndex ? [converged]
      : candidate.id === message.id && candidate.sessionKey === message.sessionKey && candidate.runId === message.runId
        && candidate.role === 'assistant' && candidate.source === 'live' ? [] : [candidate]);
  }
  const index = messages.findIndex((candidate) => candidate.id === message.id);
  if (index < 0) return insertNewLiveMessage(messages, message);
  const previous = messages[index]!;
  // A late start/update must not undo a witnessed successful result. It may
  // supply the invocation identity when the result arrived first.
  if (previous.tool?.resultSucceeded && previous.state === 'complete' && message.state === 'streaming') {
    if (!previous.tool.skillName && message.tool?.skillName) return messages.map((row, i) => i === index
      ? { ...previous, tool: { ...previous.tool!, skillName: message.tool!.skillName! } } : row);
    return messages;
  }
  const converged = !previous.tool || !message.tool
    ? convergedLiveMessage(previous, message)
    : { ...message, tool: { ...message.tool, ...(previous.tool.skillName ? { skillName: previous.tool.skillName } : {}), summary: preferredToolSummary(previous.tool.summary, message.tool.summary) } };
  // The first live frame can be flushed without a source timestamp and land
  // at the tail. A later frame or durable narration snapshot can then add the
  // authoritative event coordinate under the same identity. Updating that
  // row in place preserves the very out-of-order transcript we are trying to
  // repair. Reinsert only when a valid timestamp actually changes; ordinary
  // cumulative/tool updates retain their existing publication slot and cannot
  // jitter among equal or untimed rows.
  if (timestampNumber(converged.timestamp) !== null
    && timestampNumber(previous.timestamp) !== timestampNumber(converged.timestamp)) {
    return insertNewLiveMessage(messages.filter((_, candidateIndex) => candidateIndex !== index), converged);
  }
  return messages.map((candidate, candidateIndex) => candidateIndex === index ? converged : candidate);
}

function insertNewLiveMessage(messages: WorkspaceMessage[], message: WorkspaceMessage) {
  const narrationIndex = liveNarrationInsertionIndex(messages, message);
  if (narrationIndex !== null) return [...messages.slice(0, narrationIndex), message, ...messages.slice(narrationIndex)];
  const promptFence = message.source === 'live' && message.runId && isRunDetail(message)
    ? lastIndexWhere(messages, (candidate) => candidate.source === 'local'
      && candidate.role === 'user'
      && (!candidate.runId || candidate.runId === message.runId))
    : -1;
  const eventTime = timestampNumber(message.timestamp);
  if (eventTime !== null) {
    // An optimistic prompt is stamped by the client while a live frame is
    // stamped by the host. Those clocks are not a shared chronology. Once a
    // run-owned detail reaches RN after a local prompt, keep that prompt as a
    // provisional publication fence; the later history/shared-narration row
    // can still cross it when the host supplies canonical authority.
    const laterIndex = messages.findIndex((candidate, candidateIndex) => {
      if (candidateIndex <= promptFence) return false;
      const candidateTime = timestampNumber(candidate.timestamp);
      return candidateTime !== null && candidateTime > eventTime;
    });
    if (laterIndex >= 0) return [...messages.slice(0, laterIndex), message, ...messages.slice(laterIndex)];
  }
  if (!message.runId || !isRunDetail(message)) return [...messages, message];
  const promptIndex = promptFence >= 0 ? promptFence
    : lastIndexWhere(messages, (candidate) => candidate.role === 'user' && candidate.runId === message.runId);
  if (promptIndex >= 0) {
    let insertionIndex = promptIndex + 1;
    while (insertionIndex < messages.length) {
      const candidate = messages[insertionIndex]!;
      if (candidate.runId !== message.runId
        || !(isRunDetail(candidate) || candidate.role === 'assistant' && candidate.state === 'streaming')) break;
      insertionIndex += 1;
    }
    return [...messages.slice(0, insertionIndex), message, ...messages.slice(insertionIndex)];
  }
  const terminalIndex = messages.findIndex((candidate) => candidate.runId === message.runId
    && (candidate.role === 'assistant' && candidate.state !== 'streaming'
      || candidate.role === 'run' && candidate.state === 'complete'));
  return terminalIndex < 0
    ? [...messages, message]
    : [...messages.slice(0, terminalIndex), message, ...messages.slice(terminalIndex)];
}

function isRunDetail(message: WorkspaceMessage) {
  return message.role === 'narration' || message.role === 'tool' || message.role === 'approval' || message.role === 'error';
}

function lastIndexWhere(messages: WorkspaceMessage[], predicate: (message: WorkspaceMessage) => boolean) {
  for (let index = messages.length - 1; index >= 0; index -= 1) if (predicate(messages[index]!)) return index;
  return -1;
}

function projection(sessionKey: string, message: WorkspaceMessage, timestamp?: string): GatewayEventProjection {
  return { sessionKey, message: { ...message, sessionKey, source: 'live', ...(timestamp ? { timestamp } : {}) } };
}

function gatewayEventTimestamp(frame: GatewayFrame, payload: Record<string, unknown>) {
  const raw = numberValue(payload.ts)
    || numberValue(payload.timestamp)
    || numberValue(recordValue(payload.message).timestamp)
    || numberValue(frame.ts)
    || numberValue(frame.timestamp);
  if (!raw) return undefined;
  return String(raw < 10_000_000_000 ? Math.round(raw * 1000) : Math.round(raw));
}

function timestampNumber(value: string | undefined) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function recordValue(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) { return typeof value === 'string' ? value : ''; }
function numberValue(value: unknown) { return typeof value === 'number' && Number.isFinite(value) ? value : 0; }
function isApprovalDecision(value: unknown): value is ApprovalDecision { return value === 'allow-once' || value === 'allow-always' || value === 'deny'; }
