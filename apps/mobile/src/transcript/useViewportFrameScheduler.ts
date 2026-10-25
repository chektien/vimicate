import { useInsertionEffect, useLayoutEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { ViewportFrameScheduler } from './viewportFrameScheduler';

/** One platform subscription for all of this viewport's coalesced frame slots. */
export function useViewportFrameScheduler(onActive?: () => void) {
  const activation = useRef(onActive);
  useInsertionEffect(() => { activation.current = onActive; }, [onActive]);
  const framesRef = useRef<ViewportFrameScheduler | null>(null);
  if (!framesRef.current) framesRef.current = new ViewportFrameScheduler(AppState.currentState === 'active');
  const frames = framesRef.current;
  useLayoutEffect(() => {
    frames.attach(AppState.currentState === 'active');
    let active = AppState.currentState === 'active';
    const subscription = AppState.addEventListener('change', next => {
      const resumed = !active && next === 'active';
      active = next === 'active';
      frames.setActive(active);
      if (resumed) activation.current?.();
    });
    return () => { subscription.remove(); frames.dispose(); };
  }, [frames]);
  return frames;
}
