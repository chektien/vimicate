import { liveNarrationInsertionIndex } from './liveNarrationPlacement';
import { type WorkspaceMessage } from '../workspace/workspaceTypes';
import { authoritativeHistoryChronology } from '../workspace/historyMessageProjection';
import { sharedNarrationDisplayOrder } from '../workspace/historyDisplayOrder';
import { coalesceTranscriptIdentities, convergedTranscriptRepresentation, retainingAbsorbedLiveIdentity, transcriptPublicationIdentity } from './transcriptIdentityWall';
import { pruneUnownedRestoredLiveRows } from './transcriptChronology';
import { correlateLiveAssistantsToCanonicalTurns, embeddedTimestampMilliseconds, liveAssistantHistoryPlacement } from './liveAssistantHistoryPlacement';
import { reconcileCompletePendingInputSnapshot, type PendingInputSnapshotReconciliation } from './pendingInputSnapshot';
import { provenClaudeNativeLive, reconcileClaudeNativeLive } from './claudeNativeLiveConvergence';
import { assistantTextIsGatewayIncomplete } from './messageCompleteness';

export type HistoryCursor = {
  sessionKey: string;
  nextOffset: number | null;
  hasMore: boolean;
  totalMessages: number;
};

export function historyCursorFromPayload(payload: Record<string, unknown>, sessionKey: string): HistoryCursor {
  const nextOffset = finiteNumber(payload.nextOffset);
  return {
    sessionKey,
    nextOffset,
    hasMore: payload.hasMore === true && nextOffset !== null,
    totalMessages: finiteNumber(payload.totalMessages) ?? 0,
  };
}

export function refreshedHistoryCursor(previous: HistoryCursor | null, latest: HistoryCursor): HistoryCursor {
  if (!previous || previous.sessionKey !== latest.sessionKey || !previous.hasMore || previous.nextOffset === null) return latest;
  const latestBase = latest.nextOffset ?? 0;
  const shifted = previous.nextOffset + Math.max(0, latest.totalMessages - previous.totalMessages);
  return { ...latest, nextOffset: Math.max(latestBase, shifted), hasMore: latest.hasMore };
}

