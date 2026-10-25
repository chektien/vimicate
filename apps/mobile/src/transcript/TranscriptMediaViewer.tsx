import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, FlatList, PanResponder, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, type } from '../theme/tokens';
import type { WorkspaceAttachment } from '../workspace/workspaceTypes';
import { GatewayImage } from './GatewayImage';
import { TranscriptImageShareButton } from './TranscriptImageShareButton';
import { mediaViewerDismissalGesture } from './mediaViewerDismissalGesture';

export function TranscriptMediaViewer({ attachments, initialID, onClose }: { attachments: WorkspaceAttachment[]; initialID: string; onClose: () => void }) {
  const images = attachments.filter((attachment) => attachment.mimeType.startsWith('image/') && attachment.uri);
  const initialIndex = Math.max(0, images.findIndex((attachment) => attachment.id === initialID));
  const [index, setIndex] = useState(initialIndex); const list = useRef<FlatList<WorkspaceAttachment>>(null); const { width, height } = useWindowDimensions(); const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(0)).current;
  const zoomScale = useRef(1);
  useEffect(() => { setIndex(initialIndex); translateY.setValue(0); zoomScale.current = 1; }, [initialID, initialIndex, translateY]);
  const go = (next: number) => { const bounded = Math.max(0, Math.min(next, images.length - 1)); setIndex(bounded); list.current?.scrollToIndex({ index: bounded, animated: true }); };
  const restore = () => Animated.spring(translateY, { toValue: 0, speed: 24, bounciness: 4, useNativeDriver: true }).start();
  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_event, gesture) => mediaViewerDismissalGesture({ ...gesture, height, zoomScale: zoomScale.current }).claim,
    onPanResponderGrant: () => translateY.stopAnimation(),
    onPanResponderMove: (_event, gesture) => translateY.setValue(mediaViewerDismissalGesture({ ...gesture, height, zoomScale: zoomScale.current }).offset),
    onPanResponderRelease: (_event, gesture) => {
      const result = mediaViewerDismissalGesture({ ...gesture, height, zoomScale: zoomScale.current });
      if (!result.dismiss) { restore(); return; }
      Animated.timing(translateY, { toValue: height, duration: 160, useNativeDriver: true }).start(({ finished }) => { if (finished) onClose(); });
    },
    onPanResponderTerminate: restore,
  }), [height, onClose, translateY]);
  const animatedOpacity = translateY.interpolate({ inputRange: [0, Math.max(1, height)], outputRange: [1, 0.2], extrapolate: 'clamp' });
  return <Animated.View {...panResponder.panHandlers} accessibilityViewIsModal style={[styles.root, { opacity: animatedOpacity, transform: [{ translateY }] }] }>
      <FlatList ref={list} horizontal pagingEnabled data={images} initialScrollIndex={initialIndex} keyExtractor={(item) => item.id} getItemLayout={(_, itemIndex) => ({ length: width, offset: width * itemIndex, index: itemIndex })} onMomentumScrollEnd={(event) => setIndex(Math.round(event.nativeEvent.contentOffset.x / Math.max(1, width)))} renderItem={({ item }) => <View style={{ width, height }}><ScrollView minimumZoomScale={1} maximumZoomScale={6} centerContent contentContainerStyle={styles.zoom} scrollEventThrottle={16} onScroll={(event) => { zoomScale.current = (event.nativeEvent as { zoomScale?: number }).zoomScale ?? 1; }}><GatewayImage attachment={item} style={{ width, height }} resizeMode="contain" /></ScrollView></View>} />
      <Pressable accessibilityRole="button" accessibilityLabel="Close image viewer" onPress={onClose} style={[styles.close, { top: insets.top + 12 }]}><Text style={styles.closeText}>×</Text></Pressable>
      {images[index] ? <TranscriptImageShareButton key={`${images[index]!.id}:${images[index]!.uri}`} attachment={images[index]!} top={insets.top + 12} /> : null}
      {images.length > 1 ? <View style={[styles.dots, { bottom: insets.bottom + 13 }]}>{images.map((image, dot) => <Pressable key={image.id} accessibilityRole="button" accessibilityLabel={`Image ${dot + 1} of ${images.length}`} accessibilityState={{ selected: dot === index }} onPress={() => go(dot)} style={styles.dotTarget}><View style={[styles.dot, dot === index && styles.dotSelected]} /></Pressable>)}</View> : null}
      <Text numberOfLines={1} style={[styles.filename, { top: insets.top + 25 }]}>{images[index]?.filename ?? 'image'}</Text>
      <Text pointerEvents="none" style={[styles.closeHint, { bottom: insets.bottom + 6 }]}>Esc or × to close</Text>
    </Animated.View>;
}

const styles = StyleSheet.create({
  root: { position: 'absolute', inset: 0, zIndex: 1_000, elevation: 1_000, backgroundColor: '#000' }, zoom: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  close: { position: 'absolute', right: 22, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.62)' }, closeText: { color: '#fff', fontFamily: type.mono, fontSize: 28, lineHeight: 31 },
  dots: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', paddingHorizontal: 7, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.62)' }, dotTarget: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.35)' }, dotSelected: { backgroundColor: '#fff' },
  filename: { position: 'absolute', left: 28, right: 130, color: colors.ink, fontFamily: type.mono, fontSize: 11 },
  closeHint: { position: 'absolute', right: 28, color: 'rgba(255,255,255,0.62)', fontFamily: type.mono, fontSize: 9 },
});
