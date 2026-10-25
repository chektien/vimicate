import { requireNativeView } from 'expo';
import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';
import module from './VimicateFileLinksModule';

export type VimicateFilePreviewStatus = {
  status: 'ready' | 'unsupported' | 'error';
  message?: string;
};
export type VimicateFilePreviewViewProps = ViewProps & {
  dataBase64: string;
  filename: string;
  mimeType: string;
  onPreviewStatus?: (event: { nativeEvent: VimicateFilePreviewStatus }) => void;
};

function optionalPreviewView(): ComponentType<VimicateFilePreviewViewProps> | null {
  // Old native binaries may have the file-links module but no preview view.
  if (module?.supportsInlinePreview !== true) return null;
  try { return requireNativeView('VimicateFileLinks'); } catch { return null; }
}

export const VimicateFilePreviewView = optionalPreviewView();
export const isVimicateFilePreviewAvailable = (): boolean => VimicateFilePreviewView !== null;
