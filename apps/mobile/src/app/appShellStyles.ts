import { StyleSheet } from 'react-native';
import { colors } from '../theme/tokens';

export const appShellStyles = StyleSheet.create({ root: { flex: 1, backgroundColor: colors.canvas }, safe: { flex: 1, backgroundColor: colors.canvas }, app: { flex: 1, backgroundColor: colors.canvas },
  main: { flex: 1, minHeight: 0, overflow: 'hidden', flexDirection: 'row' }, workspace: { flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden' }, workspaceBody: { flex: 1, minHeight: 0, overflow: 'hidden' } });
