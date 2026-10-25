import { describe, expect, it } from 'vitest';
import { gatewayAllowsLivePublication, gatewayAppLifecycleAction, gatewayAppMountLifecycleAction } from './gatewayAppLifecycle';

describe('Gateway app lifecycle policy', () => {
  it('synchronizes history authority to the scene state observed when the mount effect runs', () => {
    // React Native may expose an unresolved AppState during render and `active`
    // by the time effects mount. The mount boundary must explicitly resume;
    // waiting for a later change event strands cold history until bg/fg.
    expect(gatewayAppMountLifecycleAction('active')).toBe('resume');
    expect(gatewayAppMountLifecycleAction('inactive')).toBe('suspend');
    expect(gatewayAppMountLifecycleAction('background')).toBe('suspend');
    expect(gatewayAppMountLifecycleAction('unknown')).toBe('suspend');
  });

  it('suspends as soon as the scene becomes inactive and reconnects only after that suspension', () => {
    expect(gatewayAppLifecycleAction('inactive', false)).toBe('suspend');
    expect(gatewayAppLifecycleAction('background', false)).toBe('suspend');
    expect(gatewayAppLifecycleAction('background', true)).toBe('none');
    expect(gatewayAppLifecycleAction('active', true)).toBe('resume');
    expect(gatewayAppLifecycleAction('active', false)).toBe('none');
  });

  it('rejects late Gateway frames throughout inactive and suspended states', () => {
    expect(gatewayAllowsLivePublication(true, false)).toBe(true);
    expect(gatewayAllowsLivePublication(false, false)).toBe(false);
    expect(gatewayAllowsLivePublication(false, true)).toBe(false);
    expect(gatewayAllowsLivePublication(true, true)).toBe(false);
  });
});
