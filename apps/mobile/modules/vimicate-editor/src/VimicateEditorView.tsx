import { requireNativeView } from 'expo';
import * as React from 'react';

import { VimicateEditorViewProps } from './VimicateEditor.types';

const NativeView: React.ComponentType<VimicateEditorViewProps> = requireNativeView('VimicateEditor');

export default function VimicateEditorView(props: VimicateEditorViewProps) {
  return <NativeView {...props} />;
}
