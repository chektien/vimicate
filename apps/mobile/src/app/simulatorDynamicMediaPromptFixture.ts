import { latestHistoryWindow } from '../gateway/historyWindow';
import { mergeLatestHistory } from '../gateway/historyPagination';
import { bindOptimisticPromptToRun } from '../gateway/submissionRunBinding';
import { type WorkspaceMessage } from '../workspace/workspaceTypes';
import { messagesFromPayload } from '../workspace/historyMessageProjection';

export const MEDIA_DYNAMIC_PROMPT = 'SIMULATOR media custody prompt';
export const MEDIA_DYNAMIC_BEFORE = 'SIMULATOR media chronology before prompt.';
export const MEDIA_DYNAMIC_AFTER = 'SIMULATOR media chronology after tool activity.';
export const MEDIA_DYNAMIC_TOOL_RESULT = 'SIMULATOR media prompt tool result';

export const MEDIA_DYNAMIC_SESSION_KEY = 'fixture:simulator:media-prompt';
const MEDIA_SESSION_ID = '00000000-0000-4000-a000-000000000156';
const MEDIA_RUN_ID = 'simulator-media-prompt-run';
const MEDIA_EXECUTION_RUN_ID = '00000000-0000-4000-b000-000000000140';
const MEDIA_ACCEPTED_AT = 1789815470000;
const MEDIA_SUBMISSION_ID = 'simulator-media-submission';
export const MEDIA_DYNAMIC_PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
export const DISTINCT_MEDIA_PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8AARQAFAAH/q842AAAAAElFTkSuQmCC';
export const MEDIA_DYNAMIC_LOCAL_PIXEL = DISTINCT_MEDIA_PIXEL;

const mediaDescriptor = (url: string) => ({ kind: 'image', url, contentType: 'image/png', sizeBytes: 418_100 });

/** Exact pending-input/canonical wire pair used by the isolated dynamic QA app. */
export function simulatorDynamicMediaPromptRows(
  canonicalPublished: boolean,
  canonicalMedia = MEDIA_DYNAMIC_PIXEL,
  receiptAcknowledged = true,
  pendingReceiptRunID = MEDIA_SUBMISSION_ID,
) {
  const before = {
    role: 'assistant', content: MEDIA_DYNAMIC_BEFORE, timestamp: MEDIA_ACCEPTED_AT - 1_000,
    __openclaw: { id: 'simulator-media-before', transcriptPosition: { source: 'sqlite', rawSeq: 3100 } },
  };
  const tool = {
    role: 'assistant', timestamp: MEDIA_ACCEPTED_AT + 500,
    content: [
      { type: 'toolCall', id: 'simulator-media-tool-call', name: 'Read', arguments: { file_path: '/fixture/media-prompt.txt' } },
      { type: 'toolResult', tool_use_id: 'simulator-media-tool-call', name: 'Read', content: MEDIA_DYNAMIC_TOOL_RESULT },
    ],
    __openclaw: { id: 'simulator-media-tool', runId: MEDIA_RUN_ID, transcriptPosition: { source: 'sqlite', rawSeq: 3101 } },
  };
  const after = {
    role: 'assistant', content: MEDIA_DYNAMIC_AFTER, timestamp: MEDIA_ACCEPTED_AT + 1_000,
    __openclaw: { id: 'simulator-media-after', runId: MEDIA_RUN_ID, transcriptPosition: { source: 'sqlite', rawSeq: 3102 } },
  };
  const canonical = {
    role: 'user', content: MEDIA_DYNAMIC_PROMPT, timestamp: MEDIA_ACCEPTED_AT,
    idempotencyKey: `${MEDIA_SUBMISSION_ID}:user`,
    __openclaw: {
      id: 'simulator-media-canonical', runId: MEDIA_EXECUTION_RUN_ID,
      mirrorOrigin: 'codex-app-server', mirrorIdentity: 'simulator-media-turn:prompt',
      recordTimestampMs: MEDIA_ACCEPTED_AT + 100,
      transcriptPosition: { source: 'sqlite', rawSeq: 3103 },
      media: [mediaDescriptor(canonicalMedia)], mediaImageLayout: { slots: [{ kind: 'inline', factIndex: 0 }] },
    },
  };
  const pending = {
    id: 'simulator-media-pending', runId: pendingReceiptRunID, state: 'queued', acceptedAt: MEDIA_ACCEPTED_AT,
    message: {
      role: 'user', content: MEDIA_DYNAMIC_PROMPT,
      media: [mediaDescriptor(MEDIA_DYNAMIC_PIXEL)], __openclaw: { id: 'pending:simulator-media-pending' },
    },
  };
  const latest = messagesFromPayload({
    sessionKey: MEDIA_DYNAMIC_SESSION_KEY, sessionId: MEDIA_SESSION_ID,
    messages: [before, tool, after, ...(canonicalPublished ? [canonical] : [])],
    pendingInputs: { items: [pending] },
  });
  const pendingFilename = MEDIA_DYNAMIC_PIXEL.split('/').at(-1) ?? 'simulator-prompt.png';
  let local: WorkspaceMessage = {
    id: `local-${MEDIA_SUBMISSION_ID}`, role: 'user', text: MEDIA_DYNAMIC_PROMPT,
    source: 'local', sessionKey: MEDIA_DYNAMIC_SESSION_KEY, runId: MEDIA_RUN_ID,
    idempotencyKey: MEDIA_SUBMISSION_ID, timestamp: String(MEDIA_ACCEPTED_AT - 500),
    attachments: [{ id: 'simulator-media-local-picker', filename: pendingFilename,
      mimeType: 'image/png', byteCount: 418_100, uri: MEDIA_DYNAMIC_LOCAL_PIXEL }],
  };
  if (receiptAcknowledged) {
    local = bindOptimisticPromptToRun([local], local.id, MEDIA_RUN_ID, MEDIA_SUBMISSION_ID)[0]!;
  }
  return mergeLatestHistory(latest, [local], MEDIA_DYNAMIC_SESSION_KEY);
}

export function bindSimulatorDynamicMediaReceipt(messages: WorkspaceMessage[]) {
  return bindOptimisticPromptToRun(
    messages, `local-${MEDIA_SUBMISSION_ID}`, MEDIA_RUN_ID, MEDIA_SUBMISSION_ID,
  );
}

export function canonicalSimulatorDynamicMediaRows(current: WorkspaceMessage[]) {
  const canonical = simulatorDynamicMediaPromptRows(true).filter(row => row.source === 'history');
  return latestHistoryWindow(
    canonical,
    current.filter(row => row.sessionKey === MEDIA_DYNAMIC_SESSION_KEY),
    MEDIA_DYNAMIC_SESSION_KEY,
  );
}
