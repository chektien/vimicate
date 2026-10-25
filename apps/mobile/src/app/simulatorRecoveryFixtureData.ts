import { projectGatewayEvent, upsertLiveMessage } from '../gateway/gatewayEventProjection';
import { generationReboundPublication } from '../gateway/sessionGenerationPublication';
import { type WorkspaceMessage, type WorkspaceProject } from '../workspace/workspaceTypes';
import { messagesFromPayload } from '../workspace/historyMessageProjection';

export const SIMULATOR_RECOVERY_FIXTURE_MODE = 'qa-recovery-v1';
export const GLM_FIRST_PREAMBLE = 'RECOVERY GLM draft preamble';
export const GLM_FINAL_PREAMBLE = 'RECOVERY GLM revised preamble';
export const GLM_STEER_PROMPT = 'RECOVERY GLM mid-run steer';
export const PAGINATION_LATEST = 'RECOVERY latest page remains visible';
export const PAGINATION_PROBE = 'RECOVERY PROBE public cursor 80 · optional context unavailable';
export const RETIREMENT_PROBE = 'RECOVERY PROBE retired responses remained inert';
export const SELECTION_STALE_FINAL = 'RECOVERY STALE selection final MUST NOT PUBLISH';
export const SCENE_STALE_FINAL = 'RECOVERY STALE scene final MUST NOT PUBLISH';
export const recoverySelectionSession = 'fixture:recovery:selection';
export const recoverySceneSession = 'fixture:recovery:scene';
export const recoverySelectionMessageID = 'recovery-selection-message';
export const recoverySceneMessageID = 'recovery-scene-message';
export const recoveryBacklogSession = 'fixture:recovery:backlog';

export const simulatorRecoveryProject: WorkspaceProject = {
  id: recoveryBacklogSession, sessionKey: recoveryBacklogSession, name: 'recovery owner probe',
  path: '~/simulator-recovery', branch: 'qa', starred: true, threadCount: 0, state: 'idle',
};

function glmRows(settled: boolean) {
  const sessionKey = 'fixture:recovery:glm';
  const runId = 'glm-itemless-run';
  const frame = (seq: number, progressText: string) => projectGatewayEvent({
    event: 'agent', payload: { sessionKey, runId, seq, ts: 1_789_800_000_000 + seq,
      stream: 'item', data: { kind: 'preamble', progressText } },
  }, sessionKey)?.message;
  const first = frame(41, GLM_FIRST_PREAMBLE);
  if (!first) throw new Error('GLM fixture frame did not project');
  const steer: WorkspaceMessage = {
    id: 'glm-mid-run-steer', role: 'user', text: GLM_STEER_PROMPT, source: 'local',
    state: 'complete', sessionKey, runId, timestamp: '1789800000042',
  };
  let rows = upsertLiveMessage([], first);
  rows = upsertLiveMessage(rows, steer);
  if (settled) {
    const revised = frame(43, GLM_FINAL_PREAMBLE);
    if (!revised) throw new Error('GLM revised frame did not project');
    rows = upsertLiveMessage(rows, revised);
  }
  return rows;
}

function generationRows() {
  const sessionKey = 'fixture:recovery:generation';
  const start = 1_789_800_100_000;
  const visible: WorkspaceMessage[] = [
    { id: 'generation-review-prompt', role: 'user', text: 'RECOVERY archived review prompt remains mounted', source: 'history', sessionKey, timestamp: String(start - 200) },
    { id: 'generation-review-answer', role: 'assistant', text: 'RECOVERY archived review answer remains mounted', source: 'history', sessionKey, timestamp: String(start - 100) },
  ];
  const latest: WorkspaceMessage[] = [
    { id: 'generation-stale-live', role: 'assistant', text: 'RECOVERY stale prior generation MUST NOT PUBLISH', source: 'live', sessionKey, timestamp: String(start - 1) },
    { id: 'generation-new-prompt', role: 'user', text: 'RECOVERY replacement generation prompt', source: 'local', sessionKey, timestamp: String(start + 1) },
  ];
  const publication = generationReboundPublication('older', visible, latest, { sessionId: 'replacement-generation', sessionStartedAtMs: start });
  return [...publication.visible, ...publication.latest];
}

function recoveryRows() {
  const omission = (sessionKey: string, id: string, text: string) => messagesFromPayload({ sessionKey, messages: [{
    id, role: 'assistant', content: text,
    __openclaw: { id, truncated: true, reason: 'oversized', transcriptPosition: { source: 'sqlite', rawSeq: 1 } },
  }] });
  return [
    ...omission(recoverySelectionSession, recoverySelectionMessageID, '[chat.history omitted: selection retirement probe]'),
    ...omission(recoverySceneSession, recoverySceneMessageID, '[chat.history omitted: scene retirement probe]'),
  ];
}

export function simulatorRecoveryRows(glmSettled: boolean) {
  return [...glmRows(glmSettled), ...generationRows(), ...recoveryRows()];
}

export function paginationLatestPayload() {
  return { sessionKey: 'fixture:recovery:pagination', hasMore: true, nextOffset: 80, totalMessages: 300,
    messages: [{ id: 'recovery-pagination-latest', role: 'assistant', runId: 'pagination-run', content: PAGINATION_LATEST }] };
}

export function isSimulatorRecoveryFixtureMode(mode: string | undefined) {
  return mode === SIMULATOR_RECOVERY_FIXTURE_MODE;
}
