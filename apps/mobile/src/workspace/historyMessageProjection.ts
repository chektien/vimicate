import { markdownImageSources } from './markdownImagePath';
import { asyncQuestionMetadata, matchesAsyncAnswer, privateQuestionText } from '../questions/asyncQuestionContract';
import { mediaDirectiveLines } from './mediaDirectiveLines';
import { joinedUserPromptEnvelopes, strippedUserPromptEnvelope } from '../gateway/promptEnvelope';
import { withoutJoinedQueuedInputs } from '../gateway/claudeJoinedQueuedInputs';
import { displayedCommandTextFromWire } from '../gateway/gatewayCommands';
import { projectAssistantProtocolContent } from '../gateway/assistantProtocolProjection';
import { compactEmptyConversationBoundaries } from '../gateway/conversationBoundaries';
import { historyMessageRecoveryDescriptor } from '../gateway/messageCompleteness';
import { toolActivitiesFromContent, toolActivityFromContent, toolActivityPairedWithCall, toolCallActivityIndex, toolContentPartKind, toolRowText } from '../tooling/toolActivity';
import { conversationalToolProtocol } from '../tooling/embeddedToolProtocol';
import { historyDisplayOrder } from './historyDisplayOrder';
import { claudeOversizedRecordContent } from './claudeOversizedRecord';
import { semanticWorkspaceRole, workspaceRole } from './workspaceRole';
import { internalSystemRole, isClaudeCliCommentary, nativeTranscriptMetadata, nativeTranscriptMedia, transcriptSessionIdentity } from './transcriptMetadata';
import type { WorkspaceAttachment, WorkspaceMessage } from './workspaceTypes';
import { arrayAt, stringAt, numberAt, isRecord } from './workspacePayloadFields';

