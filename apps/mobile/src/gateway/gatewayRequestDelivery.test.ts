import { describe, expect, it } from 'vitest';
import { gatewayRequestFailure, gatewayRequestReachedGateway, gatewayResponseFailure, gatewayActiveRunInputNotice, gatewayRunTargetRefusal, gatewayQueueCandidate } from './gatewayRequestDelivery';

describe('gateway request delivery', () => {
  it('distinguishes a proven control refusal from an uncertain provider write', () => {
    expect(gatewayRequestReachedGateway(gatewayResponseFailure({ message: 'not injected', details: { inputDisposition: 'not-dispatched' } }))).toBe(false);
    expect(gatewayRequestReachedGateway(gatewayResponseFailure({ message: 'write unconfirmed', details: { inputDisposition: 'unconfirmed' } }))).toBe(true);
    expect(gatewayResponseFailure({ message: { invalid: true }, details: [] }).message).toBe('Gateway request failed');
  });
  it('explains an older Gateway schema refusal without retrying or claiming delivery', () => {
    const failure = gatewayResponseFailure({ code: 'INVALID_REQUEST', message: "invalid chat.send params: unexpected property 'steerPolicy'" });
    expect(failure.message).toContain('Gateway runtime update required');
    expect(gatewayRequestReachedGateway(failure)).toBe(false);
    expect(gatewayResponseFailure({ code: 'INVALID_REQUEST', message: 'invalid chat.send params: missing message' }).message).toContain('missing message');
  });
  it('carries the failure message unchanged', () => {
    expect(gatewayRequestFailure('Gateway disconnected', true).message).toBe('Gateway disconnected');
    expect(gatewayRequestFailure('Gateway is not connected', false)).toBeInstanceOf(Error);
  });

  it('separates a request that reached the Gateway from one that never left the app', () => {
    expect(gatewayRequestReachedGateway(gatewayRequestFailure('chat.send timed out', true))).toBe(true);
    expect(gatewayRequestReachedGateway(gatewayRequestFailure('Gateway is not connected', false))).toBe(false);
  });

  it('treats an unmarked failure as one that never reached the Gateway', () => {
    // Anything the transport did not raise cannot vouch for the frame, so the
    // caller keeps its existing refusal handling rather than assuming delivery.
    expect(gatewayRequestReachedGateway(new Error('chat.send timed out'))).toBe(false);
    expect(gatewayRequestReachedGateway('Gateway disconnected')).toBe(false);
    expect(gatewayRequestReachedGateway(undefined)).toBe(false);
  });
});


it.each(['tool_authority_mismatch', 'input_visibility_mismatch', 'run_not_ready'])('normalizes only confirmed %s input refusals', reason => {
  for (const inputDisposition of ['unconfirmed', undefined, 'unknown']) {
    const error = gatewayResponseFailure({ message: 'Original', details: { reason, inputDisposition, expectedActiveRunId: 'run', activeRunId: 'run' } });
    expect(gatewayActiveRunInputNotice(error)).toBeUndefined(); expect(error.message).toBe('Original');
  }
  const error = gatewayResponseFailure({ message: 'Original', details: { reason, inputDisposition: 'not-dispatched', expectedActiveRunId: 'run', activeRunId: 'run' } });
  expect(gatewayActiveRunInputNotice(error)).toBe(error.message);
  expect(error.message).not.toBe('Original'); expect(gatewayRunTargetRefusal(error)).toBeUndefined();
});
it.each([{}, { expectedActiveRunId: '' }, { expectedActiveRunId: 'run' }, { expectedActiveRunId: 'run', activeRunId: 'other' }])('does not claim readiness of an unidentified or different run: %j', ids => {
  const error = gatewayResponseFailure({ message: 'Original', details: { reason: 'run_not_ready', inputDisposition: 'not-dispatched', ...ids } });
  expect(gatewayActiveRunInputNotice(error)).toBeUndefined(); expect(error.message).toBe('Original');
});
it.each(['active_run_changed', 'no_active_run'])('retains identity recovery for older Gateway %s refusals', reason => {
  const error = gatewayResponseFailure({ message: 'Refresh this thread', details: { reason, inputDisposition: 'not-dispatched', expectedActiveRunId: 'run' } });
  expect(gatewayRunTargetRefusal(error)).toEqual({ reason, expectedActiveRunId: 'run' });
  expect(gatewayActiveRunInputNotice(error)).toBeUndefined();
});

it('offers a separate queued turn only for an exact confirmed permission mismatch', () => {
  const failure = gatewayResponseFailure({ code: 'INVALID_REQUEST', details: { reason: 'tool_authority_mismatch', inputDisposition: 'not-dispatched', expectedActiveRunId: 'cron', activeRunId: 'cron' } });
  expect(gatewayQueueCandidate(failure, 'cron')).toEqual({ reason: 'tool_authority_mismatch', expectedActiveRunId: 'cron', activeRunId: 'cron' });
  expect(gatewayQueueCandidate(failure, 'successor')).toBeUndefined();
});
it.each([
  { inputDisposition: 'unconfirmed' }, { inputDisposition: undefined }, { inputDisposition: 'unknown' },
  { activeRunId: 'successor' }, { activeRunId: undefined }, { expectedActiveRunId: '' },
  { reason: 'active_run_changed' }, { reason: 'unknown' },
])('never derives a queue candidate from unsafe or unrelated control refusals: %j', override => {
  const failure = gatewayResponseFailure({ code: 'INVALID_REQUEST', message: 'tool_authority_mismatch', details: {
    reason: 'tool_authority_mismatch', inputDisposition: 'not-dispatched', expectedActiveRunId: 'cron', activeRunId: 'cron', ...override,
  } });
  expect(gatewayQueueCandidate(failure, 'cron')).toBeUndefined();
});
it('requires structured refusal rather than text or an unknown error code', () => {
  expect(gatewayQueueCandidate(new Error('tool_authority_mismatch not-dispatched'))).toBeUndefined();
  expect(gatewayQueueCandidate(gatewayResponseFailure({ code: 'UNAVAILABLE', details: {
    reason: 'tool_authority_mismatch', inputDisposition: 'not-dispatched', expectedActiveRunId: 'cron', activeRunId: 'cron',
  } }))).toBeUndefined();
});

it.each(['tool_authority_mismatch', 'input_visibility_mismatch', 'run_not_ready', 'image_input_unsupported'])('qualifies only structured exact-target %s non-dispatch', reason => {
  const failure = gatewayResponseFailure({ code: 'INVALID_REQUEST', details: { reason, inputDisposition: 'not-dispatched', expectedActiveRunId: 'active', activeRunId: 'active' } });
  expect(gatewayQueueCandidate(failure, 'active')?.reason).toBe(reason);
  expect(gatewayQueueCandidate(failure, 'successor')).toBeUndefined();
  for (const inputDisposition of ['unconfirmed', undefined]) {
    expect(gatewayQueueCandidate(gatewayResponseFailure({ code: 'INVALID_REQUEST', details: { reason, inputDisposition, expectedActiveRunId: 'active', activeRunId: 'active' } }))).toBeUndefined();
  }
});
