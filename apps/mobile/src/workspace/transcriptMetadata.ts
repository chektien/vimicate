import type { AsyncQuestionMetadata } from '../questions/asyncQuestionContract';
/** Native transcript placement is presentation data, never run authority. */
export type TranscriptDisplayPosition = {
  source: string;
  rawSeq: number;
  activity?: { afterRawSeq: number | null; scopeId: string; startOrder: number };
};

export type TranscriptCliProvenance =
  | { kind: 'claude-native'; sessionId: string; externalId: string }
  | { kind: 'claude-aggregate'; runId: string };

export type TranscriptMessageMetadata = AsyncQuestionMetadata & {
  /** Concrete session named by history, not the selected route. */
  transcriptSessionId?: string;
  narrationItemId?: string;
  displayPosition?: TranscriptDisplayPosition;
  /** Explicit entry/delivery identity; never inferred from authored prose. */
  cliProvenance?: TranscriptCliProvenance;
  /** Original cumulative Claude text while the visible live row shows only its uncovered tail. */
  claudeNativeFullText?: string;
  /** Live Claude text sealed above a prompt steered into the running turn. */
  steerSealed?: boolean;
  idempotencyKey?: string;
  /** Gateway pending-input acceptance, not model-ingestion time. Display only. */
  inputAcceptedAtMs?: number;
  /** Exact chat.send acknowledgement / pending-custody identity, never lifecycle authority. */
  inputReceiptRunId?: string;
};

export function transcriptInputAcceptedAt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

export function transcriptInputReceiptRunId(value: unknown): string | undefined {
  return boundedText(value, 256) ? value : undefined;
}

export function transcriptCliProvenance(value: unknown): TranscriptCliProvenance | undefined {
  const row = record(value);
  if (row.kind === 'claude-native' && transcriptSessionIdentity(row.sessionId) && boundedText(row.externalId, 512)) {
    return { kind: row.kind, sessionId: transcriptSessionIdentity(row.sessionId)!, externalId: row.externalId };
  }
  if (row.kind === 'claude-aggregate' && boundedText(row.runId, 256)) return { kind: row.kind, runId: row.runId };
  return undefined;
}

export function sameCliProvenance(left: TranscriptCliProvenance | undefined, right: TranscriptCliProvenance | undefined) {
  return left === right || Boolean(left && right && left.kind === right.kind && (
    left.kind === 'claude-native' && right.kind === 'claude-native'
      ? left.sessionId === right.sessionId && left.externalId === right.externalId
      : left.kind === 'claude-aggregate' && right.kind === 'claude-aggregate' && left.runId === right.runId));
}

export function transcriptDisplayPosition(value: unknown): TranscriptDisplayPosition | undefined {
  const row = record(value);
  if (!boundedText(row.source, 128) || !ordinal(row.rawSeq)) return undefined;
  if (row.activity === undefined) return { source: row.source, rawSeq: row.rawSeq };
  const activity = record(row.activity);
  if (!boundedText(activity.scopeId, 1024) || !ordinal(activity.startOrder)
    || activity.afterRawSeq !== null && (!ordinal(activity.afterRawSeq) || activity.afterRawSeq >= row.rawSeq)) return undefined;
  return { source: row.source, rawSeq: row.rawSeq, activity: {
    afterRawSeq: activity.afterRawSeq as number | null, scopeId: activity.scopeId, startOrder: activity.startOrder,
  } };
}

export function transcriptSessionIdentity(value: unknown) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value.toLowerCase() : undefined;
}

/** Claude CLI splits a turn around tool calls; prose in a step that stops for a
 * tool is running commentary, the same kind Codex marks as preamble. */
export function isClaudeCliCommentary(raw: Record<string, unknown>) {
  return raw.role === 'assistant' && (raw.stopReason === 'tool_use' || raw.stopReason === 'toolUse')
    && (record(raw.__openclaw).importedFrom === 'claude-cli' || raw.provider === 'claude-cli');
}

/**
 * Harness-generated input stored in the user slot, such as Claude Code's
 * context-compaction summary (`provenance.kind: internal_system`). It is not
 * authored by the user, so it renders as a folded system notice.
 */
export function internalSystemRole(raw: Record<string, unknown>) {
  return raw.role === 'user' && record(raw.provenance).kind === 'internal_system' ? 'system' as const : null;
}

