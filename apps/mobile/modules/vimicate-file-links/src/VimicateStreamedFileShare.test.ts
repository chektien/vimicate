import { beforeEach, expect, it, vi } from 'vitest';
const probe = vi.hoisted(() => ({ module: {} as Record<string, unknown> }));
vi.mock('./VimicateFileLinksModule', () => ({ default: probe.module }));
import { beginVimicateFileShare, isVimicateStreamedFileShareAvailable } from './VimicateStreamedFileShare';
beforeEach(() => { for (const key of Object.keys(probe.module)) delete probe.module[key]; });
it('does not enable streaming on an old or incomplete binary', async () => {
  expect(isVimicateStreamedFileShareAvailable()).toBe(false);
  probe.module.supportsStreamedFileSharing = true;
  expect(isVimicateStreamedFileShareAvailable()).toBe(false);
  await expect(beginVimicateFileShare('file.bin', 1)).rejects.toThrow('updated native app');
});
it('forwards only opaque native IDs, chunks, metadata and the final anchor', async () => {
  const begin = vi.fn().mockResolvedValue('opaque-id');
  const append = vi.fn().mockResolvedValue(undefined);
  const present = vi.fn().mockResolvedValue({ status: 'cancelled' });
  const cancel = vi.fn().mockResolvedValue(undefined);
  Object.assign(probe.module, { supportsStreamedFileSharing: true, beginFileShare: begin, appendFileShare: append,
    presentFileShare: present, cancelFileShare: cancel });
  expect(isVimicateStreamedFileShareAvailable()).toBe(true);
  const stage = await beginVimicateFileShare('original.bin', 64 * 1024 * 1024);
  await stage.append(0, 'YQ==');
  const anchor = { x: 1, y: 2, width: 44, height: 44 };
  await expect(stage.present(anchor)).resolves.toEqual({ status: 'cancelled' }); await stage.cancel();
  expect(begin).toHaveBeenCalledWith('original.bin', 64 * 1024 * 1024);
  expect(append).toHaveBeenCalledWith('opaque-id', 0, 'YQ==');
  expect(present).toHaveBeenCalledWith('opaque-id', anchor); expect(cancel).toHaveBeenCalledWith('opaque-id');
});