export function messagesFromPayload(payload: Record<string, unknown>, workspacePath = ''): WorkspaceMessage[] {
  const pendingRows = queuedInputRows(payload);
  const pendingAcceptance = new Map(pendingRows.map(row => [row, row.timestamp]));
  const rows = [...arrayAt(payload, ['messages', 'items', 'history']), ...pendingRows];
  const sessionKey = stringAt(payload, ['sessionKey', 'stableSessionKey', 'key']);
  const transcriptSessionId = transcriptSessionIdentity(payload.sessionId);
  const callActivities = toolCallActivityIndex(rows); const joinedPrompts = new Map<WorkspaceMessage, string[]>(); const asyncPrompts = rows.flatMap(row => isRecord(row) ? asyncQuestionMetadata(row).asyncQuestion ?? [] : []).slice(-128);
  const projected = rows.flatMap<WorkspaceMessage>((raw) => {
    if (!isRecord(raw)) return [];
    const fallback = isRecord(raw.openclawStreamFallback) ? raw.openclawStreamFallback : {};
    const narrationItemId = raw.role === 'assistant' && fallback.source === 'segment'
      && typeof fallback.itemId === 'string' && fallback.itemId.length > 0 && fallback.itemId.length <= 256 ? fallback.itemId : undefined;
    const declaredRole = narrationItemId || isClaudeCliCommentary(raw) ? 'narration' : internalSystemRole(raw) ?? workspaceRole(stringAt(raw, ['role', 'kind', 'type']));
    const content = claudeOversizedRecordContent(raw);
    const extractedText = extractText(content);
    const compactionBoundary = isCompactionControlMessage(extractedText);
    const role = compactionBoundary ? 'boundary' : semanticWorkspaceRole(declaredRole, content);
    // Every structured tool part is one execution and becomes its own bounded
    // row, so a message interleaving prose with tool parts keeps only the prose
    // a reader is meant to read. A tool row whose producer kept no structure at
    // all still resolves an identity from its stored text.
    const structured = toolActivitiesFromContent(content).map((activity) => toolActivityPairedWithCall(activity, callActivities));
    const inferred = structured.length || role !== 'tool' ? null : toolActivityFromContent(content, extractedText);
    // A runtime can also lose the structure of its own tool traffic and leave
    // the invocation, its framing and the raw result inside the message's own
    // prose; those executions become rows of their own too.
    const embedded = conversationalToolProtocol(role, extractedText);
    const activities = inferred ? [inferred] : [...structured, ...(embedded?.activities ?? [])];
    const text = compactionBoundary ? '--- compaction ---'
      : role === 'user' ? displayedCommandTextFromWire(strippedUserPromptEnvelope(extractedText)) : embedded?.prose ?? extractedText;
    // A tool result often prints source code or Markdown that merely mentions
    // images. Those strings are read-only tool output, not transcript media.
    // Keep genuine structured image blocks, but only scan prose rows for
    // Markdown/MEDIA/path attachments.
    const extractedAttachments = extractAttachments(raw, workspacePath, role !== 'tool');
    const assistantContent = role === 'assistant'
      ? projectAssistantProtocolContent(text, extractedAttachments, true)
      : { text, attachments: extractedAttachments };
    const asyncMetadata = asyncQuestionMetadata(raw);
    const asyncAnswerText = role === 'user' && (asyncMetadata.asyncQuestionReplyToId || asyncPrompts.some(q => matchesAsyncAnswer(q, assistantContent.text))) ? assistantContent.text : undefined;
    const projectedText = asyncAnswerText ? privateQuestionText(asyncAnswerText) : raw.openclawAsyncDelivery ? asyncMetadata.asyncQuestionPrivate ? 'Private input · Answer elsewhere in OpenClaw.' : privateQuestionText(assistantContent.text) : assistantContent.text;
    const attachments = assistantContent.attachments;
    const conversational = role !== 'tool' && Boolean(projectedText || attachments.length);
    if (!conversational && !activities.length && !attachments.length) return [];
    const timestamp = timestampAt(raw, ['timestamp', 'createdAt']);
    const native = nativeTranscriptMetadata(raw);
    const runId = stringAt(raw, ['runId']) || native.runId;
    const idempotencyKey = narrationItemId ? '' : stringAt(raw, ['idempotencyKey']) || native.idempotencyKey;
    const rawID = narrationItemId ? `native-narration:${transcriptSessionId ?? sessionKey}:${narrationItemId}` : stringAt(raw, ['id', 'messageId']) || native.id;
    const id = rawID || `history-${stableTextHash(`${role}\u0000${timestamp}\u0000${idempotencyKey}\u0000${projectedText || (activities[0] ? toolRowText(activities[0]) : '')}`)}`;
    const recovery = historyMessageRecoveryDescriptor(role, projectedText, raw.__openclaw, rawID);
    // One wire message publishes its Gateway identity once: the row carrying
    // the message's own role inherits it with the attachments and transport
    // keys, and every further row derives a deterministic, stable identity.
    const pendingAcceptedAtMs = pendingAcceptance.get(raw as typeof pendingRows[number]);
    const inputAcceptedAtMs = pendingAcceptedAtMs ?? native.inputAcceptedAtMs;
    const shared = { source: 'history' as const, ...(sessionKey ? { sessionKey } : {}), ...(transcriptSessionId ? { transcriptSessionId } : {}), ...(native.displayPosition ? { displayPosition: native.displayPosition } : {}), ...(native.cliProvenance ? { cliProvenance: native.cliProvenance } : {}), ...(timestamp ? { timestamp } : {}), ...(runId ? { runId } : {}) };
    const published: Array<Pick<WorkspaceMessage, 'role' | 'text' | 'state' | 'tool'>> = [
      ...(conversational ? [{ role, text: projectedText }] : []),
      ...activities.map((activity) => ({
        role: 'tool' as const,
        text: toolRowText(activity),
        ...(activity.status === 'failed' ? { state: 'error' as const } : {}),
        tool: { name: activity.name, summary: activity.summary },
      })),
    ];
    // A tool row can carry structured media instead of any resolvable activity.
    if (!published.length && role === 'tool' && attachments.length) published.push({ role, text: projectedText });
    if (!published.length) return [];
    const projectedRows: WorkspaceMessage[] = published.map((row, index) => ({
      ...row,
      id: index === 0 ? id : `${id}#tool-${index}`,
      ...shared,
      ...(index === 0 && role === 'user' && inputAcceptedAtMs !== undefined ? { inputAcceptedAtMs } : {}),
      ...(index === 0 && role === 'user' && pendingAcceptedAtMs !== undefined && runId ? { inputReceiptRunId: runId } : {}),
      ...(index === 0 ? asyncMetadata : {}), ...(index === 0 && asyncAnswerText ? { asyncQuestionAnswerText: asyncAnswerText } : {}),
      ...(index === 0 && narrationItemId ? { narrationItemId } : {}),
      ...(index === 0 && idempotencyKey ? { idempotencyKey } : {}),
      ...(index === 0 && attachments.length ? { attachments } : {}),
      ...(index === 0 && recovery ? { recovery } : {}),
    }));
    const joined = role === 'user' ? joinedUserPromptEnvelopes(extractedText) : null;
    if (joined && projectedRows[0]) joinedPrompts.set(projectedRows[0], joined.map(displayedCommandTextFromWire));
    return projectedRows;
  });
  return compactEmptyConversationBoundaries(authoritativeHistoryChronology(withoutJoinedQueuedInputs(projected, joinedPrompts)));
}

