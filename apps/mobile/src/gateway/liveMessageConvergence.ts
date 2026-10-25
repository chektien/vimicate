import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { assistantAttachmentSnapshot } from './assistantAttachmentSnapshot';

/** Preserve monotonic cumulative assistant publication without text dedupe. */
export function convergedLiveMessage(previous: WorkspaceMessage, incoming: WorkspaceMessage) {
  if (previous.id !== incoming.id) return incoming;
  if (previous.sessionKey === incoming.sessionKey && previous.approval?.id === incoming.approval?.id
    && previous.approval?.resolved && incoming.approval && !incoming.approval.resolved) return previous;
  if (previous.role !== 'assistant' || incoming.role !== 'assistant') {
    const converged = { ...previous, ...incoming };
    if (previous.approval && incoming.approval && !incoming.runId && previous.runId) converged.runId = previous.runId;
    // A shared-narration hydration can win the race just before the original
    // untimestamped live item is flushed. Keep the host-recorded source time
    // and durable authority so the late frame cannot erase the coordinate that
    // interleaves it with optimistic steering prompts.
    if (!incoming.timestamp && previous.timestamp) converged.timestamp = previous.timestamp;
    if (previous.source === 'history' && incoming.source === 'live') converged.source = 'history';
    return converged;
  }
  const previousText = previous.text;
  const incomingText = incoming.text;
  const regressesCumulativePrefix = incoming.state === 'streaming'
    && previousText.length > incomingText.length
    && previousText.startsWith(incomingText);
  const regressesRawEnvelope = regressesCumulativePrefix && previous.chatCumulativeText
    && incoming.chatCumulativeText && previous.chatCumulativeText.length > incoming.chatCumulativeText.length
    && previous.chatCumulativeText.startsWith(incoming.chatCumulativeText);
  const text = regressesCumulativePrefix ? previousText : incomingText;
  // Gateway chat frames are cumulative snapshots, not attachment deltas. An
  // explicit media list therefore replaces the previous attempt instead of
  // accumulating obsolete ImageGen cards forever. Text-only streaming frames
  // may omit the field, so they retain the last explicit snapshot. A terminal
  // frame is authoritative even when it intentionally clears all media.
  const attachments = assistantAttachmentSnapshot(previous, incoming);
  const converged: WorkspaceMessage = {
    ...previous,
    ...incoming,
    text,
    ...(regressesRawEnvelope ? { chatCumulativeText: previous.chatCumulativeText } : {}),
    // Retain the first host time even when published text is a cropped tail.
    ...(previous.timestamp && incoming.text.includes(previous.text)
      ? { timestamp: previous.timestamp } : {}),
  };
  if (attachments.length) converged.attachments = attachments;
  else delete converged.attachments;
  return converged;
}
