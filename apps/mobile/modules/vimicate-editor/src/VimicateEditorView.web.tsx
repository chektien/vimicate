import { VimicateEditorViewProps } from './VimicateEditor.types';

// VimicateEditorView is not available on the web platform.
export default function VimicateEditorView(_props: VimicateEditorViewProps) {
  throw new Error('VimicateEditorView is not available on the web platform.');
}
