import { registerWebModule, NativeModule } from 'expo';

// VimicateEditorModule is not available on the web platform.
class VimicateEditorModule extends NativeModule<{}> {
  setClipboardText(_text: string) {}
  async prepareImageUploadCopy(_dataBase64: string): Promise<{ dataBase64: string; byteCount: number; mimeType: string }> {
    throw new Error('Image upload optimization requires the native app.');
  }
}

export default registerWebModule(VimicateEditorModule, 'VimicateEditorModule');
