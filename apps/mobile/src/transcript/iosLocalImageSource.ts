import { Platform } from 'react-native';
import VimicateFileLinks from '../../modules/vimicate-file-links';
import type { WorkspaceAttachment } from '../workspace/workspaceTypes';
import { gatewayLocalImagePath, type ImageNetworkSource } from './gatewayImageSource';

export async function materializedIOSLocalImageSource(
  attachment: WorkspaceAttachment,
  promptIfNeeded: boolean,
): Promise<ImageNetworkSource | null> {
  const path = gatewayLocalImagePath(attachment);
  if (!path || Platform.OS !== 'ios' || !VimicateFileLinks) return null;
  try {
    const result = await VimicateFileLinks.materializeLocalImage(path, promptIfNeeded);
    if (result.status !== 'loaded') return null;
    return { uri: result.dataUrl, diagnostic: 'ios-files-materialized-ok' };
  } catch {
    return null;
  }
}
