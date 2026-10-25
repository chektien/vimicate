import { type WorkspaceMessage, type WorkspaceProject } from '../workspace/workspaceTypes';
import { messagesFromPayload } from '../workspace/historyMessageProjection';
import { upsertLiveMessage } from '../gateway/gatewayEventProjection';
import { latestHistoryWindow, latestPresentationWindow } from '../gateway/historyWindow';
import { mergeLatestHistory } from '../gateway/historyPagination';
import { runLifecycleMessageID } from '../gateway/runCompletionMessage';
import { reconcileFailedRunWait } from '../gateway/runWaitSettlement';
import { bindOptimisticPromptToRun } from '../gateway/submissionRunBinding';
import { parsedTranscriptCache, serializedTranscriptCache } from '../gateway/persistentTranscriptCache';
import { simulatorClaudePromptIdentityRows } from './simulatorClaudePromptIdentityFixture';
import {
  bindSimulatorDynamicMediaReceipt,
  canonicalSimulatorDynamicMediaRows,
  MEDIA_DYNAMIC_SESSION_KEY,
  simulatorDynamicMediaPromptRows,
} from './simulatorDynamicMediaPromptFixture';

export const SIMULATOR_DYNAMIC_FIXTURE_MODE = 'qa-dynamic-v1';
export const CODEX_DYNAMIC_PROMPT = 'SIMULATOR CODEX pending custody prompt';
export const CODEX_DYNAMIC_COMMENTARY_ONE = 'SIMULATOR CODEX commentary after accepted input one.';
export const CODEX_DYNAMIC_COMMENTARY_TWO = 'SIMULATOR CODEX commentary after accepted input two.';
export const CLAUDE_DYNAMIC_PROMPT = 'SIMULATOR CLAUDE native alias prompt';
export const CLAUDE_DYNAMIC_FIRST = 'SIMULATOR CLAUDE first native answer.';
export const CLAUDE_DYNAMIC_FINAL = 'SIMULATOR CLAUDE final native answer.';
export const OVERSIZED_DYNAMIC_PLACEHOLDER = '[chat.history omitted: message too large]';
export const OVERSIZED_DYNAMIC_FINAL = 'SIMULATOR RECOVERED SHORT FINAL.';
export const DYNAMIC_AUTHORITY_MARKER = 'SIMULATOR DYNAMIC canonical authority published';
export const DYNAMIC_RECEIPT_MARKER = 'SIMULATOR DYNAMIC input receipts acknowledged';
export const DYNAMIC_REPEAT_REFRESH_MARKER = 'SIMULATOR DYNAMIC canonical refresh repeated';
export const DYNAMIC_CACHE_RESTORE_MARKER = 'SIMULATOR DYNAMIC canonical cache restored';
export const CANONICAL_FIRST_FINAL = 'SIMULATOR canonical-first final remains singular.';
export const LATE_REPLAY_FINAL = 'SIMULATOR late replay stays in its older turn.';
export const PENDING_FINAL_TEXT = 'SIMULATOR final answer pending';
export const SETTLED_FINAL_TEXT = 'SIMULATOR pending final settled canonically.';
export const AMBIGUOUS_PROMPT = 'SIMULATOR ambiguous equal pending prompt';
export const REPEATED_PROMPT = 'SIMULATOR intentional repeated prompt';
export const CROSS_SCOPE_PROMPT = 'SIMULATOR cross-scope equal prompt';
export const oversizedSessionKey = 'fixture:simulator:oversized';
export const oversizedMessageID = 'simulator-oversized-message';

const codexSessionKey = 'fixture:simulator:codex';
const codexSessionID = '00000000-0000-4000-8000-000000000106';
const codexAcceptedAt = 1789839783745;
const codexActiveRunID = 'simulator-codex-active-lifecycle-run';
const codexInputs = [
  { suffix: 'one', acceptedAt: codexAcceptedAt, recordTimestampMs: 1789839813468, rawSeq: 23567,
    executionRunID: '00000000-0000-4000-a000-000000000102', submissionID: '00000000-0000-4000-a000-000000000138' },
  { suffix: 'two', acceptedAt: 1789839812836, recordTimestampMs: 1789839858174, rawSeq: 23574,
    executionRunID: '00000000-0000-4000-a000-000000000147', submissionID: '00000000-0000-4000-8000-000000000139' },
] as const;
const claudeSessionKey = 'fixture:simulator:claude';
const claudeSessionID = '00000000-0000-4000-8000-000000000130';
const claudeNativeSessionID = '00000000-0000-4000-8000-000000000114';
const claudeRunID = 'simulator-claude-run';

