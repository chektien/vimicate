import { StyleSheet, Text, View, type GestureResponderHandlers } from 'react-native';
import { colors, type } from '../theme/tokens';
import { PROJECT_FILES_DIVIDER_HEIGHT } from './projectFilesSplit';

export function ProjectFilesDivider({ dividerHeight, listHeight, panHandlers, onResize, onRequestFocus }: {
  dividerHeight: number;
  listHeight: number;
  panHandlers: GestureResponderHandlers;
  onResize: (direction: 1 | -1) => void;
  onRequestFocus: () => void;
}) {
  return <View
    accessible
    accessibilityRole="adjustable"
    accessibilityLabel="File list and preview divider"
    accessibilityValue={{ text: `File list ${Math.round(listHeight)} points` }}
    accessibilityActions={[
      { name: 'increment', label: 'Make file list taller' },
      { name: 'decrement', label: 'Make file list shorter' },
    ]}
    onAccessibilityAction={(event) => {
      if (event.nativeEvent.actionName === 'increment') { onRequestFocus(); onResize(1); }
      if (event.nativeEvent.actionName === 'decrement') { onRequestFocus(); onResize(-1); }
    }}
    onTouchStart={onRequestFocus}
    style={[styles.root, { height: dividerHeight }]}
    {...panHandlers}
  ><View style={styles.rule} /><Text style={styles.handle}>━━</Text><View style={styles.rule} /></View>;
}

const styles = StyleSheet.create({
  root: { height: PROJECT_FILES_DIVIDER_HEIGHT, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface },
  rule: { flex: 1, height: 1, backgroundColor: colors.border },
  handle: { width: 50, color: colors.borderStrong, fontFamily: type.mono, fontSize: 10, textAlign: 'center' },
});
