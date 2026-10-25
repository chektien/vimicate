import { describe, expect, it } from 'vitest';
import { promptAttachmentViewer } from './promptAttachmentViewer';
import type { PromptAttachment } from './promptAttachments';

const attachments: PromptAttachment[] = [
  { id: 'image-one', uri: 'file:///one.png', filename: 'one.png', mimeType: 'image/png', byteCount: 100, kind: 'image' },
  { id: 'document', uri: 'file:///notes.pdf', filename: 'notes.pdf', mimeType: 'application/pdf', byteCount: 200, kind: 'file' },
  { id: 'image-two', uri: 'file:///two.jpg', filename: 'two.jpg', mimeType: 'image/jpeg', byteCount: 300, kind: 'image' },
];

describe('staged prompt attachment viewer', () => {
  it('opens the standard image viewer on the tapped staged image without including documents', () => {
    expect(promptAttachmentViewer(attachments, 'image-two')).toEqual({
      attachments: [
        { id: 'image-one', uri: 'file:///one.png', filename: 'one.png', mimeType: 'image/png', byteCount: 100 },
        { id: 'image-two', uri: 'file:///two.jpg', filename: 'two.jpg', mimeType: 'image/jpeg', byteCount: 300 },
      ],
      initialID: 'image-two',
    });
  });

  it('does not open a viewer for a document or unknown attachment', () => {
    expect(promptAttachmentViewer(attachments, 'document')).toBeNull();
    expect(promptAttachmentViewer(attachments, 'missing')).toBeNull();
  });
});
