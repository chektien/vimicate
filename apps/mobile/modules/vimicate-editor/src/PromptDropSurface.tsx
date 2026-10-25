import { requireNativeView } from 'expo';
import type { ComponentType, ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import module from './VimicateEditorModule';
import type { PromptDropEvent } from './VimicateEditor.types';

type Props = { sessionKey: string; enabled: boolean; children: ReactNode; style?: StyleProp<ViewStyle>; onDrop?: ((event: PromptDropEvent) => void) | undefined };
type NativeProps = Omit<Props, 'onDrop'> & { onDrop?: (event: { nativeEvent: PromptDropEvent }) => void };
const NativeDropView: ComponentType<NativeProps> | null = module.supportsPromptDrop === true
  ? requireNativeView('VimicateEditor', 'PromptDrop') : null;

export function PromptDropSurface({ onDrop, ...props }: Props) {
  if (!NativeDropView) return <View style={props.style}>{props.children}</View>;
  return <NativeDropView {...props} onDrop={({ nativeEvent }) => onDrop?.(nativeEvent)} />;
}
