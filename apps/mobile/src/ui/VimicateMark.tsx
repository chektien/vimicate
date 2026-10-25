import { StyleSheet, Text } from 'react-native';
import { colors, type } from '../theme/tokens';

/** The original compact Vimicate wordmark. */
export function VimicateMark() {
  return <Text accessible accessibilityLabel="Vimicate" numberOfLines={1} style={styles.brand}>vimicate</Text>;
}

const styles = StyleSheet.create({
  brand: { flexShrink: 0, color: colors.inkBright, fontFamily: type.mono, fontSize: 15, lineHeight: 18, fontWeight: '800', letterSpacing: 0.2 },
});
