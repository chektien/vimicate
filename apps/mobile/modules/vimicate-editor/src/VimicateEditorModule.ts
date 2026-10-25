import type { DroppedAttachment } from './VimicateEditor.types';
import { NativeModule, requireNativeModule } from 'expo';

declare class VimicateEditorModule extends NativeModule<{}> {
  readonly supportsPromptDrop?: boolean;
  readDrop(id: string): Promise<DroppedAttachment[]>;
  discardDrop(id: string): Promise<void>;
  releaseDroppedFile(uri: string): Promise<void>;
  setClipboardText(text: string): void;
  prepareImageUploadCopy(dataBase64: string): Promise<{ dataBase64: string; byteCount: number; mimeType: string }>;
}

export default requireNativeModule<VimicateEditorModule>('VimicateEditor');
