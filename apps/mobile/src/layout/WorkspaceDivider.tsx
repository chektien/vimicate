import { StyleSheet, View, type GestureResponderHandlers } from 'react-native';
import { WORKSPACE_DIVIDER_HEIGHT } from './workspaceSplit';
import { WORKSPACE_DIVIDER_HIT_SLOP } from './workspaceDividerGeometry';
import { WorkspaceDividerVisual } from './WorkspaceDividerVisual';

export function WorkspaceDivider({ promptHeight, panHandlers, onResize }: { promptHeight: number; panHandlers: GestureResponderHandlers; onResize: (direction: 1 | -1) => void }) {
  return <View
    accessible
    accessibilityRole="adjustable"
    accessibilityLabel="Transcript and prompt divider"
    accessibilityValue={{ text: `Prompt ${Math.round(promptHeight)} points` }}
    accessibilityActions={[{ name: 'increment', label: 'Make prompt larger' }, { name: 'decrement', label: 'Make prompt smaller' }]}
    onAccessibilityAction={(event) => onResize(event.nativeEvent.actionName === 'increment' ? 1 : -1)}
    hitSlop={{ top: WORKSPACE_DIVIDER_HIT_SLOP, bottom: WORKSPACE_DIVIDER_HIT_SLOP }}
    style={styles.root}
    {...panHandlers}
  ><WorkspaceDividerVisual orientation="horizontal" /></View>;
}

const styles = StyleSheet.create({
  root: { height: WORKSPACE_DIVIDER_HEIGHT },
});
