import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, type } from '../theme/tokens';

/** A bounded review edge must never masquerade as the conversation's end. */
export function TranscriptHistoryEnd({ onPress, onLoadNewer, loadingNewer, problem }: { onPress: () => void; onLoadNewer?: (() => unknown) | undefined; loadingNewer?: boolean; problem?: string | undefined }) {
  return <View style={styles.root}>
    <Text style={styles.text}>Newer messages are available</Text>
    {onLoadNewer ? <Pressable accessibilityRole="button" accessibilityLabel="Load newer transcript history"
      disabled={loadingNewer} onPress={onLoadNewer} style={styles.action}>
      <Text style={styles.actionText}>{loadingNewer ? 'loading newer history…' : '↓ Load newer history · j again at end'}</Text>
    </Pressable> : null}
    {problem ? <Text style={styles.error}>Latest history unavailable · try again</Text> : null}
    <Pressable accessibilityRole="button" accessibilityLabel="Jump to latest transcript messages"
      onPress={onPress} style={styles.action}>
      <Text style={styles.actionText}>↓ Jump to latest · G</Text>
    </Pressable>
  </View>;
}
const styles = StyleSheet.create({
  root: { alignItems: 'center', paddingTop: 12, paddingBottom: 56, gap: 6 },
  text: { fontFamily: type.mono, color: colors.inkMuted, fontSize: 11 },
  error: { fontFamily: type.mono, color: colors.red, fontSize: 10 },
  action: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 12 },
  actionText: { fontFamily: type.mono, color: colors.yellow, fontSize: 11 },
});
