import { describe, expect, it, vi } from 'vitest';
import { fromByteArray } from 'base64-js';
import { materializePromptAttachmentBatch } from './promptAttachmentUploadBatch';
import { normalizedPromptAttachment } from './promptAttachments';

const mib = 1024 * 1024;
const file = (name: string, size: number) => normalizedPromptAttachment({ uri: `file:///${name}`, filename: name, byteCount: size });
const reader = (sizes: number[]) => vi.fn(async () => ({ readBase64: async (limit: number) => fromByteArray(new Uint8Array(Math.min(sizes.shift()!, limit))) }));
describe('attachment batch upload budget', () => {
  it('allows a single eighteen MiB PDF without image conversion', async () => {
    const optimize = vi.fn();
    const result = await materializePromptAttachmentBatch([file('large.pdf', 18 * mib)], reader([18 * mib]), optimize, vi.fn());
    expect(result[0]?.byteCount).toBe(18 * mib);
    expect(optimize).not.toHaveBeenCalled();
  });
  it('rejects actual combined overflow even when staged sizes under-report', async () => {
    const read = reader([10 * mib, 9 * mib]);
    await expect(materializePromptAttachmentBatch([file('a.pdf', 1), file('b.pdf', 1)], read, vi.fn(), vi.fn())).rejects.toThrow('18 MB total');
    expect(read).toHaveBeenCalledTimes(2);
  });
  it('optimizes only the upload copy while keeping the original staged metadata and URI', async () => {
    const original = file('shot.png', 8 * mib); const snapshot = { ...original };
    const optimize = vi.fn(async () => ({ dataBase64: 'AQID', byteCount: 3, mimeType: 'image/jpeg' })); const status = vi.fn();
    const result = await materializePromptAttachmentBatch([original], reader([8 * mib]), optimize, status);
    expect(optimize).toHaveBeenCalledOnce();
    expect(result[0]).toMatchObject({ uri: original.uri, filename: 'shot.upload.jpg', byteCount: 3, mimeType: 'image/jpeg' });
    expect(original).toEqual(snapshot);
    expect(status).toHaveBeenCalledWith('shot.png');
  });
  it('counts original bytes toward the total even when optimization makes uploads small', async () => {
    await expect(materializePromptAttachmentBatch([file('a.png', 1), file('b.pdf', 1)], reader([10 * mib, 9 * mib]), async () => ({ dataBase64: 'AQID', byteCount: 3, mimeType: 'image/jpeg' }), vi.fn())).rejects.toThrow('18 MB total');
  });
  it('rejects a failed or invalid derivative without submitting a partial batch', async () => {
    const selected = [file('a.png', 8 * mib)];
    await expect(materializePromptAttachmentBatch(selected, reader([8 * mib]), async () => ({ dataBase64: 'AQID', byteCount: 4, mimeType: 'image/jpeg' }), vi.fn())).rejects.toThrow('original attachment is unchanged');
  });
  it('does not read a later file after a retired native image preparation completes', async () => {
    let complete!: (value: { dataBase64: string; byteCount: number; mimeType: string }) => void;
    const optimize = vi.fn(() => new Promise<{ dataBase64: string; byteCount: number; mimeType: string }>((resolve) => { complete = resolve; }));
    const open = reader([8 * mib, 1]); let active = true;
    const pending = materializePromptAttachmentBatch([file('large.png', 8 * mib), file('later.pdf', 1)], open, optimize, vi.fn(), () => { if (!active) throw new Error('retired'); });
    await vi.waitFor(() => expect(optimize).toHaveBeenCalledOnce());
    expect(open).toHaveBeenCalledTimes(1);
    active = false;
    complete({ dataBase64: 'AQID', byteCount: 3, mimeType: 'image/jpeg' });
    await expect(pending).rejects.toThrow('retired');
    expect(open).toHaveBeenCalledTimes(1);
  });
  it('does not begin a native read after an asynchronously opened file loses its scene', async () => {
    const readBase64 = vi.fn(async () => 'AQID');
    let complete!: (value: { readBase64: typeof readBase64 }) => void;
    const open = vi.fn(() => new Promise<{ readBase64: typeof readBase64 }>((resolve) => { complete = resolve; }));
    let active = true;
    const pending = materializePromptAttachmentBatch([file('pending.pdf', 1)], open, vi.fn(), vi.fn(), () => { if (!active) throw new Error('retired'); });
    active = false; complete({ readBase64 });
    await expect(pending).rejects.toThrow('retired');
    expect(readBase64).not.toHaveBeenCalled();
  });
  it('does not begin a later file after an ordinary native read loses its scene', async () => {
    let complete!: (value: string) => void;
    const readBase64 = vi.fn(() => new Promise<string>((resolve) => { complete = resolve; }));
    const open = vi.fn(async () => ({ readBase64 }));
    let active = true;
    const pending = materializePromptAttachmentBatch([file('pending.pdf', 1), file('later.pdf', 1)], open, vi.fn(), vi.fn(), () => { if (!active) throw new Error('retired'); });
    await vi.waitFor(() => expect(readBase64).toHaveBeenCalledOnce());
    active = false; complete('AQID');
    await expect(pending).rejects.toThrow('retired');
    expect(open).toHaveBeenCalledTimes(1);
  });
});
