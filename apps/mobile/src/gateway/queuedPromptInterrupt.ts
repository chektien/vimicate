import type { GatewayPromptAttachment } from '../prompt/promptAttachments';
import type { QueuedInterruptScope, QueuedInterruptResult, QueuedPromptTracking } from './queuedPromptSubmission';

/** Local queue control, never a model prompt or a replacement prompt send. */
export async function submitQueuedInterrupt(options: {
  scope: QueuedInterruptScope;
  tracking?: QueuedPromptTracking | undefined;
  attachments: GatewayPromptAttachment[] | Promise<GatewayPromptAttachment[]>;
  hasPreviewAttachments: boolean;
  owns: () => boolean;
}): Promise<QueuedInterruptResult> {
  let attachments: GatewayPromptAttachment[];
  try { attachments = await options.attachments; }
  catch { return { accepted: false, detail: 'Queue control could not read attachments. Your draft is kept.' }; }
  if (!options.owns()) return { accepted: false, detail: 'The current task changed. Nothing was interrupted.' };
  if (options.hasPreviewAttachments || attachments.length) {
    return { accepted: false, detail: 'Send interrupt without attachments to control queued work. Your draft and attachments are kept.' };
  }
  if (!options.scope.predecessorRunId || !options.scope.sessionId || !options.tracking?.interruptQueued) {
    return { accepted: false, detail: 'No confirmed queued message belongs to the current task. Nothing was interrupted.' };
  }
  return options.tracking.interruptQueued(options.scope);
}
