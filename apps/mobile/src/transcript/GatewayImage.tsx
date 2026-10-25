import { Image, Pressable, StyleSheet, Text, View, type ImageStyle, type StyleProp } from 'react-native';
import { colors, type } from '../theme/tokens';
import type { WorkspaceAttachment } from '../workspace/workspaceTypes';
import { useGatewayImage } from './useGatewayImage';

export function GatewayImage({ attachment, style, resizeMode = 'cover' }: { attachment: WorkspaceAttachment; style: StyleProp<ImageStyle>; resizeMode?: 'cover' | 'contain' }) {
  const { source, phase, imageKey, retryImage, onLoad, onError } = useGatewayImage(attachment);
  if (phase === 'failed') return <Pressable accessibilityRole="button" accessibilityLabel={`Retry unavailable image ${attachment.filename}`} accessibilityHint="Retries the Gateway or links its host folder through iOS Files" onPress={(event) => { event.stopPropagation(); retryImage(); }} style={[styles.placeholder, style]}><Text style={styles.icon}>▧</Text><Text style={styles.text}>image unavailable · tap to retry or link Files</Text></Pressable>;
  if (phase === 'resolving' || !source.uri) return <View accessibilityLabel={`Resolving image ${attachment.filename}`} style={[styles.resolving, style]}><Text style={styles.text}>resolving image…</Text></View>;
  return <View style={style}><Image key={imageKey} source={source} style={StyleSheet.absoluteFill} resizeMode={resizeMode} onLoad={onLoad} onError={onError} />{phase === 'loading' ? <View pointerEvents="none" style={styles.loading}><Text style={styles.text}>loading image…</Text></View> : null}</View>;
}

const styles = StyleSheet.create({
  placeholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.canvas },
  resolving: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.canvas }, loading: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.canvas },
  icon: { color: colors.faint, fontFamily: type.mono, fontSize: 24 }, text: { marginTop: 4, color: colors.faint, fontFamily: type.mono, fontSize: 9 },
});
