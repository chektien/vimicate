import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { convergedTranscriptRepresentation } from './transcriptIdentityWall';

/** The reverse of history-after-live correlation: a canonical answer may be
 * published before the first chat final. Only the protocol's run-owned chat
 * identity plus its explicit prompt binding can establish that missing link.
 * Multiple equal canonical answers are ambiguous, never text-deduplicated. */
export function canonicalIndexForFirstLiveFinal(messages: WorkspaceMessage[], live: WorkspaceMessage) {
  if (live.role !== 'assistant' || live.source !== 'live' || live.state !== 'complete'
    || !live.sessionKey || !live.runId || live.id !== `live-chat-${live.runId}` || !live.text) return -1;
  let promptOwnsRun = false;
  let match = -1;
  for (let index = 0; index < messages.length; index += 1) {
    const candidate = messages[index]!;
    if (candidate.role === 'boundary') promptOwnsRun = false;
    if (candidate.role === 'user') {
      promptOwnsRun = candidate.sessionKey === live.sessionKey
        && (!candidate.runId || candidate.runId === live.runId)
        && (candidate.runId === live.runId || candidate.idempotencyKey === `${live.runId}:user`);
    }
    if (!promptOwnsRun || candidate.role !== 'assistant' || candidate.source !== 'history'
      || candidate.sessionKey !== live.sessionKey || candidate.text !== live.text
      || candidate.state && candidate.state !== 'complete'
      || candidate.runId && candidate.runId !== live.runId
      || candidate.absorbedLiveIdentity) continue;
    if (match >= 0) return -1;
    match = index;
  }
  return match;
}

export function correlateLiveAssistantsToCanonicalTurns(
  canonical: WorkspaceMessage[],
  live: WorkspaceMessage[],
  previous: WorkspaceMessage[],
) {
  const consumed = new Set<WorkspaceMessage>();
  const messages = canonical.map((candidate, canonicalIndex) => {
    if (candidate.role !== 'assistant') return candidate;
    const canonicalPrompt = precedingUser(canonical, canonicalIndex);
    if (!canonicalPrompt) return candidate;
    const match = live
      .filter((message) => !consumed.has(message) && assistantRepresentationsOverlap(candidate, message))
      .map((message) => ({ message, index: previous.indexOf(message) }))
      .filter(({ index }) => index >= 0 && sameTurnUser(canonicalPrompt, precedingUser(previous, index)))
      .sort((left, right) => right.message.text.length - left.message.text.length)[0]?.message;
    if (!match) return candidate;
    consumed.add(match);
    // A lagging page must not take the active row's ID: the next cumulative
    // frame still addresses that live ID. Defer this proven turn handoff until
    // history advances or completion establishes canonical authority.
    if (match.state === 'streaming' && candidate.state !== 'complete' && candidate.state !== 'error'
      && match.text.startsWith(candidate.text)) return match;
    return convergedTranscriptRepresentation(candidate, match);
  });
  return { messages, consumed };
}

export function liveAssistantHistoryPlacement(
  message: WorkspaceMessage,
  previous: WorkspaceMessage[],
  previousIndex: number,
  authoritativeLatest: WorkspaceMessage[],
  result: WorkspaceMessage[],
) {
  const timestamp = embeddedTimestampMilliseconds(message.timestamp);
  if (timestamp !== null) return { retain: true, timestamp, runBoundaryIndex: null };
  if (!untimestampedLiveAssistantHasPlacementAuthority(message, previous, previousIndex, authoritativeLatest)) {
    return { retain: false, timestamp: null, runBoundaryIndex: null };
  }
  return {
    retain: true,
    timestamp: null,
    runBoundaryIndex: ownedRunAssistantBoundaryIndex(result, message),
  };
}

export function embeddedTimestampMilliseconds(value: string | undefined) {
  if (!value) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function precedingUser(messages: WorkspaceMessage[], beforeIndex: number) {
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') return messages[index];
  }
  return undefined;
}

function sameTurnUser(left: WorkspaceMessage, right: WorkspaceMessage | undefined) {
  if (!right || !compatibleTurnOwners(left, right)) return false;
  if (left.id === right.id) return true;
  return Boolean(left.idempotencyKey && right.idempotencyKey
    && submissionBase(left.idempotencyKey) === submissionBase(right.idempotencyKey));
}

function compatibleTurnOwners(left: WorkspaceMessage, right: WorkspaceMessage) {
  return left.sessionKey === right.sessionKey
    && (!left.transcriptSessionId || !right.transcriptSessionId || left.transcriptSessionId === right.transcriptSessionId)
    && (!left.runId || !right.runId || left.runId === right.runId);
}

function submissionBase(value: string) {
  return value.replace(/:(?:user|assistant)$/i, '');
}

function assistantRepresentationsOverlap(left: WorkspaceMessage, right: WorkspaceMessage) {
  if (right.role !== 'assistant' || !compatibleTurnOwners(left, right)) return false;
  if (left.asyncMessage || right.asyncMessage || left.asyncQuestion || right.asyncQuestion) return Boolean(left.sessionKey === right.sessionKey && left.asyncQuestion && left.asyncQuestion.itemId === right.asyncQuestion?.itemId);
  if (left.text === right.text) return true;
  const shorter = left.text.length <= right.text.length ? left.text : right.text;
  const longer = shorter === left.text ? right.text : left.text;
  return shorter.length > 0 && longer.startsWith(shorter);
}

function untimestampedLiveAssistantHasPlacementAuthority(
  message: WorkspaceMessage,
  previous: WorkspaceMessage[],
  previousIndex: number,
  authoritativeLatest: WorkspaceMessage[],
) {
  if (message.runId && authoritativeLatest.some((candidate) => candidate.runId === message.runId
    && (candidate.role === 'user' || candidate.role === 'assistant' || candidate.role === 'run'))) return true;
  if (previousIndex < 0) return true;
  for (let index = previousIndex - 1; index >= 0; index -= 1) {
    const role = previous[index]?.role;
    if (role === 'user') return true;
    if (role === 'assistant' || role === 'boundary') return false;
  }
  return true;
}

function ownedRunAssistantBoundaryIndex(result: WorkspaceMessage[], message: WorkspaceMessage) {
  if (!message.runId) return null;
  let promptIndex = -1;
  for (let index = 0; index < result.length; index += 1) {
    const candidate = result[index]!;
    if (candidate.role === 'user' && candidate.runId === message.runId) promptIndex = index;
  }
  if (promptIndex < 0) return null;
  let insertionIndex = promptIndex + 1;
  while (insertionIndex < result.length) {
    const candidate = result[insertionIndex]!;
    if (candidate.role === 'assistant' || candidate.role === 'user' || candidate.role === 'boundary') break;
    insertionIndex += 1;
  }
  return insertionIndex;
}
