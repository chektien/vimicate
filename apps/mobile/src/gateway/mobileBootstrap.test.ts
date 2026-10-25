import { describe, expect, it } from 'vitest';
import { operatorHandoffFromHello } from './mobileBootstrapPayload';

describe('OpenClaw mobile bootstrap handoff', () => {
  it('selects the bounded operator token instead of persisting the primary node token', () => {
    expect(operatorHandoffFromHello({ auth: {
      role: 'node', deviceToken: 'node-secret', scopes: [],
      deviceTokens: [{ role: 'operator', deviceToken: 'operator-secret', scopes: ['operator.read', 'operator.write'] }],
    } })).toEqual({ deviceToken: 'operator-secret', scopes: ['operator.read', 'operator.write'] });
  });

  it('fails closed when a setup-code hello omits the operator handoff', () => {
    expect(() => operatorHandoffFromHello({ auth: { role: 'node', deviceToken: 'node-secret', scopes: [] } })).toThrow('no operator handoff token');
  });
});
