import { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, AppState, Easing } from 'react-native';

// One rail-owned native animation, not one loop or JS frame callback per row.
// Keep enough orange visible at the trough, including under the rail's dim veil.
export const PROJECT_RUN_PULSE_MIN_OPACITY = 0.55;
export const PROJECT_RUN_PULSE_CYCLE_MS = 1000;

export function useProjectRunPulse(enabled: boolean) {
  const [opacity] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let active = AppState.currentState === 'active';
    let reduceMotion = true; // Stay still until the accessibility setting is known.
    let settingChanged = false;
    let animation: Animated.CompositeAnimation | undefined;
    const stop = () => {
      animation?.stop(); animation = undefined;
      opacity.setValue(1);
    };
    const sync = () => {
      if (disposed || !active || reduceMotion) { stop(); return; }
      if (animation) return;
      const step = (toValue: number) => Animated.timing(opacity, {
        toValue, duration: PROJECT_RUN_PULSE_CYCLE_MS / 2,
        easing: Easing.inOut(Easing.ease), useNativeDriver: true, isInteraction: false,
      });
      animation = Animated.loop(Animated.sequence([step(PROJECT_RUN_PULSE_MIN_OPACITY), step(1)]));
      animation.start();
    };
    const scene = AppState.addEventListener('change', state => { active = state === 'active'; sync(); });
    const accessibility = AccessibilityInfo.addEventListener('reduceMotionChanged', value => {
      settingChanged = true; reduceMotion = value; sync();
    });
    void AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (disposed || settingChanged) return;
      reduceMotion = value; sync();
    }).catch(() => { /* Unknown accessibility preference stays still. */ });
    return () => { disposed = true; scene.remove(); accessibility.remove(); stop(); };
  }, [enabled, opacity]);
  return opacity;
}
