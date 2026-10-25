import { StyleSheet } from 'react-native';
import { colors } from '../theme/tokens';

/** Shared optical scale for brand, connection and workspace pane controls. */
export const headerGlyphStyles = StyleSheet.create({
  slot: { width: 44, height: 28, flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderRadius: 5 },
  frame: { width: 21, height: 16, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: 2, backgroundColor: colors.canvas },
});