export const simulatorQuotaProject: WorkspaceProject = {
  id: 'fixture:simulator:quota', sessionKey: 'fixture:simulator:quota', name: 'simulator quota',
  path: '~/simulator-fixture', branch: 'qa', starred: true, threadCount: 0, state: 'idle',
  modelProvider: 'openai', agentRuntime: 'codex',
};

function codexRows(canonicalPublished: boolean, receiptsAcknowledged: boolean) {
  const canonical = codexInputs.map(input => ({
    role: 'user', content: CODEX_DYNAMIC_PROMPT, timestamp: input.acceptedAt,
    idempotencyKey: `${input.submissionID}:user`,
    __openclaw: {
      id: `simulator-codex-canonical-${input.suffix}`, runId: input.executionRunID,
      mirrorOrigin: 'codex-app-server', mirrorIdentity: `simulator-turn-${input.suffix}:prompt`,
      recordTimestampMs: input.recordTimestampMs,
      transcriptPosition: { source: 'sqlite', rawSeq: input.rawSeq },
    },
  }));
  const pending = codexInputs.map(input => ({
    id: `simulator-codex-pending-${input.suffix}`, runId: input.submissionID,
    state: 'queued', acceptedAt: input.acceptedAt,
    message: { role: 'user', content: CODEX_DYNAMIC_PROMPT, __openclaw: { id: `pending:simulator-codex-pending-${input.suffix}` } },
  }));
  const commentary = codexInputs.map((input, index) => ({
    role: 'assistant', content: index === 0 ? CODEX_DYNAMIC_COMMENTARY_ONE : CODEX_DYNAMIC_COMMENTARY_TWO,
    timestamp: input.acceptedAt + 500,
    __openclaw: { id: `simulator-codex-commentary-${input.suffix}`, runId: codexActiveRunID,
      transcriptPosition: { source: 'sqlite', rawSeq: input.rawSeq + 1 } },
  }));
  const latest = messagesFromPayload({
    sessionKey: codexSessionKey, sessionId: codexSessionID,
    messages: [...commentary, ...(canonicalPublished ? canonical : [])],
    // Model a queue snapshot taken while the first accepted input has already
    // left custody and the second remains visible beside canonical history.
    pendingInputs: { items: canonicalPublished ? pending.slice(1) : pending },
  });
  let local: WorkspaceMessage[] = codexInputs.map(input => ({
    id: `local-${input.submissionID}`, role: 'user', text: CODEX_DYNAMIC_PROMPT,
    source: 'local', sessionKey: codexSessionKey, runId: codexActiveRunID,
    idempotencyKey: input.submissionID, timestamp: String(input.acceptedAt - 750),
  }));
  if (receiptsAcknowledged) {
    local = local.map((row, index) => bindOptimisticPromptToRun(
      [row], row.id, codexActiveRunID, codexInputs[index]!.submissionID,
    )[0]!);
  }
  return mergeLatestHistory(latest, local, codexSessionKey);
}

