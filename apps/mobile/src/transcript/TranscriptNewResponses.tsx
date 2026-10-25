import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, type } from '../theme/tokens';

export function TranscriptNewResponses({ onPress, history = false }: { onPress: () => void; history?: boolean }) {
  return <View pointerEvents="box-none" style={styles.position}>
    <Pressable accessibilityRole="button" accessibilityLabel={history ? 'Older history — jump to latest' : 'New responses — jump to latest'}
      onPress={onPress} style={styles.button}>
      <Text style={styles.text}>{history ? '↓ Jump to latest' : '↓ New responses'}</Text>
    </Pressable>
  </View>;
}
const styles = StyleSheet.create({
  position: { position: 'absolute', bottom: 8, left: 0, right: 0, alignItems: 'center' },
  button: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 18,
    backgroundColor: colors.inset, borderColor: colors.yellow, borderWidth: 1 },
  text: { fontFamily: type.mono, fontSize: 11, color: colors.yellow },
});