/** Accepted steer inputs stay outside OpenClaw's model history until their turn runs. */
function queuedInputRows(payload: Record<string, unknown>) {
  const page = isRecord(payload.pendingInputs) ? payload.pendingInputs : {};
  return arrayAt(page, ['items']).flatMap((value) => {
    if (!isRecord(value) || value.state !== 'queued' || !isRecord(value.message)) return [];
    const id = stringAt(value, ['id']);
    const runId = stringAt(value, ['runId']);
    const idempotencyKey = stringAt(value.message, ['idempotencyKey']);
    const acceptedAt = numberAt(value, ['acceptedAt']);
    if (!id || id.length > 512 || !Number.isSafeInteger(acceptedAt) || acceptedAt < 0
      || runId.length > 256 || idempotencyKey.length > 512) return [];
    return [{
      id: `pending-input:${id}`, role: 'user', content: value.message.content, timestamp: acceptedAt,
      ...(runId ? { runId } : {}), ...(idempotencyKey ? { idempotencyKey } : {}),
      ...(value.message.media !== undefined ? { media: value.message.media } : {}),
      ...(value.message.__openclaw !== undefined ? { __openclaw: value.message.__openclaw } : {}),
    }];
  });
}

/**
 * One order owner for parsing, page merges and cache restoration. Native
 * placement takes precedence over the legacy embedded-timestamp policy.
 */
export function authoritativeHistoryChronology(
  messages: WorkspaceMessage[],
  eligible: (message: WorkspaceMessage) => boolean = () => true,
) {
  return historyDisplayOrder(messages, eligible);
}

function isCompactionControlMessage(value: string) {
  return /^\s*Pre-compaction memory flush\.(?:\s|$)/i.test(value);
}


export function gatewayContentText(value: unknown): string {
  return extractText(value);
}

export function gatewayAttachments(value: unknown, workspacePath = ''): WorkspaceAttachment[] {
  return extractAttachments(value, workspacePath);
}

function timestampAt(value: Record<string, unknown>, keys: string[]) { for (const key of keys) { const candidate = value[key]; if (typeof candidate === 'string') return candidate; if (typeof candidate === 'number' && Number.isFinite(candidate)) return String(candidate); } return ''; }
function extractText(value: unknown): string {
  if (typeof value === 'string') return withoutConsumedMediaMarkers(value);
  if (Array.isArray(value)) return value.map((part) => {
    if (!isRecord(part)) return extractText(part);
    const type = stringAt(part, ['type']).toLowerCase();
    // A tool part is machine evidence with its own transcript row. Nothing it
    // carries belongs to the prose a reader scans for the answer.
    if (toolContentPartKind(part)) return '';
    if (type.includes('image') || type.includes('media')) return '';
    return extractText(part.text ?? part.content);
  }).filter(Boolean).join('\n');
  if (isRecord(value)) return extractText(value.text ?? value.content ?? value.message ?? value.result ?? value.output);
  return '';
}

