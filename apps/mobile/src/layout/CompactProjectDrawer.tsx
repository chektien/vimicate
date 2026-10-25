import { type ReactNode, useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, PanResponder, Pressable, StyleSheet, View, type PanResponderInstance } from 'react-native';
import { colors } from '../theme/tokens';
import {
  COMPACT_DRAWER_ACTIVATION_SLOP,
  COMPACT_DRAWER_EDGE_REVEAL_WIDTH,
  createCompactDrawerMotion,
  type CompactDrawerIntent,
  type CompactDrawerMotion,
  type CompactDrawerSettlement,
} from './compactDrawerGesture';

// Decelerating rather than the default ease-in-out: the pane leaves the finger
// at speed and slows into place. An ease-in-out settle stands still for its
// first frames, which is what made a short transition read as slow drift.
const SETTLE_EASING = Easing.out(Easing.cubic);

type Live = { visible: boolean; width: number; onOpen: () => void; onDismiss: () => void };
type Engine = {
  translateX: Animated.Value;
  motion: CompactDrawerMotion;
  run: (settlement: CompactDrawerSettlement) => void;
  opening: PanResponderInstance;
  closing: PanResponderInstance;
};

export function CompactProjectDrawer({ visible, width, onOpen, onDismiss, children }: { visible: boolean; width: number; onOpen: () => void; onDismiss: () => void; children: ReactNode }) {
  // PanResponder keeps the accumulated `dx` of a live gesture in the closure
  // `create` builds, so rebuilding a responder mid-swipe throws that travel
  // away. The superseded owner memoized both responders on `onOpen`,
  // `onDismiss` and `width` — values the shell supplies fresh on every render —
  // so ordinary transcript traffic reset the drag and moved the trigger point
  // (BUG-282). Everything here is built exactly once and reads the current
  // props through `live`.
  const live = useRef<Live>({ visible, width, onOpen, onDismiss });
  const engine = useRef<Engine | null>(null);
  const settledVisible = useRef(visible);
  if (!engine.current) engine.current = createEngine(live);
  const { translateX, motion, run } = engine.current;
  useEffect(() => { live.current = { visible, width, onOpen, onDismiss }; });

  useEffect(() => {
    motion.resize(width);
    const target = visible ? 0 : -width;
    if (settledVisible.current !== visible) {
      settledVisible.current = visible;
      // A committed drag already started its settle on the frame the finger
      // lifted; only a keyboard, tap or Vim transition still needs one.
      if (motion.target() !== target) run(motion.settle(target, Date.now(), 0));
      return;
    }
    // Width alone moved — a rotation or an iPad Split View change. Reposition a
    // resting drawer instead of animating one nobody is looking at.
    if (motion.dragging() || motion.target() === target) return;
    translateX.setValue(motion.place(target));
  }, [motion, run, translateX, visible, width]);

  const progress = useMemo(() => translateX.interpolate({ inputRange: [-Math.max(1, width), 0], outputRange: [0, 1], extrapolate: 'clamp' }), [translateX, width]);
  const scrimStyle = useMemo(() => [styles.scrim, { opacity: progress }], [progress]);
  const drawerStyle = useMemo(() => [styles.drawer, { width, transform: [{ translateX }] }], [translateX, width]);
  return <>
    {!visible ? <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.edgeReveal} {...engine.current.opening.panHandlers} /> : null}
    <View pointerEvents={visible ? 'box-none' : 'none'} style={styles.overlay}>
      <Animated.View style={scrimStyle}><Pressable accessibilityRole="button" accessibilityLabel="Dismiss project switcher" onPress={onDismiss} style={StyleSheet.absoluteFill} /></Animated.View>
      <Animated.View style={drawerStyle} {...engine.current.closing.panHandlers}>{children}</Animated.View>
    </View>
  </>;
}

function createEngine(live: { current: Live }): Engine {
  const translateX = new Animated.Value(live.current.visible ? 0 : -live.current.width);
  const motion = createCompactDrawerMotion({ width: live.current.width, open: live.current.visible });
  const run = (settlement: CompactDrawerSettlement) => {
    Animated.timing(translateX, { toValue: settlement.target, duration: settlement.duration, easing: SETTLE_EASING, useNativeDriver: true }).start();
  };
  const responder = (intent: CompactDrawerIntent) => PanResponder.create({
    // A touch this gesture does not claim is left to the surface underneath.
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_event, gesture) => {
      const travel = intent === 'open' ? gesture.dx : -gesture.dx;
      return travel > COMPACT_DRAWER_ACTIVATION_SLOP && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.2;
    },
    // Once a decisively horizontal drag is claimed it is seen through, so a
    // scroll view inside the drawer cannot take the pane out of the finger.
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => {
      // Stop any settle first: it drives the same value natively and would
      // otherwise fight every frame of the drag.
      translateX.stopAnimation();
      motion.resize(live.current.width);
      translateX.setValue(motion.begin(Date.now()));
    },
    onPanResponderMove: (_event, gesture) => translateX.setValue(motion.track(gesture.dx, Date.now())),
    onPanResponderRelease: (_event, gesture) => {
      const settlement = motion.release(gesture.dx, Date.now(), intent);
      run(settlement);
      if (!settlement.commit) return;
      if (intent === 'open') live.current.onOpen(); else live.current.onDismiss();
    },
    onPanResponderTerminate: () => run(motion.cancel(Date.now(), intent)),
  });
  return { translateX, motion, run, opening: responder('open'), closing: responder('close') };
}

const styles = StyleSheet.create({
  edgeReveal: { position: 'absolute', zIndex: 20, left: 0, top: 0, bottom: 0, width: COMPACT_DRAWER_EDGE_REVEAL_WIDTH },
  overlay: { position: 'absolute', zIndex: 30, left: 0, top: 0, right: 0, bottom: 0 },
  scrim: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(29,32,33,0.68)' },
  drawer: { height: '100%', backgroundColor: colors.surface, shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 5, height: 0 }, elevation: 16 },
});