function claudeRows(aggregatePublished: boolean) {
  const imported = [
    {
      role: 'user', content: CLAUDE_DYNAMIC_PROMPT, timestamp: 1767225602055,
      __openclaw: { id: 'simulator-claude-native-user', importedFrom: 'claude-cli', cliSessionId: claudeNativeSessionID, externalId: 'simulator-claude-native-user' },
    },
    {
      role: 'assistant', content: CLAUDE_DYNAMIC_FIRST, timestamp: 1767225606360,
      __openclaw: { id: 'simulator-claude-first', importedFrom: 'claude-cli', cliSessionId: claudeNativeSessionID, externalId: 'simulator-claude-first' },
    },
    {
      role: 'assistant', content: [{ type: 'toolCall', id: 'simulator-tool-call', name: 'Read', arguments: { file_path: '/fixture/README.md' } },
        { type: 'toolResult', tool_use_id: 'simulator-tool-call', name: 'Read', content: 'SIMULATOR CLAUDE tool result' }], timestamp: 1767225607133,
      __openclaw: { id: 'simulator-claude-tool', importedFrom: 'claude-cli', cliSessionId: claudeNativeSessionID, externalId: 'simulator-claude-tool' },
    },
    {
      role: 'assistant', content: CLAUDE_DYNAMIC_FINAL, timestamp: 1767225608426,
      __openclaw: { id: 'simulator-claude-final', importedFrom: 'claude-cli', cliSessionId: claudeNativeSessionID, externalId: 'simulator-claude-final' },
    },
  ];
  const canonical: Record<string, unknown>[] = [{
    role: 'user', content: CLAUDE_DYNAMIC_PROMPT, timestamp: 1767225602054,
    idempotencyKey: `${claudeRunID}:user`,
    __openclaw: { id: 'simulator-claude-canonical-user', idempotencyKey: `${claudeRunID}:user`, transcriptPosition: { source: 'sqlite', rawSeq: 93 } },
  }];
  if (aggregatePublished) canonical.push({
    role: 'assistant', content: `${CLAUDE_DYNAMIC_FIRST}\n\n${CLAUDE_DYNAMIC_FINAL}`,
    timestamp: 1767225608698, idempotencyKey: `cli-assistant:${claudeRunID}`,
    api: 'cli', provider: 'claude-cli', stopReason: 'stop',
    __openclaw: { id: 'simulator-claude-aggregate', idempotencyKey: `cli-assistant:${claudeRunID}`, transcriptPosition: { source: 'sqlite', rawSeq: 94 } },
  });
  const parsedImported = messagesFromPayload({ sessionKey: claudeSessionKey, sessionId: claudeSessionID, messages: imported });
  const parsedCanonical = messagesFromPayload({ sessionKey: claudeSessionKey, sessionId: claudeSessionID, messages: canonical });
  return [...parsedImported, ...parsedCanonical];
}

function oversizedRows() {
  return messagesFromPayload({ sessionKey: oversizedSessionKey, sessionId: '00000000-0000-4000-9000-000000000120', messages: [{
    role: 'assistant', content: OVERSIZED_DYNAMIC_PLACEHOLDER, timestamp: 1789815460000,
    __openclaw: { id: oversizedMessageID, runId: 'simulator-oversized-run', truncated: true, reason: 'oversized', transcriptPosition: { source: 'sqlite', rawSeq: 1 } },
  }] });
}

function authorityMarker(): WorkspaceMessage {
  return { id: 'simulator-dynamic-authority-marker', role: 'vimicate', text: DYNAMIC_AUTHORITY_MARKER, source: 'history', state: 'complete' };
}

function receiptMarker(): WorkspaceMessage {
  return { id: 'simulator-dynamic-receipt-marker', role: 'vimicate', text: DYNAMIC_RECEIPT_MARKER, source: 'history', state: 'complete' };
}

function repeatRefreshMarker(): WorkspaceMessage {
  return { id: 'simulator-dynamic-repeat-refresh-marker', role: 'vimicate', text: DYNAMIC_REPEAT_REFRESH_MARKER, source: 'history', state: 'complete' };
}

function cacheRestoreMarker(): WorkspaceMessage {
  return { id: 'simulator-dynamic-cache-restore-marker', role: 'vimicate', text: DYNAMIC_CACHE_RESTORE_MARKER, source: 'history', state: 'complete' };
}

