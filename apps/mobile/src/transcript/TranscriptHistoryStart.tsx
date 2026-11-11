import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, type } from '../theme/tokens';
import { TRANSCRIPT_VERTICAL_INSET } from './transcriptPaneGeometry';
import { TranscriptDateDivider } from './TranscriptDateDivider';
import { TranscriptHistoryOmission } from './TranscriptHistoryOmission';

export function TranscriptHistoryStart({ loading, problem, canLoad, fontScale, date, omission, onRetry, onLoad }: {
  loading: boolean; problem?: string | undefined; canLoad: boolean; fontScale: number;
  date?: string | undefined; omission: boolean; onRetry: () => unknown; onLoad: () => unknown;
}) {
  return <><View style={styles.topSlot}>{loading ? null : problem
    ? <Pressable accessibilityRole="button" accessibilityLabel={`Retry transcript history: ${problem}`} onPress={onRetry}>
      <Text numberOfLines={2} style={styles.error}>{`history unavailable · ${problem} · tap to retry`}</Text></Pressable>
    : canLoad ? <Pressable accessibilityRole="button" accessibilityLabel="Load older transcript history" onPress={onLoad} style={styles.action}>
      <Text style={styles.actionText}>↑ Load older history</Text><Text style={styles.hint}>pull down · tap · k again at top</Text></Pressable> : null}
  </View><TranscriptDateDivider label={date} fontScale={fontScale} />
    {omission ? <TranscriptHistoryOmission fontScale={fontScale} onLoadOlder={onLoad} /> : null}</>;
}
const styles = StyleSheet.create({
  topSlot: { minHeight: 34, paddingVertical: TRANSCRIPT_VERTICAL_INSET, justifyContent: 'center' },
  action: { alignSelf: 'center', minHeight: 24, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, borderRadius: 5, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.inset },
  actionText: { color: colors.yellow, fontFamily: type.mono, fontSize: 9, fontWeight: '700' },
  hint: { color: colors.faint, fontFamily: type.mono, fontSize: 8 },
  error: { color: colors.red, fontFamily: type.mono, fontSize: 9, textAlign: 'center' },
});
