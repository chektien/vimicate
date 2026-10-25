import { describe, expect, it } from 'vitest';
import { gatewayCommandIsRunSafe, gatewayCommandRunsDisconnected, shouldRefreshHistoryAfterCommand } from './gatewayCommandPolicy';

describe('active-run command policy', () => {
  it('keeps status and thinking controls available during a turn', () => {
    expect(gatewayCommandIsRunSafe(':status')).toBe(true);
    expect(gatewayCommandIsRunSafe(':diagnostics')).toBe(true);
    expect(gatewayCommandIsRunSafe(':interrupt')).toBe(true);
    expect(gatewayCommandIsRunSafe(':think')).toBe(true);
    expect(gatewayCommandIsRunSafe('models')).toBe(true);
    expect(gatewayCommandIsRunSafe(':new')).toBe(false);
  });

  it('keeps only recovery and retained diagnostics available while disconnected', () => {
    expect(gatewayCommandRunsDisconnected(':diagnostics')).toBe(true);
    expect(gatewayCommandRunsDisconnected(':reconnect')).toBe(true);
    expect(gatewayCommandRunsDisconnected(':repair')).toBe(true);
    expect(gatewayCommandRunsDisconnected(':status')).toBe(false);
    expect(gatewayCommandRunsDisconnected(':interrupt')).toBe(false);
    expect(gatewayCommandRunsDisconnected('ordinary prompt')).toBe(false);
  });

  it('does not race canonical history against an active run-safe command', () => {
    expect(shouldRefreshHistoryAfterCommand(true)).toBe(false);
    expect(shouldRefreshHistoryAfterCommand(false)).toBe(true);
  });
});