function extractAttachments(value: unknown, workspacePath: string, scanText = true): WorkspaceAttachment[] {
  const extracted = extractAttachmentCandidates(value, workspacePath, scanText);
  const seen = new Set<string>();
  return extracted.filter((attachment) => {
    const identity = `${attachment.mimeType}\u0000${attachment.uri ?? ''}\u0000${attachment.filename}`;
    if (seen.has(identity)) return false;
    seen.add(identity); return true;
  });
}

function extractAttachmentCandidates(value: unknown, workspacePath: string, scanText: boolean): WorkspaceAttachment[] {
  if (typeof value === 'string') return scanText ? textMediaAttachments(value, workspacePath) : [];
  if (Array.isArray(value)) return value.flatMap((part) => extractAttachmentCandidates(part, workspacePath, scanText));
  if (!isRecord(value)) return [];
  const type = stringAt(value, ['type']).toLowerCase();
  const sourceRecord = isRecord(value.source) ? value.source : {};
  const imageURLRecord = isRecord(value.image_url) ? value.image_url : isRecord(value.imageUrl) ? value.imageUrl : {};
  const declaredMimeType = stringAt(value, ['mimeType', 'mime_type', 'contentType', 'media_type']) || stringAt(sourceRecord, ['mimeType', 'mime_type', 'media_type']);
  const rawSource = stringAt(value, ['url', 'uri', 'dataUrl', 'data_url', 'image_url', 'imageUrl', 'path', 'filePath', 'file_path', 'data', 'content'])
    || stringAt(sourceRecord, ['url', 'uri', 'dataUrl', 'data_url', 'path', 'filePath', 'file_path', 'data'])
    || stringAt(imageURLRecord, ['url', 'uri']);
  const directMedia = type.includes('image') || type.includes('media') || type.includes('file') || declaredMimeType.startsWith('image/') || Boolean(value.dataUrl) || Boolean(rawSource && (value.path || value.filePath));
  const nested = [nativeTranscriptMedia(value), value.attachments, value.images, value.image, value.image_url, value.imageUrl, value.files, value.media, value.screenshot, value.input_image, value.output_image, directMedia ? undefined : value.source, directMedia ? undefined : value.content, value.text].flatMap((part) => extractAttachmentCandidates(part, workspacePath, scanText));
  if (!directMedia) return nested;
  const mimeType = declaredMimeType || (type.includes('image') || value.dataUrl || isImageMediaSource(rawSource) ? 'image/*' : 'application/octet-stream');
  const uri = gatewayMediaURI(resolvedHostMediaSource(inlineMediaURI(rawSource, mimeType), workspacePath));
  if (!uri) return nested;
  const filename = stringAt(value, ['fileName', 'file_name', 'filename', 'name', 'title', 'alt']) || filenameForMediaURI(rawSource) || filenameForMediaURI(uri) || 'attachment';
  const artifactId = stringAt(value, ['artifactId']);
  const byteCount = numberAt(value, ['byteCount', 'byte_count', 'size', 'sizeBytes']);
  const pixelWidth = numberAt(value, ['pixelWidth', 'pixel_width', 'width']);
  const pixelHeight = numberAt(value, ['pixelHeight', 'pixel_height', 'height']);
  const attachment = { ...(artifactId && artifactId.length <= 512 ? { artifactId } : {}), id: stringAt(value, ['id', 'attachmentId']) || `media-${stableTextHash(`${uri}\u0000${filename}`)}`, filename, mimeType, ...(byteCount ? { byteCount } : {}), ...(pixelWidth ? { pixelWidth } : {}), ...(pixelHeight ? { pixelHeight } : {}), ...(uri ? { uri } : {}) };
  return [attachment, ...nested];
}

