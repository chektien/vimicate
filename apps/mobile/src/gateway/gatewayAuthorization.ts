import type { GatewayProfile } from './setupCode';

const OPTIONAL_OPERATOR_SCOPES = ['operator.approvals', 'operator.questions', 'operator.admin'] as const;

export function profileHasOperatorScope(profile: GatewayProfile | null, scope: string) {
  if (!profile) return false;
  const scopes: string[] = operatorScopesForProfile(profile);
  // The Gateway already authorizes questions under admin. Keep requested grants
  // unchanged and recognize that implication only for this capability check.
  return scopes.includes(scope) || scope === 'operator.questions' && scopes.includes('operator.admin');
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