export function mergeLatestHistory(latest: WorkspaceMessage[], current: WorkspaceMessage[], sessionKey: string, pendingInputs?: PendingInputSnapshotReconciliation) {
  current = reconcileCompletePendingInputSnapshot(pruneUnownedRestoredLiveRows(current), pendingInputs);
  // Rebuild `history-run-` projections after merging authoritative rows so
  // refresh cannot retain stale footers or sort them before their assistant.
  const earlier = current.filter((message) => message.source === 'history'
    && message.sessionKey === sessionKey
    && !isSyntheticHistoryCompletion(message));
  const localCandidates = current.filter((message) => message.source === 'local' && message.sessionKey === sessionKey);
  const localReconciliation = reconcileLatestLocalRows(latest, earlier, localCandidates);
  const previousById = new Map(current.map((message) => [message.id, message]));
  const previousByPublication = new Map(current.map(message => [transcriptPublicationIdentity(message), message]));
  const presentedLatest = localReconciliation.messages.map((message) => {
    const previous = previousById.get(message.id) ?? previousByPublication.get(transcriptPublicationIdentity(message));
    // Keep the already published row key while the fresh page owns its slot.
    const presented = previous?.source === 'history' && previous.id !== message.id
      ? convergedTranscriptRepresentation(previous, message) : message;
    return retainingAbsorbedLiveIdentity(previous, retainingRecoveredHistoryContent(previous, presented));
  });
  const local = localCandidates.filter((message) => !localReconciliation.consumed.has(message));
  const structuredLiveCandidates = current.filter((message) => message.source === 'live' && message.sessionKey === sessionKey && message.role !== 'assistant');
  const liveAssistants = current.filter((message) => message.source === 'live' && message.sessionKey === sessionKey && message.role === 'assistant');
  const richerLiveAssistant = (candidate: WorkspaceMessage) => candidate.state !== 'complete' && candidate.state !== 'error'
    && liveAssistants.find((live) => sameRunAssistant(candidate, live) && live.text.length > candidate.text.length);
  const latestHistoryIDs = new Set(presentedLatest.map(transcriptPublicationIdentity));
  // The newest page replaces overlapping durable rows. Retaining the earlier
  // copy first would leave cumulative/final rows permanently stale. Narration
  // can change message ID on canonicalization; the exact publication alias
  // must also retire its old slot before native chronology is evaluated.
  const canonicalHistory = authoritativeHistoryChronology(
    [...earlier.filter((message) => !latestHistoryIDs.has(transcriptPublicationIdentity(message))), ...presentedLatest].filter((message) => !richerLiveAssistant(message)),
    (message) => message.source === 'history',
  );
  const canonicalToolResults = new Set(canonicalHistory.flatMap((message) => {
    const identity = canonicalToolResultIdentity(message);
    return identity ? [identity] : [];
  }));
  // Live agent events collapse one tool execution into one row, while Codex
  // history persists the same execution as separate call/result rows. Once
  // the durable result exists, retaining the live aggregate duplicates every
  // completed tool and turns one terminal refresh into a large overlapping
  // list mutation. Both projections expose the exact tool-call id; reconcile
  // only that explicit identity and keep unmatched/streaming live detail.
  const structuredLive = structuredLiveCandidates.filter((message) => {
    const identity = liveToolCallIdentity(message);
    return !identity || !canonicalToolResults.has(identity);
  });
  // A refresh can re-derive a Claude run's footer from its live answer; that
  // projection is still the proof the run completed.
  const derivedFooters = current.filter(message => message.sessionKey === sessionKey && isSyntheticHistoryCompletion(message));
  const claudeMatches = provenClaudeNativeLive([...canonicalHistory, ...liveAssistants, ...structuredLive, ...derivedFooters]);
  const retiredClaudeLive = new Set(claudeMatches.map(match => match.live));
  const correlated = correlateLiveAssistantsToCanonicalTurns(canonicalHistory, liveAssistants, current);
  const assistantLive = liveAssistants.filter((message) => !retiredClaudeLive.has(message) && !correlated.consumed.has(message) && !presentedLatest.some((candidate) => {
    const contentIsRepresented = sameMeaning(candidate, message)
      || (sameRunAssistant(candidate, message) && candidate.text.length >= message.text.length);
    // Keep one equal live representation when canonical history has not
    // carried the run identity needed to place tool/lifecycle detail.
    const runIdentityIsRepresented = !message.runId || candidate.runId === message.runId;
    return contentIsRepresented && runIdentityIsRepresented;
  }));
  const withLocalPrompts = insertLocalPromptsAtPublishedPositions(correlated.messages, local, current, localReconciliation.replacements);
  // Gateway history does not currently expose runId on canonical assistant
  // rows. Converge the live assistant into its durable history position first
  // so lifecycle/tool detail can anchor to the final turn after a reload.
  // An unmatched live assistant is not necessarily the newest row. Canonical
  // protocol cleanup, truncation recovery, or a missing run identity can make
  // the same older answer unsafe to coalesce by text. Appending every such row
  // after the canonical page moved that older answer below a later completed
  // turn on refresh. Prefer its authoritative embedded timestamp so this pass
  // also repairs caches already corrupted by an older app version; only fall
  // back to its prior publication slot when no comparable timestamp exists.
  const withLiveAssistants = insertLiveAssistantsAtChronologicalPositions(
    withLocalPrompts,
    assistantLive,
    current,
    localReconciliation.replacements,
    presentedLatest,
  );
  return reconcileClaudeNativeLive(sharedNarrationDisplayOrder(deduplicated(insertLiveDetailAtRunFinals(withLiveAssistants, structuredLive, current, localReconciliation.replacements))), claudeMatches);
}

