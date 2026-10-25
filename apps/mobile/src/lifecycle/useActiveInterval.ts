import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { ActiveIntervalController } from './activeIntervalController';

/**
 * iOS may keep JavaScript alive briefly while an already-started persistence
 * write finishes. That lease must not admit quota, clock or other unrelated
 * periodic work after the app becomes inactive.
 */
export function useActiveInterval(
  callback: () => void,
  intervalMs: number,
  enabled = true,
  runOnActivation = false,
  activationKey?: unknown,
) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    // Outer lifecycle owners can resume their publication authority later in
    // the same AppState dispatch. Admit activation work only after every
    // listener has observed that boundary; the controller cancels the queued
    // callback if suspension or disposal wins first.
    const controller = new ActiveIntervalController(
      () => callbackRef.current(),
      intervalMs,
      undefined,
      queueMicrotask,
    );
    controller.sync(AppState.currentState === 'active', enabled, runOnActivation);
    const subscription = AppState.addEventListener('change', (next) => {
      controller.sync(next === 'active', enabled, runOnActivation);
    });
    return () => {
      subscription.remove();
      controller.dispose();
    };
  }, [activationKey, enabled, intervalMs, runOnActivation]);
}
