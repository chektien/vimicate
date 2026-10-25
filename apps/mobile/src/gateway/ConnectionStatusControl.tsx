import { Image, Pressable, StyleSheet, View } from 'react-native';
import { colors } from '../theme/tokens';
import { headerGlyphStyles } from '../ui/headerGlyphStyles';
import type { PairingStatusTone } from './pairingPresentation';

const statusColors: Record<PairingStatusTone, string> = {
  neutral: colors.inkMuted,
  pending: colors.yellow,
  success: colors.activeAccent,
  warning: colors.orange,
  danger: colors.red,
};

export function ConnectionStatusControl({ expanded, label, tone, onPress }: { expanded: boolean; label: string; tone: PairingStatusTone; onPress: () => void }) {
  const color = statusColors[tone];
  const connected = tone === 'success';
  return <Pressable accessibilityRole="button" accessibilityLabel={`Gateway ${label}`} accessibilityHint={`${expanded ? 'Hide' : 'Show'} Gateway connection settings`} accessibilityState={{ expanded, busy: tone === 'pending' }} onPress={onPress} hitSlop={{ left: 8, right: 8 }} style={({ pressed }) => [styles.connectionControl, pressed && styles.pressed]}>
    <View accessible={false} style={styles.connectionGlyph}>
      <Image accessible={false} source={connected ? require('../../assets/connection/plug-connected.png') : require('../../assets/connection/plug-disconnected.png')} resizeMode="contain" style={[styles.plug, { tintColor: color }]} />
      {tone === 'pending' ? <View style={[styles.connectionPending, { backgroundColor: color }]} /> : null}
      {tone === 'danger' ? <View style={[styles.connectionFault, { backgroundColor: color }]} /> : null}
    </View>
    {expanded ? <View accessible={false} style={styles.expandedMarker} /> : null}
  </Pressable>;
}

const styles = StyleSheet.create({
  connectionControl: { ...headerGlyphStyles.slot, width: 28 },
  pressed: { backgroundColor: colors.raised },
  connectionGlyph: { width: 24, height: 18, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  plug: { width: 30, height: 20 },
  connectionPending: { position: 'absolute', bottom: 1, width: 2, height: 2, borderRadius: 1 },
  connectionFault: { position: 'absolute', width: 1, height: 10, transform: [{ rotate: '35deg' }] },
  expandedMarker: { position: 'absolute', bottom: 1, width: 12, height: 2, borderRadius: 1, backgroundColor: colors.activeAccent },
});
