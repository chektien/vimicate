import { useContext, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SoftwareKeyboardInsetContext } from '../layout/softwareKeyboardInsetContext';
import { colors } from '../theme/tokens';

/** Paint the footer through the device inset while keeping controls above it. */
export function BottomSafeAreaChrome({ children }: { children: ReactNode }) {
  const safeAreaInsets = useSafeAreaInsets();
  const keyboardInset = useContext(SoftwareKeyboardInsetContext);
  // Keyboard avoidance has already moved these controls above the home area.
  // Reserve only the part of that area not consumed by the viewport.
  const paddingBottom = Math.max(0, safeAreaInsets.bottom - keyboardInset);
  return <View style={[styles.bottomChrome, { paddingBottom }]}>{children}</View>;
}

const styles = StyleSheet.create({
  bottomChrome: { backgroundColor: colors.canvas },
});
