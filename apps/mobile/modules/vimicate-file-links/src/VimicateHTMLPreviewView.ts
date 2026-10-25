import { requireNativeView } from 'expo';
import type { ComponentType } from 'react';
import module, { type VimicateFileShareAnchor, type VimicateFileShareResult } from './VimicateFileLinksModule';
import type { VimicateFilePreviewViewProps } from './VimicateFilePreviewView';

function optionalHTMLView(): ComponentType<VimicateFilePreviewViewProps> | null {
  if (module?.supportsHTMLPreview !== true) return null;
  try { return requireNativeView('VimicateFileLinks', 'HTMLPreview'); } catch { return null; }
}
export const VimicateHTMLPreviewView = optionalHTMLView();
export const isVimicateHTMLPreviewAvailable = (): boolean => VimicateHTMLPreviewView !== null;
export const isVimicateFileShareAvailable = (): boolean =>
  module?.supportsFileSharing === true && typeof module.shareFile === 'function';
export function maximumVimicateFileShareBytes(): number {
  if (!isVimicateFileShareAvailable()) return 0;
  const bytes = module?.maximumFileShareBytes;
  return Number.isSafeInteger(bytes) && bytes! >= 0 ? Math.min(bytes!, 32 * 1024 * 1024) : 8 * 1024 * 1024;
}
export async function shareVimicateFile(dataBase64: string, filename: string, mimeType: string,
  anchor?: VimicateFileShareAnchor): Promise<VimicateFileShareResult> {
  if (!module || !isVimicateFileShareAvailable()) throw new Error('File sharing requires an updated native app.');
  return module.shareFile(dataBase64, filename, mimeType, anchor ?? null);
}
