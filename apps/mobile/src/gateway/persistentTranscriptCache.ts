import { validSkillName } from '../tooling/skillReadEvidence';
import { repairedCachedMarkdownImages } from './cachedMarkdownImages';
import { persistedAsyncMetadata } from '../questions/asyncQuestionContract';
import { type WorkspaceAttachment, type WorkspaceMessage, type WorkspaceMessageRole } from '../workspace/workspaceTypes';
import { authoritativeHistoryChronology } from '../workspace/historyMessageProjection';
import { pruneUnownedRestoredLiveRows } from './transcriptChronology';
import { validatedAbsorbedLiveIdentity } from './transcriptIdentityWall';
import { inactiveMessageRecovery } from './messageRecovery';
import { reconcileClaudeNativeLive } from './claudeNativeLiveConvergence';
import { transcriptInternalEvent, transcriptInputAcceptedAt, transcriptInputReceiptRunId, transcriptCliProvenance, transcriptDisplayPosition, transcriptSessionIdentity } from '../workspace/transcriptMetadata';

// This is a restart/offline preview, not canonical scrollback. Keeping the
// bridge payload small prevents a cache write from spanning iOS suspension;
// Gateway history reconstructs the complete transcript after reconnect.
const CACHE_MESSAGE_LIMIT = 200;
const CACHE_BYTE_LIMIT = 512_000;
const CACHE_TEXT_LIMIT = 64_000;
const roles = new Set<WorkspaceMessageRole>(['user', 'assistant', 'narration', 'tool', 'run', 'approval', 'media', 'error', 'openclaw', 'session', 'workspace', 'command', 'boundary', 'config', 'system', 'vimicate', 'operator']);

export type TranscriptCacheBounds = {
  messageLimit?: number;
  byteLimit?: number;
  textLimit?: number;
};

export function serializedTranscriptCache(messages: WorkspaceMessage[], bounds: TranscriptCacheBounds = {}) {
  const messageLimit = positiveBound(bounds.messageLimit, CACHE_MESSAGE_LIMIT);
  const byteLimit = positiveBound(bounds.byteLimit, CACHE_BYTE_LIMIT);
  const textLimit = positiveBound(bounds.textLimit, CACHE_TEXT_LIMIT);
  const retained: WorkspaceMessage[] = [];
  let bytes = 2;
  for (const message of messages.slice(-messageLimit).reverse()) {
    const safe = cacheSafeMessage(message, textLimit);
    const size = JSON.stringify(safe).length + 1;
    if (retained.length && bytes + size > byteLimit) break;
    retained.push(safe); bytes += size;
  }
  return JSON.stringify(retained.reverse());
}

export function parsedTranscriptCache(payload: string | null, messageLimit = CACHE_MESSAGE_LIMIT) {
  const boundedLimit = positiveBound(messageLimit, CACHE_MESSAGE_LIMIT);
  if (!payload) return [];
  try {
    const raw: unknown = JSON.parse(payload);
    if (!Array.isArray(raw)) return [];
    return reconcileClaudeNativeLive(authoritativeHistoryChronology(
      pruneUnownedRestoredLiveRows(raw.slice(-boundedLimit).flatMap(parsedMessage)),
      (message) => message.source === 'history',
    ));
  } catch { return []; }
}

