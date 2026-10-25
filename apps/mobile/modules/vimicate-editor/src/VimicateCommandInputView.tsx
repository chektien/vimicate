import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ComponentType } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

export type VimicateCommandInputViewProps = {
  value: string;
  mostRecentEventCount?: number;
  active: boolean;
  softwareKeyboardEnabled: boolean;
  inputAccessibilityLabel: string;
  onQueryChange?: (event: { nativeEvent: { text: string; eventCount?: number } }) => void;
  historyEnabled?: boolean;
  onHistory?: (event: { nativeEvent: { direction: -1 | 1 } }) => void;
  onSubmit?: () => void;
  onCancel?: () => void;
  onComplete?: (event: { nativeEvent: { reverse: boolean } }) => void;
  style?: StyleProp<ViewStyle>;
};

type NativeProps = Omit<VimicateCommandInputViewProps, 'mostRecentEventCount'> & { valueState?: { text: string; eventCount: number } };
const NativeView: ComponentType<NativeProps> = requireNativeView('VimicateCommandInput');
const supportsEventCount = requireOptionalNativeModule('VimicateCommandInput')?.supportsEventCount === true;

export default function VimicateCommandInputView(props: VimicateCommandInputViewProps) {
  const { mostRecentEventCount = 0, ...nativeProps } = props;
  return <NativeView {...nativeProps} {...(supportsEventCount ? { valueState: { text: props.value, eventCount: mostRecentEventCount } } : {})} />;
}
