import { describe, expect, it } from 'vitest';
import { gatewaySteerOutcome, gatewaySteerOutcomeNotice } from './gatewaySteerOutcome';

describe('gateway steer outcome', () => {
  it('reports each acknowledged disposition', () => {
    expect(gatewaySteerOutcomeNotice({ runId: 'r', status: 'started', steerOutcome: 'steered' })).toBe('Steered into the running turn.');
    expect(gatewaySteerOutcomeNotice({ steerOutcome: 'not-steered' })).toBe('Could not steer. Queued to run as its own turn after the current one.');
  });
  it('never guesses when the Gateway did not report a known disposition', () => {
    for (const payload of [undefined, null, [], {}, { steerOutcome: 'queued' }, { steerOutcome: true }]) {
      expect(gatewaySteerOutcome(payload)).toBeUndefined();
      expect(gatewaySteerOutcomeNotice(payload)).toContain('did not report');
    }
  });
});