function cacheSafeMessage(message: WorkspaceMessage, textLimit: number): WorkspaceMessage {
  const text = message.text.length <= textLimit
    ? message.text
    : `${message.text.slice(0, textLimit)}\n… [cached preview truncated; canonical history is refreshing]`;
  // Tool output can contain arbitrary Markdown source with image-looking
  // paths. Canonical history will reconstruct genuine structured tool media;
  // never preserve older false-positive tool cards across launches.
  const attachments = message.role === 'tool' ? undefined : message.attachments?.map(({ headers: _headers, ...attachment }) => attachment);
  const absorbedLiveIdentity = validatedAbsorbedLiveIdentity(message.absorbedLiveIdentity, message);
  const recovery = inactiveMessageRecovery(message.recovery);
  const cliProvenance = transcriptCliProvenance(message.cliProvenance);
  return {
    id: message.id,
    ...persistedAsyncMetadata(message as unknown as Record<string, unknown>),
    role: message.role,
    ...(message.role === 'tool' && transcriptInternalEvent(message.internalEvent) ? { internalEvent: transcriptInternalEvent(message.internalEvent)! } : {}),
    text,
    ...(message.timestamp ? { timestamp: message.timestamp } : {}),
    ...(message.state && message.state !== 'streaming' ? { state: message.state } : {}),
    ...(message.runId ? { runId: message.runId } : {}),
    ...(message.sessionKey ? { sessionKey: message.sessionKey } : {}),
    ...(message.source ? { source: message.source } : {}),
    ...(message.transcriptSessionId ? { transcriptSessionId: message.transcriptSessionId } : {}),
    ...(message.narrationItemId ? { narrationItemId: message.narrationItemId } : {}),
    ...(message.role === 'user' && transcriptInputAcceptedAt(message.inputAcceptedAtMs) !== undefined ? { inputAcceptedAtMs: message.inputAcceptedAtMs } : {}),
    ...(message.role === 'user' && transcriptInputReceiptRunId(message.inputReceiptRunId) ? { inputReceiptRunId: message.inputReceiptRunId } : {}),
    ...(message.displayPosition ? { displayPosition: message.displayPosition } : {}),
    ...(cliProvenance ? { cliProvenance } : {}),
    ...(message.source === 'live' && message.steerSealed ? { steerSealed: true } : {}),
    ...(message.source === 'live' && message.role === 'assistant' && message.claudeNativeFullText
      && message.claudeNativeFullText.length <= textLimit ? { claudeNativeFullText: message.claudeNativeFullText } : {}),
    ...(message.idempotencyKey ? { idempotencyKey: message.idempotencyKey } : {}),
    ...(absorbedLiveIdentity ? { absorbedLiveIdentity } : {}),
    ...(message.tool ? { tool: message.tool } : {}),
    ...(attachments?.length ? { attachments } : {}),
    ...(recovery ? { recovery } : {}),
  };
}

function parsedMessage(value: unknown): WorkspaceMessage[] {
  if (!record(value) || typeof value.id !== 'string' || typeof value.role !== 'string' || !roles.has(value.role as WorkspaceMessageRole) || typeof value.text !== 'string') return [];
  const attachments = value.role === 'tool' ? [] : Array.isArray(value.attachments) ? value.attachments.flatMap(parsedAttachment) : [];
  const state = value.state === 'complete' || value.state === 'error' ? value.state : undefined;
  const source = value.source === 'history' || value.source === 'local' || value.source === 'live' ? value.source : undefined;
  const tool = parsedTool(value.tool);
  const recovery = parsedRecovery(value.recovery);
  const transcriptSessionId = transcriptSessionIdentity(value.transcriptSessionId);
  const displayPosition = transcriptDisplayPosition(value.displayPosition);
  const cliProvenance = transcriptCliProvenance(value.cliProvenance);
  const message: WorkspaceMessage = {
    id: value.id,
    ...persistedAsyncMetadata(value),
    role: value.role as WorkspaceMessageRole,
    ...(value.role === 'tool' && transcriptInternalEvent(value.internalEvent) ? { internalEvent: transcriptInternalEvent(value.internalEvent)! } : {}),
    text: value.text,
    ...(typeof value.timestamp === 'string' ? { timestamp: value.timestamp } : {}),
    ...(state ? { state } : {}),
    ...(typeof value.runId === 'string' ? { runId: value.runId } : {}),
    ...(typeof value.sessionKey === 'string' ? { sessionKey: value.sessionKey } : {}),
    ...(source ? { source } : {}),
    ...(transcriptSessionId ? { transcriptSessionId } : {}),
    ...(value.role === 'narration' && typeof value.narrationItemId === 'string' && value.narrationItemId.length > 0 && value.narrationItemId.length <= 256 ? { narrationItemId: value.narrationItemId } : {}),
    ...(value.role === 'user' && transcriptInputAcceptedAt(value.inputAcceptedAtMs) !== undefined ? { inputAcceptedAtMs: value.inputAcceptedAtMs as number } : {}),
    ...(value.role === 'user' && transcriptInputReceiptRunId(value.inputReceiptRunId) ? { inputReceiptRunId: value.inputReceiptRunId as string } : {}),
    ...(displayPosition ? { displayPosition } : {}),
    ...(cliProvenance ? { cliProvenance } : {}),
    ...(source === 'live' && value.steerSealed === true ? { steerSealed: true } : {}),
    ...(source === 'live' && value.role === 'assistant' && typeof value.claudeNativeFullText === 'string'
      && value.claudeNativeFullText.length <= CACHE_TEXT_LIMIT && value.claudeNativeFullText.endsWith(value.text)
      ? { claudeNativeFullText: value.claudeNativeFullText } : {}),
    ...(typeof value.idempotencyKey === 'string' ? { idempotencyKey: value.idempotencyKey } : {}),
    ...(tool ? { tool } : {}),
    ...(attachments.length ? { attachments } : {}),
    ...(recovery ? { recovery } : {}),
  };
  const absorbedLiveIdentity = validatedAbsorbedLiveIdentity(value.absorbedLiveIdentity, message);
  if (absorbedLiveIdentity) message.absorbedLiveIdentity = absorbedLiveIdentity;
  return [repairedCachedMarkdownImages(message)];
}

