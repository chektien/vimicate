import { fromByteArray } from 'base64-js';
import { describe, expect, it, vi } from 'vitest';
import { MAX_PROMPT_ATTACHMENTS_TOTAL_BYTES, normalizedPromptAttachment } from './promptAttachments';
import { materializePromptAttachment } from './promptAttachmentPayloads';

describe('prompt attachment payload materialization', () => {
  it('uses the bounded bytes actually read instead of trusting staged picker metadata', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const readBase64 = vi.fn(async () => fromByteArray(bytes));
    const attachment = normalizedPromptAttachment({
      id: 'changed-file',
      uri: 'file:///changed.bin',
      filename: 'changed.bin',
      mimeType: 'application/octet-stream',
      byteCount: 1,
    });

    await expect(materializePromptAttachment(attachment, async () => ({ readBase64 }))).resolves.toEqual({
      id: 'changed-file',
      uri: 'file:///changed.bin',
      filename: 'changed.bin',
      mimeType: 'application/octet-stream',
      byteCount: bytes.byteLength,
      dataBase64: fromByteArray(bytes),
    });
    expect(readBase64).toHaveBeenCalledExactlyOnceWith(MAX_PROMPT_ATTACHMENTS_TOTAL_BYTES + 1);
  });

  it('leaves the event loop available while native base64 preparation is pending', async () => {
    let complete!: (value: string) => void;
    const readBase64 = vi.fn(() => new Promise<string>((resolve) => { complete = resolve; }));
    const attachment = normalizedPromptAttachment({ uri: 'file:///pending.pdf', filename: 'pending.pdf', byteCount: 1 });
    const pending = materializePromptAttachment(attachment, async () => ({ readBase64 }));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(readBase64).toHaveBeenCalledOnce();
    complete('AQID');
    await expect(pending).resolves.toMatchObject({ byteCount: 3, dataBase64: 'AQID' });
  });

  it('rejects a stale-metadata oversized file after only one bounded read', async () => {
    const readBase64 = vi.fn(async () => fromByteArray(new Uint8Array(MAX_PROMPT_ATTACHMENTS_TOTAL_BYTES + 1)));
    const attachment = normalizedPromptAttachment({
      uri: 'file:///reported-small.png',
      filename: 'reported-small.png',
      mimeType: 'image/png',
      byteCount: 100,
    });

    await expect(materializePromptAttachment(attachment, async () => ({ readBase64 }))).rejects.toThrow(
      'reported-small.png exceeds the remaining 18 MB total attachment budget.',
    );
    expect(readBase64).toHaveBeenCalledExactlyOnceWith(MAX_PROMPT_ATTACHMENTS_TOTAL_BYTES + 1);
  });

  it('rejects a known-large open file before allocating its bytes', async () => {
    const readBase64 = vi.fn(async () => '');
    const attachment = normalizedPromptAttachment({
      uri: 'file:///provider-large.heic',
      filename: 'provider-large.heic',
      mimeType: 'image/heic',
      byteCount: 100,
    });

    await expect(materializePromptAttachment(attachment, async () => ({
      size: MAX_PROMPT_ATTACHMENTS_TOTAL_BYTES + 1,
      readBase64,
    }))).rejects.toThrow('provider-large.heic exceeds the remaining 18 MB total attachment budget.');
    expect(readBase64).not.toHaveBeenCalled();
  });

  it('propagates a bounded native read failure', async () => {
    const attachment = normalizedPromptAttachment({
      uri: 'file:///unreadable.png',
      filename: 'unreadable.png',
      mimeType: 'image/png',
      byteCount: 100,
    });

    await expect(materializePromptAttachment(attachment, async () => ({
      readBase64: async () => { throw new Error('provider unavailable'); },
    }))).rejects.toThrow('provider unavailable');
  });
});
