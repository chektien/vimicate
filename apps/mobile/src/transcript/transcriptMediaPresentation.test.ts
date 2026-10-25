import { describe, expect, it } from 'vitest';
import { attachmentOnlyPromptLabel, transcriptMediaPresentation } from './transcriptMediaPresentation';

describe('transcript media presentation', () => {
  it('omits descriptive image captions while retaining compact dimensions and size', () => {
    expect(transcriptMediaPresentation({
      id: 'image',
      filename: 'A very long generated description of the recovered document',
      mimeType: 'image/png',
      pixelWidth: 2048,
      pixelHeight: 1536,
      byteCount: 251_700,
    })).toEqual({ image: true, caption: '2048×1536 · 251.7 KB' });
  });

  it('shows no redundant line when an image has no technical metadata', () => {
    expect(transcriptMediaPresentation({ id: 'image', filename: 'screenshot.png', mimeType: 'image/png' }))
      .toEqual({ image: true, caption: null });
  });

  it('keeps a non-image filename because its icon does not identify the file', () => {
    expect(transcriptMediaPresentation({ id: 'document', filename: 'report.pdf', mimeType: 'application/pdf', byteCount: 10_000 }))
      .toEqual({ image: false, caption: 'report.pdf · 10.0 KB' });
  });
});

describe('attachment-only prompt label', () => {
  const image = { id: 'image', filename: 'screenshot.png', mimeType: 'image/png' };
  const file = { id: 'file', filename: 'notes.pdf', mimeType: 'application/pdf' };
  it('labels image-only prompts even before image bytes resolve', () => {
    expect(attachmentOnlyPromptLabel({ role: 'user', text: '', attachments: [image] })).toBe('Image attached');
    expect(attachmentOnlyPromptLabel({ role: 'user', text: ' \n ', attachments: [image, { ...image, id: 'second' }] })).toBe('2 images attached');
  });
  it('describes files and mixed media without calling everything an image', () => {
    expect(attachmentOnlyPromptLabel({ role: 'user', text: '', attachments: [file] })).toBe('File attached');
    expect(attachmentOnlyPromptLabel({ role: 'user', text: '', attachments: [image, file] })).toBe('2 attachments');
  });
  it('does not replace authored captions or label empty/non-user messages', () => {
    expect(attachmentOnlyPromptLabel({ role: 'user', text: 'See this screenshot', attachments: [image] })).toBeNull();
    expect(attachmentOnlyPromptLabel({ role: 'user', text: '', attachments: [] })).toBeNull();
    expect(attachmentOnlyPromptLabel({ role: 'assistant', text: '', attachments: [image] })).toBeNull();
  });
});
