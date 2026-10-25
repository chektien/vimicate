import type { WorkspaceAttachment, WorkspaceMessage } from '../workspace/workspaceTypes';

/**
 * Assistant chat media is delivered as a cumulative snapshot. Preserve the
 * last explicit snapshot across text-only deltas, but never union successive
 * ImageGen attempts. A terminal representation can authoritatively clear it.
 */
export function assistantAttachmentSnapshot(previous: WorkspaceMessage, incoming: WorkspaceMessage) {
  return incoming.attachments !== undefined || incoming.state === 'complete'
    ? uniqueWorkspaceAttachments(incoming.attachments)
    : uniqueWorkspaceAttachments(previous.attachments);
}

export function uniqueWorkspaceAttachments(source: WorkspaceAttachment[] | undefined) {
  const result: WorkspaceAttachment[] = [];
  const seen = new Set<string>();
  for (const attachment of source ?? []) {
    const identity = `${attachment.id}\u0000${attachment.uri ?? ''}`;
    if (seen.has(identity)) continue;
    seen.add(identity); result.push(attachment);
  }
  return result;
}
