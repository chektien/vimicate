import { projectGatewayEvent, upsertLiveMessage } from '../gateway/gatewayEventProjection';
import { mergeLatestHistory } from '../gateway/historyPagination';
import { parsedTranscriptCache, serializedTranscriptCache } from '../gateway/persistentTranscriptCache';
import { type WorkspaceMessage } from '../workspace/workspaceTypes';
import { messagesFromPayload } from '../workspace/historyMessageProjection';

export const GLM_REPLAY_A = 'SIMULATOR GLM owned announcement A';
export const GLM_REPLAY_B = 'SIMULATOR GLM owned announcement B';
export const GLM_REPLAY_FINAL = 'SIMULATOR GLM exact terminal answer';
export const GLM_REPLAY_REPEAT = 'SIMULATOR GLM intentionally repeated announcement';
export const GLM_REPLAY_SESSION = 'fixture:simulator:glm-preamble';
const generation = '00000000-0000-4000-8000-000000000130';
const run = 'simulator-glm-two-wait-run';
const repeatedRun = 'simulator-glm-repeated-run';
const start = 1_790_434_867_196;

function project(event: string, payload: Record<string, unknown>) {
  const projected = projectGatewayEvent({ event, payload: { sessionKey: GLM_REPLAY_SESSION, ...payload } }, GLM_REPLAY_SESSION);
  if (!projected) throw new Error('Sanitized GLM fixture frame was not projected');
  return projected.message;
}

function chat(runId: string, text: string, state: 'delta' | 'final' = 'delta') {
  return project('chat', { runId, state, message: { role: 'assistant', content: [{ type: 'text', text }] } });
}

function item(runId: string, itemId: string, text: string, timestamp: number) {
  return project('agent', { runId, stream: 'item', ts: timestamp,
    data: { kind: 'preamble', itemId, phase: 'end', progressText: text } });
}

function terminal(runId: string, text: string) {
  return project('agent', { runId, sessionId: generation, stream: 'lifecycle',
    data: { phase: 'end', terminalReply: { disposition: 'visible', text } } });
}

function user(id: string, runId: string, text: string): WorkspaceMessage {
  return { id, role: 'user', text, runId, sessionKey: GLM_REPLAY_SESSION, source: 'history' };
}

/** Sanitized event-shape replay, not a live provider or network fixture. */
export function simulatorGlmLiveRows() {
  let rows: WorkspaceMessage[] = [user('glm-prompt', run, 'SIMULATOR GLM bounded run')];
  rows = upsertLiveMessage(rows, chat(run, GLM_REPLAY_A));
  rows = upsertLiveMessage(rows, item(run, 'commentary-a', GLM_REPLAY_A, start + 1_300));
  rows = upsertLiveMessage(rows, project('agent', { runId: run, stream: 'tool',
    data: { phase: 'result', name: 'exec', toolCallId: 'wait-one', result: '(no output)' } }));
  rows.push(user('glm-steer', run, 'SIMULATOR GLM accepted steer'));
  rows = upsertLiveMessage(rows, chat(run, `${GLM_REPLAY_A}\n\n${GLM_REPLAY_B}`));
  rows = upsertLiveMessage(rows, item(run, 'commentary-b', GLM_REPLAY_B, start + 33_000));

  rows.push(user('glm-repeat-prompt', repeatedRun, 'SIMULATOR GLM repeated-text control'));
  rows = upsertLiveMessage(rows, chat(repeatedRun, GLM_REPLAY_REPEAT));
  rows = upsertLiveMessage(rows, item(repeatedRun, 'repeat-one', GLM_REPLAY_REPEAT, start + 70_000));
  rows = upsertLiveMessage(rows, chat(repeatedRun, `${GLM_REPLAY_REPEAT}\n\n${GLM_REPLAY_REPEAT}`));
  rows = upsertLiveMessage(rows, item(repeatedRun, 'repeat-two', GLM_REPLAY_REPEAT, start + 71_000));
  rows = upsertLiveMessage(rows, terminal(repeatedRun, GLM_REPLAY_REPEAT));
  rows = upsertLiveMessage(rows, chat(repeatedRun,
    `${GLM_REPLAY_REPEAT}\n\n${GLM_REPLAY_REPEAT}\n\n${GLM_REPLAY_REPEAT}`, 'final'));
  return rows;
}

function canonicalRows() {
  const native = (id: string, runId: string, rawSeq: number) => ({ id, runId,
    transcriptPosition: { source: 'simulator-glm-segment', rawSeq } });
  const segment = (id: string, runId: string, rawSeq: number, itemId: string, text: string, timestamp: number) => ({
    role: 'assistant', content: text, timestamp,
    openclawStreamFallback: { source: 'segment', itemId, replacementText: text },
    __openclaw: native(id, runId, rawSeq),
  });
  return messagesFromPayload({ sessionKey: GLM_REPLAY_SESSION, sessionId: generation, messages: [
    { role: 'user', content: 'SIMULATOR GLM bounded run', timestamp: start,
      __openclaw: native('glm-prompt', run, 116) },
    segment('glm-a', run, 117, 'commentary-a', GLM_REPLAY_A, start + 2_100),
    segment('glm-b', run, 120, 'commentary-b', GLM_REPLAY_B, start + 34_000),
    { role: 'assistant', content: GLM_REPLAY_FINAL, timestamp: start + 67_000,
      __openclaw: native('glm-final', run, 123) },
    // This captured producer shape still records the accepted steer after the
    // final despite an earlier accepted timestamp. The replay tests identity,
    // not the separately open steering chronology contract.
    { role: 'user', content: 'SIMULATOR GLM accepted steer', timestamp: start + 23_000,
      idempotencyKey: 'simulator-glm-steer:user', __openclaw: native('glm-steer', run, 124) },
    { role: 'user', content: 'SIMULATOR GLM repeated-text control', timestamp: start + 69_000,
      __openclaw: native('glm-repeat-prompt', repeatedRun, 125) },
    segment('repeat-one', repeatedRun, 126, 'repeat-one', GLM_REPLAY_REPEAT, start + 70_000),
    segment('repeat-two', repeatedRun, 127, 'repeat-two', GLM_REPLAY_REPEAT, start + 71_000),
    { role: 'assistant', content: GLM_REPLAY_REPEAT, timestamp: start + 72_000,
      __openclaw: native('glm-repeat-final', repeatedRun, 128) },
  ] });
}

export function publishSimulatorGlmCanonical(current: WorkspaceMessage[]) {
  let rows = upsertLiveMessage(current, terminal(run, GLM_REPLAY_FINAL));
  rows = upsertLiveMessage(rows, chat(run, `${GLM_REPLAY_A}\n\n${GLM_REPLAY_B}\n\n${GLM_REPLAY_FINAL}`, 'final'));
  return mergeLatestHistory(canonicalRows(), rows, GLM_REPLAY_SESSION);
}

export function repeatSimulatorGlmCanonical(current: WorkspaceMessage[]) {
  return mergeLatestHistory(canonicalRows(), current, GLM_REPLAY_SESSION);
}

export function restoreSimulatorGlmCache(current: WorkspaceMessage[]) {
  return repeatSimulatorGlmCanonical(parsedTranscriptCache(serializedTranscriptCache(current)));
}
