import type { WorkspaceAttachment, WorkspaceMessage } from '../workspace/workspaceTypes';
import { assistantTextIsGatewayTruncated } from './messageCompleteness';
import { preferredToolSummary } from '../tooling/toolActivity';
import { assistantAttachmentSnapshot } from './assistantAttachmentSnapshot';
import { identifyCanonicalNarrationAliases } from './narrationLiveIdentity';
import { sharedNarrationDisplayOrder } from '../workspace/historyDisplayOrder';
import { isPendingInputCustodyRow } from './pendingInputSnapshot';
import { restoreObservedTokenRedaction } from './observedTokenRedaction';
import { isCanonicalQueuedPrompt } from './queuedPromptConsumption';
import { transcriptCliProvenance } from '../workspace/transcriptMetadata';

/**
 * Final publication invariant: one visible row per explicit Gateway identity.
 * Message ids are primary; a transport idempotency key is the stronger turn
 * identity when present. Equal text without shared identity remains distinct.
 */
export function coalesceTranscriptIdentities(messages: WorkspaceMessage[]) {
  // Durable hydration enriches an existing message with narration/submission
  // identity. That identity is an alias, not a replacement for its message ID:
  // delayed live rows and persisted older copies may still know only the ID.
  // Join exact IDs first so a metadata-bearing copy also bridges native aliases.
  const identified = coalesceByIdentity(
    coalesceByIdentity(identifyCanonicalNarrationAliases(messages), messageIdentity),
    transcriptPublicationIdentity,
  );
  return reconcilePendingInputAliases(identified);
}

/**
 * OpenClaw pending-input display rows deliberately omit their transport
 * idempotency key. The exact chat.send receipt can first bind custody to the
 * originating optimistic row; later, native acceptance coordinates bind it to
 * the committed Codex prompt. Keep the current owner and retire only its exact
 * custody alias. Canonical media requires one complete ordered snapshot; local
 * picker media stays authored until that canonical projection arrives.
 */
function reconcilePendingInputAliases(messages: WorkspaceMessage[]) {
  const pending = messages.filter(isPendingInputCustodyRow);
  if (!pending.length) return messages;
  const matches = pending.flatMap((alias) => {
    const owners = messages.filter((candidate) => committedInputMatches(alias, candidate) || acceptedLocalInputMatches(alias, candidate));
    return owners.length === 1 ? [{ alias, owner: owners[0]! }] : [];
  });
  const ownerUses = new Map<WorkspaceMessage, number>();
  for (const match of matches) ownerUses.set(match.owner, (ownerUses.get(match.owner) ?? 0) + 1);
  const unique = matches.filter(({ owner }) => ownerUses.get(owner) === 1);
  const removed = new Set(unique.map(({ alias }) => alias));
  if (!removed.size) return messages;
  const acceptedLocal = new Map(unique.flatMap(({ alias, owner }) => owner.source === 'local' ? [[owner, alias] as const] : []));
  const reconciled = messages.flatMap((message) => {
    if (removed.has(message)) return [];
    const acceptance = acceptedLocal.get(message);
    return acceptance ? [acceptedLocalInputRepresentation(message, acceptance)] : [message];
  });
  // A send acknowledgement can publish without a subsequent history merge.
  // Admit its newly proven acceptance gap immediately using the existing
  // chronology owner; retaining the optimistic slot would briefly misorder it.
  return acceptedLocal.size ? sharedNarrationDisplayOrder(reconciled) : reconciled;
}

/**
 * An active-run steer has two separate run identities: the existing lifecycle
 * owner retained on `runId`, and the exact chat.send acknowledgement exposed
 * by pending-input custody. Keep the already-painted local row until durable
 * history arrives; its picker media is the authored snapshot, while custody
 * can already use a managed media URI.
 */
function acceptedLocalInputMatches(alias: WorkspaceMessage, candidate: WorkspaceMessage) {
  return candidate !== alias && candidate.role === 'user' && candidate.source === 'local'
    && candidate.sessionKey === alias.sessionKey
    && (!candidate.transcriptSessionId || candidate.transcriptSessionId === alias.transcriptSessionId)
    && acceptedLocalInputReceiptMatches(alias, candidate)
    && sameSubmittedText(candidate.text, alias.text);
}

