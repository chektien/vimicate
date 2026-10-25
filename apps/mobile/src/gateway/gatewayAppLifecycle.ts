export type GatewayAppLifecycleAction = 'none' | 'suspend' | 'resume';

/**
 * React Native's first AppState read can be unresolved while the component
 * renders. Effects may mount after iOS has already become active, without a
 * subsequent change event. Synchronize every lifecycle authority once at the
 * mount boundary instead of waiting for background/foreground to repair it.
 */
export function gatewayAppMountLifecycleAction(currentState: string): Exclude<GatewayAppLifecycleAction, 'none'> {
  return currentState === 'active' ? 'resume' : 'suspend';
}

export function gatewayAppLifecycleAction(nextState: string, suspendedByBackground: boolean): GatewayAppLifecycleAction {
  // iOS can spend a meaningful interval in `inactive` while transitioning to
  // Home, lock or another Stage Manager scene. Suspension must begin at that
  // boundary; waiting for `background` leaves already-scheduled React clocks
  // free to publish during the watchdog-sensitive scene update.
  if (nextState !== 'active' && !suspendedByBackground) return 'suspend';
  if (nextState === 'active' && suspendedByBackground) return 'resume';
  return 'none';
}

export function gatewayAllowsLivePublication(appActive: boolean, suspendedByBackground: boolean) {
  return appActive && !suspendedByBackground;
}
