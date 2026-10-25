import { StyleSheet, View, type GestureResponderHandlers } from 'react-native';
import { WORKSPACE_COLUMN_DIVIDER_WIDTH } from './workspaceColumns';
import { WORKSPACE_DIVIDER_HIT_SLOP } from './workspaceDividerGeometry';
import { WorkspaceDividerVisual } from './WorkspaceDividerVisual';

type WorkspaceColumnDividerProps = {
  side: 'projects' | 'files';
  width: number;
  panHandlers: GestureResponderHandlers;
  onResize: (direction: 1 | -1) => void;
};

export function WorkspaceColumnDivider({ side, width, panHandlers, onResize }: WorkspaceColumnDividerProps) {
  const label = side === 'projects' ? 'Projects and conversation divider' : 'Conversation and files divider';
  return <View
    accessible
    accessibilityRole="adjustable"
    accessibilityLabel={label}
    accessibilityValue={{ text: `${side === 'projects' ? 'Projects' : 'Files'} ${Math.round(width)} points` }}
    accessibilityActions={[
      { name: 'increment', label: `Make ${side} wider` },
      { name: 'decrement', label: `Make ${side} narrower` },
    ]}
    onAccessibilityAction={(event) => {
      if (event.nativeEvent.actionName === 'increment') onResize(1);
      if (event.nativeEvent.actionName === 'decrement') onResize(-1);
    }}
    hitSlop={{ left: WORKSPACE_DIVIDER_HIT_SLOP, right: WORKSPACE_DIVIDER_HIT_SLOP }}
    style={styles.root}
    {...panHandlers}
  >
    <WorkspaceDividerVisual orientation="vertical" />
  </View>;
}

const styles = StyleSheet.create({
  root: { width: WORKSPACE_COLUMN_DIVIDER_WIDTH, alignSelf: 'stretch' },
});