function textMediaAttachments(text: string, workspacePath: string): WorkspaceAttachment[] {
  const candidates: { source: string; alt: string }[] = markdownImageSources(text);
  for (const source of mediaDirectiveLines(text).values()) if (source) candidates.push({ source, alt: '' });
  let fence = '';
  for (const line of text.split('\n')) {
    const trimmed = line.trim(); const marker = trimmed.match(/^(`{3,}|~{3,})/i)?.[1] ?? '';
    if (marker) { if (!fence) fence = marker[0]!; else if (marker[0] === fence) fence = ''; continue; }
    if (fence || !trimmed || /MEDIA:/i.test(trimmed) || /^!\[/.test(trimmed) || /^(?:[-*+] |\d+[.)] )/.test(trimmed) || /^`.*`$/.test(trimmed)) continue;
    const source = trimmed.startsWith('<') && trimmed.endsWith('>') ? trimmed.slice(1, -1).trim() : trimmed;
    if (isImageMediaSource(source)) candidates.push({ source, alt: '' });
  }
  return candidates.flatMap(({ source, alt }) => {
    const clean = source.trim(); if (!isImageMediaSource(clean)) return [];
    const resolved = resolvedHostMediaSource(clean, workspacePath);
    const uri = gatewayMediaURI(resolved); const filename = alt.trim() || filenameForMediaURI(clean) || 'image'; const mimeType = imageMimeType(clean);
    return [{ id: `media-${stableTextHash(`${uri}\u0000${filename}`)}`, filename, mimeType, uri }];
  });
}

function withoutConsumedMediaMarkers(text: string) {
  const directives = mediaDirectiveLines(text);
  if (!directives.size) return text;
  return text.split('\n').flatMap((line, index) => !directives.has(index) ? [line]
    : directives.get(index) ? [] : ['image unavailable']).join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
}

function gatewayMediaURI(source: string) {
  if (/^file:\/\//i.test(source)) {
    try { return `/__openclaw__/assistant-media?source=${encodeURIComponent(decodeURIComponent(new URL(source).pathname))}`; }
    catch { return `/__openclaw__/assistant-media?source=${encodeURIComponent(source.replace(/^file:\/\//i, ''))}`; }
  }
  if (/^media:\/\/(?:inbound|outgoing)\//i.test(source)) return `/__openclaw__/assistant-media?source=${encodeURIComponent(source)}`;
  if (/^(?:https?:|data:)/i.test(source)) return source;
  if (source.startsWith('/api/chat/media/outgoing/') || source.startsWith('/__openclaw__/assistant-media')) return source;
  if (source.startsWith('/') || source.startsWith('~')) return `/__openclaw__/assistant-media?source=${encodeURIComponent(source)}`;
  if (isImageMediaSource(source)) return `/__openclaw__/assistant-media?source=${encodeURIComponent(source)}`;
  return source;
}
function isImageMediaSource(source: string) { return /^(?:(?:https?:\/\/|data:image\/|file:\/\/|\/|~)?[^\n]+)\.(?:png|jpe?g|gif|webp|heic|tiff?|bmp)(?:[?#].*)?$/i.test(source.trim()) || /^data:image\//i.test(source.trim()) || /^media:\/\/(?:inbound|outgoing)\//i.test(source.trim()); }
function imageMimeType(source: string) { const match = source.match(/\.(png|jpe?g|gif|webp|heic)(?:[?#].*)?$/i); const extension = match?.[1]?.toLowerCase(); return extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : extension ? `image/${extension}` : 'image/*'; }
function filenameForMediaURI(source: string) { const withoutQuery = source.split(/[?#]/)[0] ?? ''; const value = withoutQuery.split('/').at(-1) ?? ''; try { return decodeURIComponent(value); } catch { return value; } }
function inlineMediaURI(source: string, mimeType: string) { const trimmed = source.trim(); if (!trimmed || /^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(trimmed)) return trimmed; return /^[a-z0-9+/]+=*$/i.test(trimmed) && mimeType.startsWith('image/') ? `data:${mimeType};base64,${trimmed}` : trimmed; }

function resolvedHostMediaSource(source: string, workspacePath: string) {
  const trimmed = source.trim();
  if (!trimmed || /^(?:[a-z][a-z0-9+.-]*:|\/|~)/i.test(trimmed) || !workspacePath.trim()) return trimmed;
  const base = workspacePath.trim().replace(/\/+$/, '');
  const segments = `${base}/${trimmed}`.split('/'); const normalized: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === '.') continue;
    if (segment === '..') { if (normalized.length && normalized.at(-1) !== '~') normalized.pop(); continue; }
    normalized.push(segment);
  }
  return `${base.startsWith('/') ? '/' : ''}${normalized.join('/')}`;
}

function stableTextHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 0x01000193); }
  return (hash >>> 0).toString(36);
}