/** A fresh history page can still carry a Gateway display cap after message.get succeeded. */
function retainingRecoveredHistoryContent(previous: WorkspaceMessage | undefined, incoming: WorkspaceMessage): WorkspaceMessage {
  // A recovered oversized tool message projects as a tool row; its refreshed page still carries the assistant placeholder.
  if (!previous || previous.role !== 'assistant' && previous.role !== 'tool' || incoming.role !== 'assistant'
    || previous.source !== 'history' || incoming.source !== 'history'
    || previous.sessionKey !== incoming.sessionKey
    || previous.transcriptSessionId !== incoming.transcriptSessionId
    || previous.recovery?.state !== 'recovered'
    || previous.recovery.sourceMessageId !== incoming.id
    || incoming.recovery?.sourceMessageId && incoming.recovery.sourceMessageId !== previous.recovery.sourceMessageId
    || assistantTextIsGatewayIncomplete(previous.text) || !assistantTextIsGatewayIncomplete(incoming.text)) return incoming;
  return {
    ...incoming,
    ...(previous.role === 'tool' ? { role: 'tool' as const, ...(previous.tool ? { tool: previous.tool } : {}) } : {}),
    text: previous.text,
    ...(previous.attachments ? { attachments: previous.attachments } : {}),
    recovery: previous.recovery,
  };
}

export function mergeOlderHistory(older: WorkspaceMessage[], current: WorkspaceMessage[], sessionKey: string) {
  const scopedOlder = older.filter((message) => message.sessionKey === sessionKey);
  return reconcileClaudeNativeLive(authoritativeHistoryChronology(
    deduplicated([...scopedOlder, ...current].filter((message) => !isSyntheticHistoryCompletion(message))),
    (message) => message.source === 'history',
  ));
}

function deduplicated(messages: WorkspaceMessage[]) {
  return coalesceTranscriptIdentities(messages);
}

function sameMeaning(left: WorkspaceMessage, right: WorkspaceMessage) {
  if (left.role !== right.role) return false;
  // Explicit submissions can intentionally repeat the same prose and clock.
  // Conflicting keys disprove this alias before any legacy content fallback.
  if (left.idempotencyKey && right.idempotencyKey) return sameSubmissionIdentity(left.idempotencyKey, right.idempotencyKey);
  return left.text === right.text && (!left.timestamp || !right.timestamp || left.timestamp === right.timestamp);
}

function sameSubmissionIdentity(left: string, right: string) {
  const base = (value: string) => value.replace(/:(?:user|assistant)$/i, '');
  return base(left) === base(right);
}

function canonicalToolResultIdentity(message: WorkspaceMessage) {
  if (message.role !== 'tool' || !message.idempotencyKey) return '';
  const match = message.idempotencyKey.match(/:tool:(.+):result$/i);
  return match?.[1] ?? '';
}

function liveToolCallIdentity(message: WorkspaceMessage) {
  if (message.role !== 'tool' || message.source !== 'live' || !message.runId) return '';
  const prefix = `live-tool-${message.runId}-`;
  return message.id.startsWith(prefix) ? message.id.slice(prefix.length) : '';
}

function reconcileLatestLocalRows(latest: WorkspaceMessage[], durable: WorkspaceMessage[], local: WorkspaceMessage[]) {
  const consumedDurable = new Set<WorkspaceMessage>();
  const consumed = new Set<WorkspaceMessage>();
  const replacements = new Map<WorkspaceMessage, WorkspaceMessage>();
  const messages = latest.map((message) => {
    // Every newest-page refresh becomes the input to the next refresh. A user
    // row already canonicalized on the preceding pass must claim its own
    // durable occurrence before equal-text optimistic rows are considered.
    // Otherwise the first canonical row consumes the second local occurrence
    // on pass two, eventually deleting or reversing later repeated prompts.
    const published = message.role === 'user'
      ? durable.find((candidate) => !consumedDurable.has(candidate) && sameDurableUserIdentity(message, candidate))
      : undefined;
    if (published) {
      consumedDurable.add(published);
      // The published durable row can still carry Vimicate's exact authored
      // colon-command spelling from an earlier local convergence. Preserve
      // that presentation while the newest Gateway row refreshes metadata.
      const refreshed = convergedTranscriptRepresentation(message, published);
      // The fresh page owns the submitted media snapshot. The retained copy
      // may contain an old local+managed union persisted by an earlier client;
      // preserve authored text/position without carrying that union forward.
      return message.attachments !== undefined ? { ...refreshed, attachments: message.attachments } : refreshed;
    }
    // Pending-input custody deliberately omits the submission key and owns a
    // separate chat.send receipt identity. Do not let timestamp/text fallback
    // consume an arbitrary optimistic row before the central identity wall can
    // reconcile that explicit receipt while preserving lifecycle ownership.
    const authored = message.id.startsWith('pending-input:') ? undefined
      : local.find((candidate) => !consumed.has(candidate) && sameMeaning(message, candidate));
    if (!authored) return message;
    consumed.add(authored);
    const replacement = convergedTranscriptRepresentation(message, authored);
    replacements.set(authored, replacement);
    return replacement;
  });
  return { messages, consumed, replacements };
}