function acceptedLocalInputReceiptMatches(alias: WorkspaceMessage, candidate: WorkspaceMessage) {
  if (alias.inputReceiptRunId && alias.inputReceiptRunId !== alias.runId) return false;
  const receipt = alias.inputReceiptRunId || alias.runId;
  if (!receipt) return false;
  // An acknowledgement can bind the receipt first, and it may carry an
  // operation id other than the submission id the pending record keeps.
  // Either exact identity proves the same outbound submission.
  return candidate.inputReceiptRunId === receipt || candidate.idempotencyKey === receipt;
}

function acceptedLocalInputRepresentation(local: WorkspaceMessage, pending: WorkspaceMessage): WorkspaceMessage {
  const receipt = pending.inputReceiptRunId || pending.runId;
  return {
    ...local,
    ...(pending.transcriptSessionId ? { transcriptSessionId: pending.transcriptSessionId } : {}),
    ...(receipt ? { inputReceiptRunId: receipt } : {}),
    ...(pending.timestamp ? { timestamp: pending.timestamp } : {}),
    ...(pending.inputAcceptedAtMs !== undefined ? { inputAcceptedAtMs: pending.inputAcceptedAtMs } : {}),
  };
}

function committedInputMatches(alias: WorkspaceMessage, candidate: WorkspaceMessage) {
  return candidate !== alias && candidate.role === 'user' && candidate.source === 'history'
    && !candidate.id.startsWith('pending-input:') && Boolean(candidate.idempotencyKey?.endsWith(':user'))
    && Boolean(candidate.displayPosition)
    && candidate.sessionKey === alias.sessionKey
    && candidate.transcriptSessionId === alias.transcriptSessionId
    && committedInputReceiptMatches(alias, candidate)
    && (explicitAcceptedInput(candidate) && committedAcceptanceMatches(alias, candidate)
      || committedClaudeInputMatches(alias, candidate) && candidate.timestamp === alias.timestamp)
    && sameSubmittedText(candidate.text, alias.text)
    && exactInputMedia(alias.attachments, candidate.attachments);
}

/**
 * OpenClaw stamps a chat.send input when the request begins and stages its
 * pending custody later in the same request, so custody acceptance can follow
 * the committed stamp. Only the exact submission key may bridge that order;
 * execution-run correlation still requires the same acceptance time.
 */
function committedAcceptanceMatches(alias: WorkspaceMessage, candidate: WorkspaceMessage) {
  const committed = candidate.inputAcceptedAtMs;
  const custody = alias.inputAcceptedAtMs;
  if (committed === undefined || custody === undefined) return false;
  if (committed === custody) return candidate.timestamp === alias.timestamp;
  return committed < custody && exactSubmissionReceipt(alias, candidate);
}

/** Imported Claude prompts retain the submission key and acceptance timestamp,
 * but do not expose Codex's execution-run/acceptance descriptor. This exact
 * key bridge retires only its same-generation pending alias, not equal prose. */
function committedClaudeInputMatches(alias: WorkspaceMessage, candidate: WorkspaceMessage) {
  const runId = alias.inputReceiptRunId || alias.runId;
  if (!runId || !alias.sessionKey || !alias.transcriptSessionId || candidate.runId || candidate.inputAcceptedAtMs !== undefined
    || transcriptCliProvenance(candidate.cliProvenance)?.kind !== 'claude-native') return false;
  return isCanonicalQueuedPrompt(candidate, { sessionKey: alias.sessionKey, sessionId: alias.transcriptSessionId, runId });
}

/**
 * Retain the established exact execution-run correlation alongside current
 * OpenClaw's explicit receipt contract: it acknowledges and queues the client
 * idempotency key as the pending `runId`, while the committed Codex mirror
 * carries its distinct execution run and the same submission key with a
 * `:user` suffix. Accept only either exact identity; text is still merely the
 * final consistency check after route, generation and acceptance coordinates.
 */
