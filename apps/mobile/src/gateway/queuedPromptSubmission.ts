import type { GatewayPromptAttachment } from '../prompt/promptAttachments';
import { transcriptSessionIdentity } from '../workspace/transcriptMetadata';
import type { OpenClawClient } from './OpenClawClient';
import type { GatewaySendControl } from './gatewaySendControl';
import { gatewayQueueCandidate, gatewayRequestFailure, type GatewayQueueCandidate } from './gatewayRequestDelivery';
import { gatewayQueuedInputAck } from './gatewayQueuedInput';

export type QueuedInterruptScope = { sessionKey: string; sessionId: string; predecessorRunId: string };
export type QueuedInterruptResult = { accepted: boolean; detail: string };
export const queuedPromptAcceptedNotice = 'Message accepted to run automatically after the current task. Checking queue status. Reply "interrupt" to stop the current task and run queued messages next.';

export type QueuedPromptTracking = {
  interruptQueued?: (scope: QueuedInterruptScope) => Promise<QueuedInterruptResult>;
  prepare(record: { runId: string; originalSubmissionId: string; sessionKey: string; sessionId: string; predecessorRunId: string; text: string; createdAt: number }): Promise<void>;
  accepted(runId: string, payload: unknown): Promise<void> | void;
  failed(runId: string, error: unknown): Promise<void> | void;
};

/** Exact route, concrete generation and refused predecessor, never run origin.
 * Older hosts without generation proof fail closed instead of guessing. A
 * run_not_ready owner has no steering target, so only that refusal may be
 * proven by the separate attached current run, and never against a different
 * steering target. */
export function activeRunQueueProof(payload: unknown, sessionKey: string, sessionId: string, runId: string, reason?: GatewayQueueCandidate['reason']) {
  const session = record(record(payload).session);
  const exactRoute = Boolean(runId && session.key === sessionKey && session.hasActiveRun === true && session.sessionId === sessionId);
  if (session.activeRunId === runId) return exactRoute;
  return exactRoute && reason === 'run_not_ready' && session.activeRunId === undefined && session.attachedRunId === runId;
}

/** One logical Send first attempts steering. Only proven exact non-dispatch
 * permits one independently admitted followup. Lost replies never permit replay. */
export async function sendWithQueuedFallback(options: {
  client: Pick<OpenClawClient, 'send' | 'readSessionRunTruth'>;
  sessionKey: string;
  sessionId?: string | undefined;
  text: string;
  outbound: string;
  attachments: GatewayPromptAttachment[];
  submissionId: string;
  control?: GatewaySendControl | undefined;
  tracking?: QueuedPromptTracking | undefined;
  ownsFallback: () => boolean;
  onFollowupIdentity: (runId: string) => void;
}) {
  const { client, sessionKey, outbound, attachments, submissionId, control, tracking } = options;
  try {
    const payload = await client.send(sessionKey, outbound, attachments, submissionId, ...(control ? [control] : []));
    return { payload, followupRunId: '' };
  } catch (error) {
    const sessionId = transcriptSessionIdentity(options.sessionId);
    const candidate = control?.queueMode === 'steer' ? gatewayQueueCandidate(error, control.expectedActiveRunId) : undefined;
    if (control?.queueMode !== 'steer' || !tracking || !sessionId || !options.ownsFallback() || !candidate) throw error;
    // Read exact target and generation once after strict refusal. Unknown keeps the draft.
    let truth: unknown;
    try { truth = await client.readSessionRunTruth(sessionKey); } catch { throw error; }
    if (!activeRunQueueProof(truth, sessionKey, sessionId, control.expectedActiveRunId, candidate.reason) || !options.ownsFallback()) throw error;
    // The strict request's dedupe identity includes its control mode. A
    // separate deterministic key distinguishes followup admission from that
    // refused operation without creating an unbounded retry chain.
    const runId = `${submissionId}:followup`;
    if (!submissionId || runId.length > 256) throw error;
    try {
      await tracking.prepare({ runId, originalSubmissionId: submissionId, sessionKey, sessionId,
        predecessorRunId: control.expectedActiveRunId, text: options.text, createdAt: Date.now() });
    } catch (preparationError) {
      throw gatewayRequestFailure(preparationError instanceof Error ? preparationError.message : 'Queue preparation failed. Your draft is kept.', false);
    }
    try {
      if (!options.ownsFallback()) throw gatewayRequestFailure('The active task changed before queueing. Your draft is kept.', false);
      options.onFollowupIdentity(runId);
      const payload = await client.send(sessionKey, outbound, attachments, runId, { queueMode: 'followup', sessionId });
      if (gatewayQueuedInputAck(payload, runId).state !== 'accepted') {
        throw gatewayRequestFailure('Message acceptance is unconfirmed. Checking its queue receipt; do not resend.', true);
      }
      // Accepted input belongs to the Gateway even if local persistence fails.
      // The owner reports storage errors separately, never as send rejection.
      try { await tracking.accepted(runId, payload); } catch { /* Server acceptance cannot be undone by a local storage failure. */ }
      return { payload, followupRunId: runId };
    } catch (followupError) {
      try { await tracking.failed(runId, followupError); } catch { /* Preserve the original transport disposition. */ }
      throw followupError;
    }
  }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
