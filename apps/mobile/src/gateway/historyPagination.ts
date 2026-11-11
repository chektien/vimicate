import type { HistoryTransport } from './historyTransport';
import { liveNarrationInsertionIndex } from './liveNarrationPlacement';
import { type WorkspaceMessage } from '../workspace/workspaceTypes';
import { authoritativeHistoryChronology } from '../workspace/historyMessageProjection';
import { reconcileMessageToolProgress, retainingMessageToolProgress } from '../workspace/messageToolProgress';
import { sharedNarrationDisplayOrder } from '../workspace/historyDisplayOrder';
import { coalesceTranscriptIdentities, convergedTranscriptRepresentation, retainingAbsorbedLiveIdentity, transcriptPublicationIdentity } from './transcriptIdentityWall';
import { pruneUnownedRestoredLiveRows } from './transcriptChronology';
import { correlateLiveAssistantsToCanonicalTurns, embeddedTimestampMilliseconds, liveAssistantHistoryPlacement, richerLiveAssistant, sameRunAssistant } from './liveAssistantHistoryPlacement';
import { reconcileCompletePendingInputSnapshot, type PendingInputSnapshotReconciliation } from './pendingInputSnapshot';
import { provenClaudeNativeLive, reconcileClaudeNativeLive } from './claudeNativeLiveConvergence';
import { assistantTextIsGatewayIncomplete } from './messageCompleteness';
import { retainedHistoryRecords } from './retainedHistoryRecords';
import { insertAtPreviousPublicationPosition, livePublicationFollowsRunText, previousPublicationIndex, sameMeaning, sameSubmissionIdentity } from './publicationAnchors';

export type HistoryCursor = {
  sessionKey: string;
  nextOffset: number | null;
  hasMore: boolean;
  totalMessages: number;
  transport?: HistoryTransport | undefined;
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
    return retainingAbsorbedLiveIdentity(previous, retainingMessageToolProgress(previous, retainingRecoveredHistoryContent(previous, presented)));
  });
  const local = localCandidates.filter((message) => !localReconciliation.consumed.has(message));
  const structuredLiveCandidates = current.filter((message) => message.source === 'live' && message.sessionKey === sessionKey && message.role !== 'assistant');
  const liveAssistants = current.filter((message) => message.source === 'live' && message.sessionKey === sessionKey && message.role === 'assistant');
  const livePlacements = new Map<WorkspaceMessage, WorkspaceMessage>();
  const canonicalHistory = authoritativeHistoryChronology(
    [...retainedHistoryRecords(earlier, presentedLatest), ...presentedLatest].filter((message) => !richerLiveAssistant(message, liveAssistants, livePlacements)),
    (message) => message.source === 'history',
  );
  const savedToolResults = savedToolResultIndex(canonicalHistory);
  // Live agent events collapse one tool execution into one row, while Codex
  // history persists the same execution as separate call/result rows. Once
  // the durable result exists, retaining the live aggregate duplicates every
  // completed tool and turns one terminal refresh into a large overlapping
  // list mutation. Both projections expose the exact tool-call id; reconcile
  // only that explicit identity and keep unmatched/streaming live detail.
  const structuredLive = structuredLiveCandidates.filter((message) => !savedToolResults.settles(message));
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
  return reconcileClaudeNativeLive(sharedNarrationDisplayOrder(deduplicated(insertLiveDetailAtRunFinals(withLiveAssistants.map(row => livePlacements.get(row) ?? row), structuredLive, current, localReconciliation.replacements))), claudeMatches);
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
  // A mirror's resolved role is part of its publication identity. Normalize
  // overlapping pages before coalescing, not only during later chronology.
  return coalesceTranscriptIdentities(reconcileMessageToolProgress(messages));
}

/**
 * The saved results that settle a live tool row. Codex history names the call
 * in its record key. Other history names it on the result part, and a call id
 * alone is not ownership there: the saved row must name the same run, or be a
 * Claude CLI native record, whose call ids are unique to one call. Rows of
 * different known generations never settle each other.
 */
function savedToolResultIndex(history: WorkspaceMessage[]) {
  const keyed = new Set<string>();
  const named = new Map<string, WorkspaceMessage[]>();
  for (const row of history) {
    if (row.role !== 'tool') continue;
    const key = row.idempotencyKey?.match(/:tool:(.+):result$/i)?.[1];
    if (key) keyed.add(key);
    if (row.tool?.resultOf) named.set(row.tool.resultOf, [...(named.get(row.tool.resultOf) ?? []), row]);
  }
  return { settles(live: WorkspaceMessage) {
    if (live.role !== 'tool' || live.source !== 'live' || !live.runId) return false;
    const prefix = `live-tool-${live.runId}-`;
    const call = live.id.startsWith(prefix) ? live.id.slice(prefix.length) : '';
    if (!call) return false;
    return keyed.has(call) || (named.get(call) ?? []).some(saved =>
      (saved.runId ? saved.runId === live.runId : saved.cliProvenance?.kind === 'claude-native')
      && !(saved.transcriptSessionId && live.transcriptSessionId && saved.transcriptSessionId !== live.transcriptSessionId));
  } };
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
      if (message.stagedImagePlaceholder) refreshed.stagedImagePlaceholder = true;
      else delete refreshed.stagedImagePlaceholder;
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

// The insertion passes below receive rows filtered from `previous`, the
// mounted publication this merge started from. Every row therefore has a
// previous index.
function insertLocalPromptsAtPublishedPositions(canonical: WorkspaceMessage[], local: WorkspaceMessage[], previous: WorkspaceMessage[], replacements: ReadonlyMap<WorkspaceMessage, WorkspaceMessage>) {
  const result = [...canonical];
  for (const prompt of local) {
    const previousIndex = previous.indexOf(prompt);
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
    } else insertAtPreviousPublicationPosition(result, message, previous, previousIndex, replacements);
  }
  return result;
}

function insertLiveDetailAtRunFinals(canonical: WorkspaceMessage[], detail: WorkspaceMessage[], previous: WorkspaceMessage[], replacements: ReadonlyMap<WorkspaceMessage, WorkspaceMessage>) {
  const result = [...canonical];
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
    if (!terminalCompletion && sharedRunPromptCount > 1) {
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
      if (runPromptIndex >= 0 && (previousIndex < previousPublicationIndex(previous, result[runPromptIndex]!, replacements)
        || previous[previousIndex - 1]?.runId === message.runId && previous[previousIndex - 1]?.source === 'live' && livePublicationFollowsRunText(previous, previousIndex, message.runId))) {
        // The run's only identified prompt was steered into it after this row
        // was already visible: the prompt that started the run can reach
        // history without a run identity. Anchoring below the steered prompt
        // would lift it above everything published before it. A row published
        // right after its run's live text likewise stays below that text.
        insertAtPreviousPublicationPosition(result, message, previous, previousIndex, replacements);
        continue;
      }
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
      // A local prompt may already have become a canonical history prompt.
      // Anchor against the nearest preceding row that has a published
      // counterpart, not merely the nearest row that was already history.
      insertAtPreviousPublicationPosition(result, message, previous, previousIndex, replacements);
      continue;
    }
    // Ordinary detail sits directly above the run's final. Completions stack
    // below it in arrival order.
    if (!terminalCompletion) { result.splice(runFinalIndex, 0, message); continue; }
    const count = afterCounts.get(message.runId!) ?? 0;
    result.splice(runFinalIndex + 1 + count, 0, message);
    afterCounts.set(message.runId!, count + 1);
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

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
