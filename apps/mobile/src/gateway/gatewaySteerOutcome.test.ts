import { describe, expect, it } from 'vitest';
import { gatewaySteerOutcome, gatewaySteerOutcomeNotice } from './gatewaySteerOutcome';

describe('gateway steer outcome', () => {
  it('reports each acknowledged disposition', () => {
    expect(gatewaySteerOutcomeNotice({ runId: 'r', status: 'started', steerOutcome: 'steered' })).toBe('Message accepted into the running task. Do not resend. Watch this conversation for the response.');
    expect(gatewaySteerOutcomeNotice({ steerOutcome: 'not-steered' })).toBe('Message accepted for its own turn after the current task. It will run automatically. Do not resend.');
  });
  it('never guesses when the Gateway did not report a known disposition', () => {
    for (const payload of [undefined, null, [], {}, { steerOutcome: 'queued' }, { steerOutcome: true }]) {
      expect(gatewaySteerOutcome(payload)).toBeUndefined();
      expect(gatewaySteerOutcomeNotice(payload)).toContain('did not report');
    }
  });
});
