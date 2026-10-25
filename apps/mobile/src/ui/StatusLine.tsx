import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, type } from '../theme/tokens';
import type { ProviderQuotaPresentation } from '../gateway/providerQuota';
import { statusLineVisibility } from './statusLineVisibility';
import { STATUS_LINE_LEFT_INSET, STATUS_LINE_RIGHT_INSET } from './statusLineGeometry';

export function StatusLine({ mode, path, branch, detail, quota, onRefreshQuota, usage, position, compact = false }: { mode: string; path: string; branch: string; detail: string; quota?: ProviderQuotaPresentation | null; onRefreshQuota?: () => void; usage?: string; position: string; compact?: boolean }) {
  const visibility = statusLineVisibility(compact);
  return (
    <ScrollView horizontal directionalLockEnabled focusable={false} keyboardDismissMode="none" keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false} style={styles.viewport} contentContainerStyle={styles.root}>
      <Text style={[styles.mode, mode === 'insert' ? styles.insertMode : mode.startsWith('visual') ? styles.visualMode : styles.normalMode]}>{mode}</Text>
      {visibility.path ? <Text numberOfLines={1} style={styles.path}>{path}</Text> : null}
      {visibility.branch && branch && branch !== '—' ? <Text style={styles.branch}>branch {branch}</Text> : null}
      <View style={styles.spacer} />
      <Text numberOfLines={1} style={[styles.detail, compact && styles.detailCompact]}>{detail}</Text>
      {visibility.quota && quota ? <Pressable accessibilityRole="button" accessibilityLabel={`Provider quota ${quota.text}`} accessibilityHint="Refresh provider quota" hitSlop={6} onPress={onRefreshQuota} style={styles.quotaControl}><Text numberOfLines={1} style={[styles.quota, quota.tone === 'warning' && styles.quotaWarning, quota.tone === 'unavailable' && styles.quotaUnavailable]}>{quota.text}</Text></Pressable> : null}
      {usage ? <Text numberOfLines={1} style={styles.usage}>{usage}</Text> : null}
      {visibility.position ? <Text style={styles.position}>{position}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  viewport: { height: 26 }, root: { flexGrow: 1, height: 26, flexDirection: 'row', alignItems: 'center', gap: 11, paddingLeft: STATUS_LINE_LEFT_INSET, paddingRight: STATUS_LINE_RIGHT_INSET },
  mode: { minWidth: 58, paddingHorizontal: 7, paddingVertical: 2, color: colors.canvas, fontFamily: type.mono, fontSize: 10, fontWeight: '800', textAlign: 'center' }, insertMode: { backgroundColor: colors.activeAccent }, normalMode: { backgroundColor: colors.ink }, visualMode: { backgroundColor: colors.yellow },
  path: { color: colors.ink, fontFamily: type.mono, fontSize: 10 }, branch: { color: colors.activeAccent, fontFamily: type.mono, fontSize: 10 }, spacer: { flex: 1 }, detail: { color: colors.inkMuted, fontFamily: type.mono, fontSize: 10 }, detailCompact: { textAlign: 'right' }, usage: { flexShrink: 0, color: colors.faint, fontFamily: type.mono, fontSize: 10 }, position: { color: colors.inkMuted, fontFamily: type.mono, fontSize: 10 },
  quotaControl: { flexShrink: 0 }, quota: { color: colors.faint, fontFamily: type.mono, fontSize: 10 }, quotaWarning: { color: colors.orange }, quotaUnavailable: { color: colors.faint },
});