function lifecycleRows(settled: boolean) {
  const canonicalFirstSession = 'fixture:simulator:canonical-first';
  const canonicalRun = 'simulator-canonical-run';
  const canonicalPrompt: WorkspaceMessage = { id: 'canonical-first-prompt', role: 'user', text: 'SIMULATOR canonical-first prompt', source: 'history', sessionKey: canonicalFirstSession, runId: canonicalRun, idempotencyKey: `${canonicalRun}:user`, timestamp: '1789815400000' };
  const canonicalFinal: WorkspaceMessage = { id: 'canonical-first-final', role: 'assistant', text: CANONICAL_FIRST_FINAL, source: 'history', state: 'complete', sessionKey: canonicalFirstSession, timestamp: '1789815401000' };
  const liveFinal: WorkspaceMessage = { id: `live-chat-${canonicalRun}`, role: 'assistant', text: CANONICAL_FIRST_FINAL, source: 'live', state: 'complete', sessionKey: canonicalFirstSession, runId: canonicalRun, timestamp: '1789815401100' };
  const canonicalFirst = settled ? upsertLiveMessage([canonicalPrompt, canonicalFinal], liveFinal) : [canonicalPrompt, canonicalFinal];

  const lateSession = 'fixture:simulator:late-replay';
  const oldRun = 'simulator-old-run';
  const oldPrompt: WorkspaceMessage = { id: 'late-old-prompt', role: 'user', text: 'SIMULATOR older prompt', source: 'history', sessionKey: lateSession, runId: oldRun, idempotencyKey: `${oldRun}:user`, timestamp: '1789815410000' };
  const oldFinal: WorkspaceMessage = { id: 'late-old-final', role: 'assistant', text: LATE_REPLAY_FINAL, source: 'history', state: 'complete', sessionKey: lateSession, timestamp: '1789815411000' };
  const newerPrompt: WorkspaceMessage = { id: 'late-newer-prompt', role: 'user', text: 'SIMULATOR newer prompt after late replay', source: 'history', sessionKey: lateSession, idempotencyKey: 'simulator-newer:user', timestamp: '1789815412000' };
  const newerFinal: WorkspaceMessage = { id: 'late-newer-final', role: 'assistant', text: 'SIMULATOR newer final stays last.', source: 'history', state: 'complete', sessionKey: lateSession, timestamp: '1789815413000' };
  const replay: WorkspaceMessage = { id: `live-chat-${oldRun}`, role: 'assistant', text: LATE_REPLAY_FINAL, source: 'live', state: 'complete', sessionKey: lateSession, runId: oldRun, timestamp: '1789815413100' };
  const lateReplay = settled ? upsertLiveMessage([oldPrompt, oldFinal, newerPrompt, newerFinal], replay) : [oldPrompt, oldFinal, newerPrompt, newerFinal];

  const pendingSession = 'fixture:simulator:pending-final';
  const pendingRun = 'simulator-pending-run';
  const localPrompt: WorkspaceMessage = { id: 'pending-local-prompt', role: 'user', text: 'SIMULATOR settle my final', source: 'local', sessionKey: pendingSession, runId: pendingRun, idempotencyKey: 'simulator-pending', timestamp: '1789815420000' };
  const pending: WorkspaceMessage = { id: runLifecycleMessageID(pendingSession, pendingRun), role: 'run', text: PENDING_FINAL_TEXT, source: 'live', state: 'streaming', sessionKey: pendingSession, runId: pendingRun };
  const historyPrompt: WorkspaceMessage = { ...localPrompt, id: 'pending-history-prompt', source: 'history', idempotencyKey: 'simulator-pending:user' };
  const historyFinal: WorkspaceMessage = { id: 'pending-history-final', role: 'assistant', text: SETTLED_FINAL_TEXT, source: 'history', state: 'complete', sessionKey: pendingSession, timestamp: '1789815421000' };
  const pendingFinal = settled ? latestHistoryWindow([historyPrompt, historyFinal], [localPrompt, pending], pendingSession) : [localPrompt, pending];

  const failedSession = 'fixture:simulator:failed-run';
  const failedRun = 'simulator-failed-run';
  const activeFailure: WorkspaceMessage[] = [
    { id: 'failed-run-prompt', role: 'user', text: 'SIMULATOR guarded failure prompt', source: 'local', state: 'complete', sessionKey: failedSession, runId: failedRun },
    { id: 'failed-run-tool', role: 'tool', text: 'SIMULATOR guarded verification running', source: 'live', state: 'streaming', sessionKey: failedSession, runId: failedRun, tool: { name: 'verify', summary: 'verify · simulator' } },
    { id: runLifecycleMessageID(failedSession, failedRun), role: 'run', text: 'start', source: 'live', state: 'streaming', sessionKey: failedSession, runId: failedRun },
  ];
  const failed = settled ? reconcileFailedRunWait(activeFailure, failedSession, failedRun, { runId: failedRun, status: 'failed', error: 'SIMULATOR authoritative failure', startedAt: 1, endedAt: 2 }, 1) : activeFailure;
  return [...canonicalFirst, ...lateReplay, ...pendingFinal, ...failed];
}