function committedInputReceiptMatches(alias: WorkspaceMessage, candidate: WorkspaceMessage) {
  if (alias.inputReceiptRunId && alias.inputReceiptRunId !== alias.runId) return false;
  const receipt = alias.inputReceiptRunId || alias.runId;
  return Boolean(receipt && (receipt === candidate.runId || exactSubmissionReceipt(alias, candidate)));
}

function exactSubmissionReceipt(alias: WorkspaceMessage, candidate: WorkspaceMessage) {
  const receipt = alias.inputReceiptRunId || alias.runId;
  return Boolean(receipt && receipt === candidate.idempotencyKey?.replace(/:user$/i, ''));
}

/**
 * The composer keeps authored edge whitespace (a trailing newline or space)
 * that the Gateway trims when it stores the input. After the exact receipt
 * identity has matched, that difference must not keep two copies.
 */
function sameSubmittedText(left: string, right: string) {
  return left === right || left.trim() === right.trim();
}

function explicitAcceptedInput(message: WorkspaceMessage) {
  return Boolean(message.sessionKey && message.transcriptSessionId && message.runId
    && message.inputAcceptedAtMs !== undefined
    && message.timestamp === String(message.inputAcceptedAtMs)
    && !message.recovery
    && message.state !== 'streaming' && message.state !== 'error');
}

/**
 * Pending and canonical display rows are projections of the same stored input,
 * but attachment IDs can be synthesized independently. Require the complete
 * ordered attachment projection to agree and prove every item by an exact
 * source URI or an artifact ID in the already-matched route/generation scope.
 */
function exactInputMedia(left: WorkspaceAttachment[] | undefined, right: WorkspaceAttachment[] | undefined) {
  const first = left ?? [];
  const second = right ?? [];
  if (first.length !== second.length) return false;
  return first.every((attachment, index) => {
    const candidate = second[index]!;
    const sharedSource = Boolean(attachment.uri && attachment.uri === candidate.uri)
      || Boolean(attachment.artifactId && attachment.artifactId === candidate.artifactId
        && attachment.artifactSessionKey === candidate.artifactSessionKey);
    return sharedSource && attachment.filename === candidate.filename
      && attachment.mimeType === candidate.mimeType
      && attachment.uri === candidate.uri
      && attachment.artifactId === candidate.artifactId
      && attachment.artifactSessionKey === candidate.artifactSessionKey
      && attachment.byteCount === candidate.byteCount
      && attachment.pixelWidth === candidate.pixelWidth
      && attachment.pixelHeight === candidate.pixelHeight
      && exactHeaders(attachment.headers, candidate.headers);
  });
}

function exactHeaders(left: Record<string, string> | undefined, right: Record<string, string> | undefined) {
  if (!left || !right) return left === right;
  const leftEntries = Object.entries(left).sort(([a], [b]) => a.localeCompare(b));
  const rightEntries = Object.entries(right).sort(([a], [b]) => a.localeCompare(b));
  return leftEntries.length === rightEntries.length
    && leftEntries.every(([key, value], index) => rightEntries[index]?.[0] === key && rightEntries[index]?.[1] === value);
}

function coalesceByIdentity(messages: WorkspaceMessage[], identityOf: (message: WorkspaceMessage) => string) {
  const result: WorkspaceMessage[] = [];
  const positions = new Map<string, number>();
  for (const message of messages) {
    const identity = identityOf(message);
    const position = positions.get(identity);
    if (position === undefined) {
      positions.set(identity, result.length);
      result.push(message);
      continue;
    }
    result[position] = convergedTranscriptRepresentation(result[position]!, message);
  }
  return result.length === messages.length && result.every((message, index) => message === messages[index]) ? messages : result;
}

function messageIdentity(message: WorkspaceMessage) { return `message\u0000${message.id}`; }

export function transcriptPublicationIdentity(message: WorkspaceMessage) {
  if (message.asyncQuestion && message.sessionKey) return `async-question\u0000${message.sessionKey}\u0000${message.asyncQuestion.itemId}`;
  if (message.role === 'narration' && message.transcriptSessionId && message.narrationItemId) {
    return `narration\u0000${message.sessionKey}\u0000${message.transcriptSessionId}\u0000${message.narrationItemId}`;
  }
  if (!message.idempotencyKey) return messageIdentity(message);
  const submission = message.idempotencyKey.replace(/:(?:user|assistant)$/i, '');
  return `submission\u0000${submission}\u0000${message.role}`;
}