function sameDurableUserIdentity(left: WorkspaceMessage, right: WorkspaceMessage) {
  if (right.source !== 'history' || right.role !== 'user') return false;
  if (left.id === right.id) return true;
  return Boolean(left.idempotencyKey && right.idempotencyKey && sameSubmissionIdentity(left.idempotencyKey, right.idempotencyKey));
}

function sameRunAssistant(left: WorkspaceMessage, right: WorkspaceMessage) {
  if (left.asyncMessage || right.asyncMessage || left.asyncQuestion || right.asyncQuestion) return Boolean(left.sessionKey === right.sessionKey && left.asyncQuestion && left.asyncQuestion.itemId === right.asyncQuestion?.itemId);
  return Boolean(left.runId && right.runId && left.runId === right.runId && left.role === 'assistant' && right.role === 'assistant');
}

function insertLocalPromptsAtPublishedPositions(canonical: WorkspaceMessage[], local: WorkspaceMessage[], previous: WorkspaceMessage[], replacements: ReadonlyMap<WorkspaceMessage, WorkspaceMessage>) {
  const result = [...canonical];
  for (const prompt of local) {
    const previousIndex = previous.indexOf(prompt);
    if (previousIndex < 0) { result.push(prompt); continue; }
    // Latest Gateway history can canonicalize only the first of several
    // prompts submitted to one active run. Anchor each still-local prompt to
    // the nearest row that has already been published (including the
    // canonical replacement of an earlier optimistic prompt). Anchoring only
    // to rows whose source was already `history` moved the remaining prompts
    // ahead of that canonical replacement for one refresh and caused the
    // visible turn order to flip repeatedly while history caught up.
    insertAtPreviousPublicationPosition(result, prompt, previous, previousIndex, replacements);
  }
  return result;
}

function insertLiveAssistantsAtChronologicalPositions(canonical: WorkspaceMessage[], rows: WorkspaceMessage[], previous: WorkspaceMessage[], replacements: ReadonlyMap<WorkspaceMessage, WorkspaceMessage>, authoritativeLatest: WorkspaceMessage[]) {
  const result = [...canonical];
  for (const message of rows) {
    const previousIndex = previous.indexOf(message);
    const placement = liveAssistantHistoryPlacement(message, previous, previousIndex, authoritativeLatest, result);
    if (!placement.retain) continue;
    // A persisted live answer can lack a comparable timestamp while its
    // exact run-owned prompt remains canonical. Its old cache coordinate is
    // not chronology authority: an older build may have stored that answer
    // inside a newer turn. Re-anchor it at the owning turn's assistant
    // boundary before considering the prior publication slot.
    if (placement.runBoundaryIndex !== null) {
      result.splice(placement.runBoundaryIndex, 0, message);
      continue;
    }
    const { timestamp } = placement;
    const laterIndex = timestamp === null ? -1 : result.findIndex((candidate) => {
      const candidateTimestamp = embeddedTimestampMilliseconds(candidate.timestamp);
      return candidateTimestamp !== null && candidateTimestamp > timestamp;
    });
    if (laterIndex >= 0) {
      result.splice(laterIndex, 0, message);
      continue;
    }
    const hasComparableTimestamp = timestamp !== null
      && result.some((candidate) => embeddedTimestampMilliseconds(candidate.timestamp) !== null);
    if (hasComparableTimestamp) {
      const lastTimestampedIndex = result.findLastIndex((candidate) => embeddedTimestampMilliseconds(candidate.timestamp) !== null);
      result.splice(lastTimestampedIndex + 1, 0, message);
    } else if (previousIndex < 0) result.push(message);
    else insertAtPreviousPublicationPosition(result, message, previous, previousIndex, replacements);
  }
  return result;
}

