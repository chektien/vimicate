import type { GatewayProfile } from './setupCode';

const OPTIONAL_OPERATOR_SCOPES = ['operator.approvals', 'operator.questions', 'operator.admin'] as const;

export function profileHasOperatorScope(profile: GatewayProfile | null, scope: string) {
  if (!profile) return false;
  return (operatorScopesForProfile(profile) as string[]).includes(scope);
}

export function operatorScopesForProfile(profile: GatewayProfile) {
  const scopes = ['operator.read', 'operator.write'];
  if (profile.credentialKind === 'token') scopes.push(...OPTIONAL_OPERATOR_SCOPES);
  if (profile.credentialKind === 'bootstrapToken') scopes.push('operator.approvals');
  if (profile.credentialKind === 'deviceToken') {
    for (const scope of OPTIONAL_OPERATOR_SCOPES) if (profile.scopes?.includes(scope)) scopes.push(scope);
  }
  return scopes;
}