export function validatedAbsorbedLiveIdentity(value: unknown, message: WorkspaceMessage): WorkspaceMessage['absorbedLiveIdentity'] {
  if (message.role !== 'assistant' || message.state !== 'complete' || !message.sessionKey
    || message.source !== 'history' && message.source !== 'live'
    || !value || typeof value !== 'object') return undefined;
  const candidate = value as Record<string, unknown>;
  const boundedID = (id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length <= 512;
  if (!boundedID(candidate.messageId) || !boundedID(candidate.runId)
    || message.runId && message.runId !== candidate.runId) return undefined;
  return { messageId: candidate.messageId, runId: candidate.runId };
}

/** Carry only proven identity metadata across a fresh copy of the same row. */
export function retainingAbsorbedLiveIdentity(previous: WorkspaceMessage | undefined, incoming: WorkspaceMessage): WorkspaceMessage {
  if (!previous || previous.id !== incoming.id || previous.sessionKey !== incoming.sessionKey) return incoming;
  const previousIdentity = validatedAbsorbedLiveIdentity(previous.absorbedLiveIdentity, previous);
  if (!previousIdentity) return incoming;
  const priorNative = previous.cliProvenance;
  const incomingNative = incoming.cliProvenance;
  const sameNativeGeneration = Boolean(previous.transcriptSessionId
    && previous.transcriptSessionId === incoming.transcriptSessionId
    && priorNative?.kind === 'claude-native' && incomingNative?.kind === 'claude-native'
    && priorNative.sessionId === incomingNative.sessionId && priorNative.externalId === incomingNative.externalId
    && previous.id === priorNative.externalId && incoming.id === incomingNative.externalId);
  const refreshed: WorkspaceMessage = { ...incoming, state: incoming.state ?? 'complete',
    // Only a previously proven live alias may retain an already delivered
    // action token through a masked refresh. All other canonical bytes win.
    text: sameNativeGeneration ? restoreObservedTokenRedaction(incoming.text, previous.text) ?? incoming.text : incoming.text };
  const identity = validatedAbsorbedLiveIdentity(previousIdentity, refreshed);
  return identity ? { ...refreshed, runId: identity.runId, absorbedLiveIdentity: identity } : incoming;
}

export function absorbedLiveMessageMatches(canonical: WorkspaceMessage, incoming: WorkspaceMessage) {
  const identity = canonical.absorbedLiveIdentity;
  return Boolean(identity && canonical.role === 'assistant' && canonical.state === 'complete' && incoming.role === 'assistant'
    && (!canonical.runId || canonical.runId === identity.runId)
    && incoming.source === 'live' && incoming.sessionKey && canonical.sessionKey === incoming.sessionKey
    && identity.messageId === incoming.id && identity.runId === incoming.runId);
}

export function convergedTranscriptRepresentation(left: WorkspaceMessage, right: WorkspaceMessage): WorkspaceMessage {
  const preferred = representationScore(right) >= representationScore(left) ? right : left;
  const alternate = preferred === right ? left : right;
  const attachments = preferred.role === 'assistant' && alternate.role === 'assistant'
    ? assistantAttachmentSnapshot(alternate, preferred)
    // A submitted user message has one attachment snapshot, represented first
    // by local picker URIs and later by managed Gateway URIs. They are not
    // additive attachments. Missing media on a partial echo is not a clear.
    : preferred.role === 'user' && alternate.role === 'user'
      ? preferred.attachments ?? alternate.attachments ?? []
      : mergedAttachments(left.attachments, right.attachments);
  const state = terminalState(left.state, right.state);
  const tool = preferred.tool || alternate.tool ? {
    ...(alternate.tool ?? preferred.tool!),
    ...(preferred.tool ?? {}),
    summary: preferredToolSummary(alternate.tool?.summary ?? '', preferred.tool?.summary ?? ''),
    ...(Math.max(alternate.tool?.durationMs ?? 0, preferred.tool?.durationMs ?? 0) > 0
      ? { durationMs: Math.max(alternate.tool?.durationMs ?? 0, preferred.tool?.durationMs ?? 0) }
      : {}),
  } : undefined;
  const converged: WorkspaceMessage = {
    ...alternate,
    ...preferred,
    id: left.id,
    ...(left.displayPosition || right.displayPosition ? { displayPosition: left.displayPosition ?? right.displayPosition } : {}),
    ...(state ? { state } : {}),
    ...(preferred.runId || alternate.runId ? { runId: preferred.runId || alternate.runId } : {}),
    ...(preferred.sessionKey || alternate.sessionKey ? { sessionKey: preferred.sessionKey || alternate.sessionKey } : {}),
    ...(preferred.timestamp || alternate.timestamp ? { timestamp: preferred.timestamp || alternate.timestamp } : {}),
    ...(preferred.idempotencyKey || alternate.idempotencyKey ? { idempotencyKey: preferred.idempotencyKey || alternate.idempotencyKey } : {}),
    ...(tool ? { tool } : {}),
    ...(preferred.recovery || alternate.recovery ? { recovery: preferred.recovery ?? alternate.recovery } : {}),
  };
  // The caller has already established one identity/turn. Remember the exact
  // absorbed live ID so a delayed replay cannot become a new row after its
  // canonical replacement. Never infer this relation from equal text here.
  const canonical = left.source === 'history' ? left : right.source === 'history' ? right : undefined;
  const live = left.source === 'live' ? left : right.source === 'live' ? right : undefined;
  const absorbed = canonical?.role === 'assistant' && live?.role === 'assistant'
    && canonical.sessionKey && canonical.sessionKey === live.sessionKey
    ? validatedAbsorbedLiveIdentity({ messageId: live.id, runId: live.runId }, converged)
    : validatedAbsorbedLiveIdentity(converged.absorbedLiveIdentity, converged);
  if (absorbed) converged.absorbedLiveIdentity = absorbed;
  else delete converged.absorbedLiveIdentity;
  // Canonical history owns durable identity, timestamp and run metadata, but
  // only the local optimistic row still knows the exact Vimicate text typed
  // before a colon command was translated to OpenClaw's slash vocabulary.
  // Preserve that authored presentation when both rows name one submission.
  const authoredUser = left.role === 'user' && right.role === 'user'
    ? left.source === 'local' ? left : right.source === 'local' ? right : null
    : null;
  if (authoredUser) converged.text = authoredUser.text;
  if (attachments.length) converged.attachments = attachments;
  else delete converged.attachments;
  return converged;
}

function representationScore(message: WorkspaceMessage) {
  const source = message.source === 'history' ? 300 : message.source === 'live' ? 200 : message.source === 'local' ? 100 : 0;
  const terminal = message.state === 'complete' || message.state === 'error' ? 80 : message.state === 'streaming' ? 0 : message.source === 'history' ? 60 : 20;
  const assistant = message.role === 'assistant'
    ? (assistantTextIsGatewayTruncated(message.text) ? 0 : 120) + Math.min(80, message.text.length / 64) + (message.recovery?.state === 'recovered' ? 160 : 0)
    : 0;
  const tool = message.role === 'tool' ? (message.state === 'complete' || message.state === 'error' ? 100 : 0) + Math.min(40, message.text.length / 128) : 0;
  const resolvedApproval = message.approval?.resolved ? 120 : 0;
  return source + terminal + assistant + tool + resolvedApproval;
}

function terminalState(left: WorkspaceMessage['state'], right: WorkspaceMessage['state']) {
  const rank = (state: WorkspaceMessage['state']) => state === 'error' ? 3 : state === 'complete' ? 2 : state === 'streaming' ? 1 : 0;
  return rank(right) >= rank(left) ? right : left;
}

function mergedAttachments(left: WorkspaceAttachment[] | undefined, right: WorkspaceAttachment[] | undefined) {
  const result: WorkspaceAttachment[] = [];
  const seen = new Set<string>();
  for (const attachment of [...(left ?? []), ...(right ?? [])]) {
    const identity = `${attachment.id}\u0000${attachment.uri ?? ''}`;
    if (seen.has(identity)) continue;
    seen.add(identity); result.push(attachment);
  }
  return result;
}