export function nativeTranscriptMetadata(raw: Record<string, unknown>) {
  const metadata = record(raw.__openclaw);
  const displayPosition = transcriptDisplayPosition(metadata.transcriptPosition);
  const key = typeof raw.idempotencyKey === 'string' ? raw.idempotencyKey : metadata.idempotencyKey;
  const cliProvenance = metadata.importedFrom === 'claude-cli'
    ? transcriptCliProvenance({ kind: 'claude-native', sessionId: metadata.cliSessionId, externalId: metadata.externalId })
    : raw.role === 'assistant' && raw.api === 'cli' && raw.provider === 'claude-cli' && raw.stopReason === 'stop'
      && typeof key === 'string' && key.startsWith('cli-assistant:')
      ? transcriptCliProvenance({ kind: 'claude-aggregate', runId: key.slice('cli-assistant:'.length) }) : undefined;
  // Codex prompt mirrors retain inbound acceptance time even when model
  // ingestion is delayed. Explicit steer records carry the target run instead.
  // Validate the native descriptor and host record time; never infer this from
  // prose, arbitrary user timestamps, or a client clock.
  const accepted = transcriptInputAcceptedAt(raw.timestamp);
  const recorded = transcriptInputAcceptedAt(metadata.recordTimestampMs);
  const inboundIdentity = boundedText(key, 512) && key.endsWith(':user')
    && (boundedText(metadata.steerTargetRunId, 256)
      || metadata.mirrorOrigin === 'codex-app-server' && boundedText(metadata.mirrorIdentity, 512)
        && metadata.mirrorIdentity.endsWith(':prompt') && boundedText(metadata.runId, 256));
  const inputAcceptedAtMs = raw.role === 'user' && displayPosition && inboundIdentity
    && accepted !== undefined && recorded !== undefined && accepted <= recorded ? accepted : undefined;
  return {
    ...(inputAcceptedAtMs !== undefined ? { inputAcceptedAtMs } : {}),
    id: boundedText(metadata.id, 512) ? metadata.id : '',
    idempotencyKey: boundedText(metadata.idempotencyKey, 512) ? metadata.idempotencyKey : '',
    // `chat.history` sends no top-level runId. Every message carries its run
    // identity here instead, and dropping it leaves canonical history unable
    // to say which run any row belongs to.
    runId: boundedText(metadata.runId, 256) ? metadata.runId
      : raw.role === 'user' && boundedText(metadata.steerTargetRunId, 256) ? metadata.steerTargetRunId : '',
    ...(displayPosition ? { displayPosition } : {}),
    ...(cliProvenance ? { cliProvenance } : {}),
  };
}

/** Read only explicit native descriptors, never text mentioning a file path. */
export function nativeTranscriptMedia(raw: Record<string, unknown>) {
  const media = record(raw.__openclaw).media;
  if (!Array.isArray(media) || media.length > 1024) return [];
  return media.flatMap((value) => {
    const descriptor = record(value);
    const url = boundedText(descriptor.url, 16_384) ? descriptor.url : '';
    const path = boundedText(descriptor.path, 8192) ? descriptor.path : '';
    if (!url && !path) return [];
    const contentType = boundedText(descriptor.contentType, 128) ? descriptor.contentType : '';
    const sizeBytes = positiveSafeInteger(descriptor.sizeBytes) ? descriptor.sizeBytes : undefined;
    const width = positiveSafeInteger(descriptor.width) ? descriptor.width : undefined;
    const height = positiveSafeInteger(descriptor.height) ? descriptor.height : undefined;
    return [{ type: descriptor.kind === 'image' ? 'image' : 'media',
      ...(url ? { url } : {}), ...(path ? { path } : {}), ...(contentType ? { contentType } : {}),
      ...(boundedText(descriptor.artifactId, 512) ? { artifactId: descriptor.artifactId } : {}),
      ...(sizeBytes !== undefined ? { sizeBytes } : {}),
      ...(width !== undefined ? { width } : {}),
      ...(height !== undefined ? { height } : {}) }];
  });
}

export function sameDisplayPosition(left: TranscriptDisplayPosition | undefined, right: TranscriptDisplayPosition | undefined) {
  return left === right || Boolean(left && right
    && left.source === right.source && left.rawSeq === right.rawSeq
    && left.activity?.afterRawSeq === right.activity?.afterRawSeq
    && left.activity?.scopeId === right.activity?.scopeId
    && left.activity?.startOrder === right.activity?.startOrder);
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function ordinal(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function positiveSafeInteger(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value > 0; }
function boundedText(value: unknown, limit: number): value is string { return typeof value === 'string' && value.length > 0 && value.length <= limit; }
