import { describe, expect, it } from 'vitest';
import { operatorScopesForProfile, profileHasOperatorScope } from './gatewayAuthorization';

const base = { endpoint: 'wss://gateway.example', credential: 'token', sessionKey: 'session' };

describe('OpenClaw connect authorization', () => {
  it('reuses only the scopes approved for a shared paired-device token', () => {
    expect(operatorScopesForProfile({ ...base, credentialKind: 'deviceToken', scopes: ['operator.read', 'operator.approvals'] }))
      .toEqual(['operator.read', 'operator.write', 'operator.approvals']);
    expect(operatorScopesForProfile({ ...base, credentialKind: 'deviceToken', scopes: [] }))
      .toEqual(['operator.read', 'operator.write']);
  });

  it('requests the native bootstrap and advanced-token scope sets', () => {
    expect(operatorScopesForProfile({ ...base, credentialKind: 'bootstrapToken' }))
      .toEqual(['operator.read', 'operator.write', 'operator.approvals']);
    expect(operatorScopesForProfile({ ...base, credentialKind: 'token' }))
      .toEqual(['operator.read', 'operator.write', 'operator.approvals', 'operator.questions', 'operator.admin']);
  });

  it('does not treat a paired device token without admin as proposal authority', () => {
    expect(profileHasOperatorScope({ ...base, credentialKind: 'deviceToken', scopes: ['operator.read', 'operator.write'] }, 'operator.admin')).toBe(false);
    expect(profileHasOperatorScope({ ...base, credentialKind: 'deviceToken', scopes: ['operator.admin'] }, 'operator.admin')).toBe(true);
  });
});

it('requests questions only after device scope approval', () => {
  expect(operatorScopesForProfile({ ...base, credentialKind: 'deviceToken', scopes: ['operator.questions'] })).toEqual(['operator.read', 'operator.write', 'operator.questions']);
});