function insertLiveDetailAtRunFinals(canonical: WorkspaceMessage[], detail: WorkspaceMessage[], previous: WorkspaceMessage[], replacements: ReadonlyMap<WorkspaceMessage, WorkspaceMessage>) {
  const result = [...canonical];
  const beforeCounts = new Map<string, number>();
  const afterCounts = new Map<string, number>();
  const promptCounts = new Map<string, number>();
  // A terminal event can reach the client before the run's final tool/chat
  // projections. Place every ordinary detail row first, then anchor lifecycle
  // completions as true footers after the now-stable canonical final.
  const orderedDetail = [
    ...detail.filter((message) => !(message.role === 'run' && message.state === 'complete')),
    ...detail.filter((message) => message.role === 'run' && message.state === 'complete'),
  ];
  for (const message of orderedDetail) {
    const narrationIndex = liveNarrationInsertionIndex(result, message);
    if (narrationIndex !== null) { result.splice(narrationIndex, 0, message); continue; }
    const previousIndex = previous.indexOf(message);
    const terminalCompletion = message.role === 'run' && message.state === 'complete';
    const sharedRunPromptCount = message.runId
      ? previous.filter((candidate) => candidate.role === 'user' && candidate.runId === message.runId).length
      : 0;
    if (!terminalCompletion && previousIndex >= 0 && sharedRunPromptCount > 1) {
      // Steering prompts accepted while one Gateway run is active share that
      // runId. Run-level anchoring cannot distinguish their already-visible
      // interleaving and used to regroup every preamble/tool before or after
      // all steering prompts on the next history refresh. Preserve the exact
      // publication sequence for ordinary detail in this multi-prompt run;
      // canonical rows still replace their optimistic counterparts in place.
      // A completed lifecycle row is a footer, however, and must re-anchor
      // after the canonical final even when it reached RN before the final
      // chat/tool projections.
      insertAtPreviousPublicationPosition(result, message, previous, previousIndex, replacements);
      continue;
    }
    let runFinalIndex = message.runId ? result.findIndex((candidate) => candidate.source === 'history' && candidate.role === 'assistant' && candidate.runId === message.runId) : -1;
    if (terminalCompletion && runFinalIndex < 0 && message.runId) {
      // Gateway history currently omits runId from canonical assistants while
      // the canonicalized user prompts retain the accepted local run owner.
      // Resolve the final by that run's last prompt boundary so the lifecycle
      // footer cannot fall immediately after the first prompt in a steered run.
      runFinalIndex = canonicalFinalIndexForRun(result, message.runId);
    }
    if (runFinalIndex < 0) {
      const runPromptIndex = message.runId
        ? result.findIndex((candidate) => candidate.role === 'user' && candidate.runId === message.runId)
        : -1;
      if (runPromptIndex >= 0) {
        // A canonical history assistant may not expose runId even though its
        // locally-authored prompt does. Late preamble/tool frames must remain
        // attached to that prompt rather than anchoring to whichever newer
        // history row happened to precede their delayed publication.
        const count = promptCounts.get(message.runId!) ?? 0;
        result.splice(runPromptIndex + 1 + count, 0, message);
        promptCounts.set(message.runId!, count + 1);
        continue;
      }
      if (previousIndex < 0) { result.push(message); continue; }
      // A local prompt may already have become a canonical history prompt.
      // Anchor against the nearest preceding row that has a published
      // counterpart, not merely the nearest row that was already history.
      insertAtPreviousPublicationPosition(result, message, previous, previousIndex, replacements);
      continue;
    }
    const afterFinal = terminalCompletion;
    const counts = afterFinal ? afterCounts : beforeCounts;
    const count = counts.get(message.runId!) ?? 0;
    result.splice(runFinalIndex + (afterFinal ? 1 + count : 0), 0, message);
    counts.set(message.runId!, count + 1);
  }
  return result;
}