function parsedRecovery(value: unknown): WorkspaceMessage['recovery'] | undefined {
  if (!record(value) || typeof value.sourceMessageId !== 'string' || !['available', 'loading', 'failed', 'unavailable', 'recovered'].includes(String(value.state))) return undefined;
  return inactiveMessageRecovery({ sourceMessageId: value.sourceMessageId, state: value.state as NonNullable<WorkspaceMessage['recovery']>['state'], ...(typeof value.detail === 'string' ? { detail: value.detail } : {}) });
}

function parsedTool(value: unknown) {
  if (!record(value) || typeof value.name !== 'string' || typeof value.summary !== 'string') return undefined;
  return { name: value.name, summary: value.summary, ...(validSkillName(value.skillName) ? { skillName: value.skillName } : {}), ...(value.resultSucceeded === true ? { resultSucceeded: true as const } : {}), ...(typeof value.durationMs === 'number' ? { durationMs: value.durationMs } : {}) };
}

function parsedAttachment(value: unknown): WorkspaceAttachment[] {
  if (!record(value) || typeof value.id !== 'string' || typeof value.filename !== 'string' || typeof value.mimeType !== 'string') return [];
  return [{ id: value.id,
    ...persistedAsyncMetadata(value), filename: value.filename, mimeType: value.mimeType,
    ...(typeof value.byteCount === 'number' ? { byteCount: value.byteCount } : {}),
    ...(typeof value.uri === 'string' ? { uri: value.uri } : {}),
    ...(typeof value.artifactId === 'string' && value.artifactId.length > 0 && value.artifactId.length <= 512 ? { artifactId: value.artifactId } : {}),
    ...(typeof value.artifactSessionKey === 'string' && value.artifactSessionKey.length > 0 && value.artifactSessionKey.length <= 512 ? { artifactSessionKey: value.artifactSessionKey } : {}),
    ...(typeof value.pixelWidth === 'number' && value.pixelWidth > 0 && Number.isFinite(value.pixelWidth) ? { pixelWidth: value.pixelWidth } : {}),
    ...(typeof value.pixelHeight === 'number' && value.pixelHeight > 0 && Number.isFinite(value.pixelHeight) ? { pixelHeight: value.pixelHeight } : {}),
  }];
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function positiveBound(value: number | undefined, fallback: number) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}
