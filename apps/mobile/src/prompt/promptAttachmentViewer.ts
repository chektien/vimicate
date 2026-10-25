import type { WorkspaceAttachment } from '../workspace/workspaceTypes';
import type { PromptAttachment } from './promptAttachments';

export function promptAttachmentViewer(attachments: PromptAttachment[], selectedID: string): { attachments: WorkspaceAttachment[]; initialID: string } | null {
  const selected = attachments.find((attachment) => attachment.id === selectedID);
  if (selected?.kind !== 'image') return null;
  return {
    attachments: attachments.flatMap((attachment) => attachment.kind === 'image' ? [{ id: attachment.id, uri: attachment.uri, filename: attachment.filename, mimeType: attachment.mimeType, byteCount: attachment.byteCount }] : []),
    initialID: selectedID,
  };
}
