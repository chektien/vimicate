import { formattedAttachmentSize } from '../prompt/promptAttachments';
import type { WorkspaceAttachment, WorkspaceMessage } from '../workspace/workspaceTypes';

export type TranscriptMediaPresentation = {
  image: boolean;
  caption: string | null;
};

/**
 * Transcript images are already identified by their visual content and their
 * accessible label. Repeating a long alt string or host filename beneath the
 * thumbnail adds noise, so the visible caption contains technical metadata
 * only. Non-image files retain their filename because the icon alone does not
 * identify them.
 */
export function transcriptMediaPresentation(attachment: WorkspaceAttachment): TranscriptMediaPresentation {
  const image = attachment.mimeType.startsWith('image/');
  const dimensions = attachment.pixelWidth && attachment.pixelHeight
    ? `${Math.round(attachment.pixelWidth)}×${Math.round(attachment.pixelHeight)}`
    : '';
  const size = attachment.byteCount ? formattedAttachmentSize(attachment.byteCount) : '';
  const metadata = [dimensions, size].filter(Boolean).join(' · ');
  return {
    image,
    caption: image ? metadata || null : [attachment.filename, metadata].filter(Boolean).join(' · '),
  };
}

/** UI metadata only: never insert this label into the authored/searchable source. */
export function attachmentOnlyPromptLabel(message: Pick<WorkspaceMessage, 'role' | 'text' | 'attachments'>): string | null {
  if (message.role !== 'user' || message.text.trim() || !message.attachments?.length) return null;
  const count = message.attachments.length;
  const imagesOnly = message.attachments.every((attachment) => attachment.mimeType.startsWith('image/'));
  if (imagesOnly) return count === 1 ? 'Image attached' : `${count} images attached`;
  return count === 1 ? 'File attached' : `${count} attachments`;
}
