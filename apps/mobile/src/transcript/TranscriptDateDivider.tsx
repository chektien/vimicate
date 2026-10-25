import { StyleSheet, Text, View } from 'react-native';
import { colors, type } from '../theme/tokens';
import { workspaceFontMetrics } from '../ui/workspaceTypography';

// Dates belong between source cells, never ahead of the text inside the
// following cell. Pagination may move a day boundary while native anchoring
// preserves that cell's origin; its readable content must not move within it.
export function TranscriptDateDivider({ label, fontScale, accessibilityLabel }: { label?: string | undefined; fontScale: number; accessibilityLabel?: string }) {
  if (!label) return null;
  return <View accessible accessibilityLabel={accessibilityLabel ?? label} style={styles.divider}><View style={styles.rule} />
    <Text style={[styles.label, workspaceFontMetrics(10, fontScale)]}>{label}</Text><View style={styles.rule} /></View>;
}
const styles = StyleSheet.create({
  divider: { minHeight: 31, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9 },
  rule: { flex: 1, height: 1, backgroundColor: 'rgba(168,153,132,0.22)' },
  label: { color: colors.faint, fontFamily: type.mono, fontSize: 10, fontWeight: '600' },
});
