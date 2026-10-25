import { expect, it } from 'vitest';
import { GatewayInputRefusalEcho, gatewayInputRefusalScope } from './gatewayInputRefusalEcho';

const scope = { sessionKey: 'qa', runId: 'submission', expectedActiveRunId: 'cron' };
const response = { ok: false, payload: { runId: 'submission', status: 'error' }, error: { code: 'INVALID_REQUEST', message: 'Permissions differ.',
  details: { reason: 'tool_authority_mismatch', inputDisposition: 'not-dispatched', expectedActiveRunId: 'cron', activeRunId: 'cron' } } };
const frame = { type: 'event', event: 'chat', payload: { sessionKey: 'qa', runId: 'submission', state: 'error', errorMessage: 'ActiveSteerRejectedError: Permissions differ.' } };

it('requires the exact structured refusal, operation, session and error echo', () => {
  const owner = new GatewayInputRefusalEcho();
  expect(owner.matches(frame, 0)).toBe(false);
  owner.record(scope, response, 0);
  expect(owner.matches(frame, 1)).toBe(true);
  for (const patch of [{ sessionKey: 'other' }, { runId: 'cron' }, { state: 'final' }, { errorMessage: 'provider error' }]) {
    expect(owner.matches({ ...frame, payload: { ...frame.payload, ...patch } }, 1)).toBe(false);
  }
  expect(owner.matches({ ...frame, event: 'agent' }, 1)).toBe(false);
});
it.each([
  { ...response, ok: true }, { ...response, payload: { runId: 'other' } }, { ...response, error: { message: response.error.message } },
  ...[{ inputDisposition: 'unconfirmed' }, { expectedActiveRunId: 'other' }, { activeRunId: 'other' }, { reason: 'provider_error' }]
    .map(details => ({ ...response, error: { ...response.error, details: { ...response.error.details, ...details } } })),
])('does not hide an unproven refusal: %j', value => {
  const owner = new GatewayInputRefusalEcho(); owner.record(scope, value, 0);
  expect(owner.matches(frame, 1)).toBe(false);
});
it('expires and retires matches, with a bounded oldest-first window', () => {
  const owner = new GatewayInputRefusalEcho(); owner.record(scope, response, 0);
  expect(owner.matches(frame, 60_000)).toBe(false);
  owner.record(scope, response, 60_001); owner.clear();
  expect(owner.matches(frame, 60_002)).toBe(false);
  owner.record(scope, response, 60_003);
  for (let i = 0; i < 64; i++) owner.record({ ...scope, runId: `other-${i}` }, { ...response, payload: { runId: `other-${i}` } }, 60_004);
  expect(owner.matches(frame, 60_005)).toBe(false);
});
it('retains only strict send identities, not content or unrelated request types', () => {
  const params = { sessionKey: 'qa', idempotencyKey: 'submission', expectedActiveRunId: 'cron', queueMode: 'steer', steerPolicy: 'require-active', message: 'private' };
  expect(gatewayInputRefusalScope('chat.send', params)).toEqual(scope);
  for (const patch of [{ queueMode: 'followup' }, { steerPolicy: undefined }, { expectedActiveRunId: '' }, { sessionKey: null }]) {
    expect(gatewayInputRefusalScope('chat.send', { ...params, ...patch })).toBeUndefined();
  }
  expect(gatewayInputRefusalScope('chat.history', params)).toBeUndefined();
});