function canonicalFinalIndexForRun(messages: WorkspaceMessage[], runId: string) {
  let promptIndex = -1;
  for (let index = 0; index < messages.length; index += 1) {
    if (messages[index]?.role === 'user' && messages[index]?.runId === runId) promptIndex = index;
  }
  if (promptIndex < 0) return -1;
  let finalIndex = -1;
  for (let index = promptIndex + 1; index < messages.length; index += 1) {
    const candidate = messages[index]!;
    if (candidate.role === 'boundary' || candidate.role === 'user') break;
    if (candidate.source === 'history' && candidate.role === 'assistant') finalIndex = index;
  }
  return finalIndex;
}

function isSyntheticHistoryCompletion(message: WorkspaceMessage) {
  return message.source === 'history'
    && message.role === 'run'
    && message.id.startsWith('history-run-');
}

function insertAtPreviousPublicationPosition(result: WorkspaceMessage[], message: WorkspaceMessage, previous: WorkspaceMessage[], previousIndex: number, replacements: ReadonlyMap<WorkspaceMessage, WorkspaceMessage>) {
  const anchorIndex = precedingPublishedAnchorIndex(result, previous, previousIndex, replacements);
  let insertionIndex = Math.max(0, anchorIndex + 1);
  while (insertionIndex < result.length && result[insertionIndex]?.source !== 'history') {
    const candidatePreviousIndex = previous.indexOf(result[insertionIndex]!);
    if (candidatePreviousIndex < 0 || candidatePreviousIndex >= previousIndex) break;
    insertionIndex += 1;
  }
  result.splice(insertionIndex, 0, message);
}

function precedingPublishedAnchorIndex(result: WorkspaceMessage[], previous: WorkspaceMessage[], beforeIndex: number, replacements: ReadonlyMap<WorkspaceMessage, WorkspaceMessage>) {
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    const anchor = previous[index]!;
    const replacement = replacements.get(anchor);
    if (replacement) {
      const replacementIndex = result.findIndex((candidate) => candidate.id === replacement.id);
      if (replacementIndex >= 0) return replacementIndex;
    }
    // Prefer an exact surviving occurrence before the semantic fallback. With
    // equal repeated prompts, scanning with the fallback first resolves every
    // later local occurrence to the first canonical row even when its own
    // exact local row is still present farther down the result.
    const exactIndex = result.findIndex((candidate) => samePublicationIdentity(candidate, anchor));
    if (exactIndex >= 0) return exactIndex;
    const publishedIndex = result.findIndex((candidate) => samePublicationAnchor(candidate, anchor));
    if (publishedIndex >= 0) return publishedIndex;
  }
  return -1;
}

function samePublicationIdentity(left: WorkspaceMessage, right: WorkspaceMessage) {
  if (left.id === right.id) return true;
  return Boolean(left.role === right.role
    && left.idempotencyKey && right.idempotencyKey
    && sameSubmissionIdentity(left.idempotencyKey, right.idempotencyKey));
}

function samePublicationAnchor(left: WorkspaceMessage, right: WorkspaceMessage) {
  if (samePublicationIdentity(left, right)) return true;
  // Older and cross-device history can omit the submission key. The latest
  // page still consumes matching optimistic prompts in publication order, so
  // an unmatched repeated prompt must be allowed to anchor to the canonical
  // replacement of the preceding occurrence. Restrict the semantic fallback
  // to a history/local pair: equal live narration or tool prose is not an
  // identity and must never become a chronology anchor by text alone.
  return left.source === 'history' && right.source === 'local' && sameMeaning(left, right);
}

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}
