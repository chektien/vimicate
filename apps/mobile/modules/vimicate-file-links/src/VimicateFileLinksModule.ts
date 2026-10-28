import { NativeModule, requireOptionalNativeModule } from 'expo';

export type LocalPathOpenResult =
  | { status: 'opened' | 'linked' | 'cancelled' }
  | { status: 'unavailable'; message: string };
export type LocalImageMaterializeResult =
  | { status: 'loaded'; dataUrl: string; mimeType: string; byteCount: number }
  | { status: 'unmapped' | 'cancelled' | 'missing' | 'unsupported' };

export type VimicateFileShareAnchor = { x: number; y: number; width: number; height: number };
export type VimicateFileShareResult = { status: 'shared' | 'cancelled' };

declare class VimicateFileLinksModule extends NativeModule<{}> {
  readonly supportsInlinePreview?: boolean;
  readonly supportsHTMLPreview?: boolean;
  readonly supportsFileSharing?: boolean;
  readonly maximumFileShareBytes?: number;
  readonly supportsStreamedFileSharing?: boolean;
  beginFileShare(filename: string, size: number): Promise<string>;
  appendFileShare(id: string, offset: number, dataBase64: string): Promise<void>;
  presentFileShare(id: string, anchor: VimicateFileShareAnchor | null): Promise<VimicateFileShareResult>;
  cancelFileShare(id: string): Promise<void>;
  shareFile(dataBase64: string, filename: string, mimeType: string, anchor: VimicateFileShareAnchor | null): Promise<VimicateFileShareResult>;
  openLocalPath(path: string): Promise<LocalPathOpenResult>;
  materializeLocalImage(path: string, promptIfNeeded: boolean): Promise<LocalImageMaterializeResult>;
}

export default requireOptionalNativeModule<VimicateFileLinksModule>('VimicateFileLinks');
