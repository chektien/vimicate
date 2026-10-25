import { sameAsyncQuestion } from '../questions/asyncQuestionContract';
import type { WorkspaceAttachment, WorkspaceMessage } from '../workspace/workspaceTypes';
import { sameCliProvenance, sameDisplayPosition } from '../workspace/transcriptMetadata';

/** Domain publication equality includes raw convergence authority. Native cell
 * reuse uses the presentation-only comparator below. */
export function sameTranscriptPublication(left: readonly WorkspaceMessage[], right: readonly WorkspaceMessage[]) {
  return left === right || (left.length === right.length && left.every((message, index) => sameWorkspaceMessage(message, right[index]!)));
}

function sameWorkspaceMessage(left: WorkspaceMessage, right: WorkspaceMessage) {
  return left === right || (left.text === right.text
    && left.chatCumulativeText === right.chatCumulativeText
    && left.claudeNativeFullText === right.claudeNativeFullText
    && left.terminalReplyText === right.terminalReplyText
    && sameWorkspaceMessageExceptText(left, right));
}

/** Presentation rows already compare their compiled source line. This variant
 * lets unchanged lines of one growing message retain native cell identity
 * while still invalidating every non-text fact used by row actions/metadata. */
export function sameWorkspaceMessageExceptText(left: WorkspaceMessage, right: WorkspaceMessage) {
  return left === right || (left.id === right.id
    && left.role === right.role
    && left.timestamp === right.timestamp
    && left.state === right.state
    && left.runId === right.runId
    && left.sessionKey === right.sessionKey
    && left.source === right.source
    && left.transcriptSessionId === right.transcriptSessionId
    && left.narrationItemId === right.narrationItemId
    && left.asyncQuestionPrivate === right.asyncQuestionPrivate && left.asyncMessage === right.asyncMessage && sameAsyncQuestion(left.asyncQuestion, right.asyncQuestion)
    && left.asyncQuestionRunOutcome === right.asyncQuestionRunOutcome && left.asyncQuestionRestartRecovery === right.asyncQuestionRestartRecovery
    && left.asyncQuestionReplyToId === right.asyncQuestionReplyToId && left.asyncQuestionAnswerText === right.asyncQuestionAnswerText
    && left.inputAcceptedAtMs === right.inputAcceptedAtMs
    && left.inputReceiptRunId === right.inputReceiptRunId
    && sameDisplayPosition(left.displayPosition, right.displayPosition)
    && sameCliProvenance(left.cliProvenance, right.cliProvenance)
    && left.idempotencyKey === right.idempotencyKey
    && left.absorbedLiveIdentity?.messageId === right.absorbedLiveIdentity?.messageId
    && left.absorbedLiveIdentity?.runId === right.absorbedLiveIdentity?.runId
    && left.toolGroup?.count === right.toolGroup?.count
    && left.toolGroup?.lastMessageId === right.toolGroup?.lastMessageId
    && sameTool(left.tool, right.tool)
    && sameAttachments(left.attachments, right.attachments)
    && sameApproval(left.approval, right.approval)
    && sameRecovery(left.recovery, right.recovery));
}

function sameTool(left: WorkspaceMessage['tool'], right: WorkspaceMessage['tool']) {
  return left === right || Boolean(left && right
    && left.name === right.name
    && left.summary === right.summary
    && left.durationMs === right.durationMs);
}

function sameAttachments(left: WorkspaceAttachment[] | undefined, right: WorkspaceAttachment[] | undefined) {
  if (left === right) return true;
  if (!left || !right || left.length !== right.length) return false;
  return left.every((attachment, index) => sameAttachment(attachment, right[index]!));
}

function sameAttachment(left: WorkspaceAttachment, right: WorkspaceAttachment) {
  return left === right || (
    left.id === right.id
    && left.artifactId === right.artifactId
    && left.artifactSessionKey === right.artifactSessionKey
    && left.filename === right.filename
    && left.mimeType === right.mimeType
    && left.byteCount === right.byteCount
    && left.pixelWidth === right.pixelWidth
    && left.pixelHeight === right.pixelHeight
    && left.uri === right.uri
    && sameHeaders(left.headers, right.headers)
  );
}

function sameHeaders(left: Record<string, string> | undefined, right: Record<string, string> | undefined) {
  if (left === right) return true;
  if (!left || !right) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length && leftKeys.every((key) => right[key] === left[key]);
}

function sameApproval(left: WorkspaceMessage['approval'], right: WorkspaceMessage['approval']) {
  return left === right || Boolean(left && right
    && left.id === right.id
    && left.kind === right.kind
    && left.resolved === right.resolved
    && left.expiresAtMs === right.expiresAtMs
    && left.outcome === right.outcome
    && left.allowedDecisions.length === right.allowedDecisions.length
    && left.allowedDecisions.every((decision, index) => decision === right.allowedDecisions[index]));
}

function sameRecovery(left: WorkspaceMessage['recovery'], right: WorkspaceMessage['recovery']) {
  return left === right || Boolean(left && right
    && left.sourceMessageId === right.sourceMessageId
    && left.state === right.state
    && left.detail === right.detail);
}
