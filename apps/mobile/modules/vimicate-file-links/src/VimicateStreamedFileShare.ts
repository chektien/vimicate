import module from './VimicateFileLinksModule';
import type { VimicateFileShareAnchor } from './VimicateFileLinksModule';

export const isVimicateStreamedFileShareAvailable = (): boolean => module?.supportsStreamedFileSharing === true &&
  ['beginFileShare', 'appendFileShare', 'presentFileShare', 'cancelFileShare'].every(key =>
    typeof module?.[key as 'beginFileShare'] === 'function');

/** Opaque native custody, never a writable local URI supplied by JavaScript. */
export async function beginVimicateFileShare(filename: string, size: number) {
  if (!module || !isVimicateStreamedFileShareAvailable()) throw new Error('File sharing requires an updated native app.');
  const id = await module.beginFileShare(filename, size);
  return {
    append: (offset: number, dataBase64: string) => module!.appendFileShare(id, offset, dataBase64),
    present: (anchor: VimicateFileShareAnchor) => module!.presentFileShare(id, anchor),
    cancel: () => module!.cancelFileShare(id),
  };
}