function ambiguityControlRows() {
  const acceptedAt = 1789815490000;
  const runId = 'simulator-ambiguous-run';
  const sessionKey = 'fixture:simulator:ambiguous';
  const canonical = { role: 'user', content: AMBIGUOUS_PROMPT, timestamp: acceptedAt, idempotencyKey: 'simulator-ambiguous:user', __openclaw: { id: 'ambiguous-canonical', runId, mirrorOrigin: 'codex-app-server', mirrorIdentity: 'ambiguous:prompt', recordTimestampMs: acceptedAt + 1, transcriptPosition: { source: 'sqlite', rawSeq: 5 } } };
  const pending = (id: string) => ({ id, runId, state: 'queued', acceptedAt, message: { role: 'user', content: AMBIGUOUS_PROMPT, __openclaw: { id: `pending:${id}` } } });
  const ambiguous = messagesFromPayload({ sessionKey, sessionId: codexSessionID, messages: [canonical], pendingInputs: { items: [pending('ambiguous-one'), pending('ambiguous-two')] } });
  const repeated: WorkspaceMessage[] = [1, 2].map(index => ({ id: `intentional-repeat-${index}`, role: 'user', text: REPEATED_PROMPT, source: 'history', sessionKey: 'fixture:simulator:repeated', idempotencyKey: `intentional-${index}:user`, timestamp: String(acceptedAt + index) }));
  const crossScope: WorkspaceMessage[] = [
    { id: 'cross-scope-one', role: 'user', text: CROSS_SCOPE_PROMPT, source: 'history', sessionKey: 'fixture:simulator:scope-one', transcriptSessionId: codexSessionID },
    { id: 'cross-scope-two', role: 'user', text: CROSS_SCOPE_PROMPT, source: 'history', sessionKey: 'fixture:simulator:scope-two', transcriptSessionId: claudeSessionID },
  ];
  return [...ambiguous, ...repeated, ...crossScope];
}

export function simulatorDynamicRows(authorityPublished: boolean) {
  return simulatorDynamicRowsForReceiptPhase(authorityPublished, true);
}

export function simulatorDynamicRowsForReceiptPhase(authorityPublished: boolean, receiptsAcknowledged: boolean) {
  return [...codexRows(authorityPublished, receiptsAcknowledged),
    ...simulatorDynamicMediaPromptRows(authorityPublished, undefined, receiptsAcknowledged),
    ...simulatorClaudePromptIdentityRows(), ...claudeRows(authorityPublished), ...oversizedRows(), ...lifecycleRows(authorityPublished), ...ambiguityControlRows(),
    ...(receiptsAcknowledged ? [receiptMarker()] : []),
    ...(authorityPublished ? [authorityMarker()] : [])];
}

/** Apply the real chat.send receipts to the currently mounted optimistic rows. */
export function acknowledgeSimulatorDynamicReceipts(current: WorkspaceMessage[]) {
  let acknowledged = current;
  for (const input of codexInputs) {
    acknowledged = bindOptimisticPromptToRun(
      acknowledged, `local-${input.submissionID}`, codexActiveRunID, input.submissionID,
    );
  }
  acknowledged = bindSimulatorDynamicMediaReceipt(acknowledged);
  return latestPresentationWindow([
    ...acknowledged.filter(row => row.id !== 'simulator-dynamic-receipt-marker'),
    receiptMarker(),
  ]);
}

/** Publish canonical receipt sessions from the acknowledged mounted rows. */
export function publishSimulatorDynamicCanonicalRows(current: WorkspaceMessage[]) {
  const codexCanonical = latestHistoryWindow(
    codexRows(true, true).filter(row => row.source === 'history'),
    current.filter(row => row.sessionKey === codexSessionKey),
    codexSessionKey,
  );
  const mediaCanonical = canonicalSimulatorDynamicMediaRows(current);
  const target = simulatorDynamicRows(true).filter(row =>
    row.sessionKey !== codexSessionKey && row.sessionKey !== MEDIA_DYNAMIC_SESSION_KEY,
  );
  return latestPresentationWindow([...codexCanonical, ...mediaCanonical, ...target]);
}

/** Reapply the same partial newest-page snapshot without changing authority. */
export function repeatSimulatorDynamicCanonicalRefresh(current: WorkspaceMessage[]) {
  return latestPresentationWindow([
    ...publishSimulatorDynamicCanonicalRows(current),
    repeatRefreshMarker(),
  ]);
}

/** Rehydrate the bounded transcript cache, then let canonical history win again. */
export function restoreSimulatorDynamicCanonicalCache(current: WorkspaceMessage[]) {
  const restored = parsedTranscriptCache(serializedTranscriptCache(current));
  return latestPresentationWindow([
    ...publishSimulatorDynamicCanonicalRows(restored),
    cacheRestoreMarker(),
  ]);
}

export function isSimulatorDynamicFixtureMode(mode: string | undefined) {
  return mode === SIMULATOR_DYNAMIC_FIXTURE_MODE;
}
