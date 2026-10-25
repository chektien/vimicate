import { StyleSheet, View } from 'react-native';
import { colors } from '../theme/tokens';
import {
  WORKSPACE_DIVIDER_GRIP_LENGTH,
  WORKSPACE_DIVIDER_GRIP_THICKNESS,
} from './workspaceDividerGeometry';

export function WorkspaceDividerVisual({ orientation }: { orientation: 'horizontal' | 'vertical' }) {
  const horizontal = orientation === 'horizontal';
  return <View pointerEvents="none" style={styles.root}>
    <View style={[styles.grip, horizontal ? styles.horizontalGrip : styles.verticalGrip]} />
  </View>;
}

const styles = StyleSheet.create({
  root: { position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' },
  grip: { borderRadius: WORKSPACE_DIVIDER_GRIP_THICKNESS / 2, backgroundColor: colors.borderStrong },
  horizontalGrip: { width: WORKSPACE_DIVIDER_GRIP_LENGTH, height: WORKSPACE_DIVIDER_GRIP_THICKNESS },
  verticalGrip: { width: WORKSPACE_DIVIDER_GRIP_THICKNESS, height: WORKSPACE_DIVIDER_GRIP_LENGTH },
});
