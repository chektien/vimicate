export type MobileOperatorHandoff = { deviceToken: string; scopes: string[] };

export function operatorHandoffFromHello(payload: Record<string, unknown>): MobileOperatorHandoff {
  const auth = record(payload.auth);
  const candidates = Array.isArray(auth.deviceTokens) ? auth.deviceTokens : [];
  const operator = candidates.map(record).find((candidate) => candidate.role === 'operator');
  const deviceToken = typeof operator?.deviceToken === 'string' ? operator.deviceToken.trim() : '';
  const scopes = Array.isArray(operator?.scopes) ? operator.scopes.filter((scope): scope is string => typeof scope === 'string' && Boolean(scope.trim())) : [];
  if (!deviceToken) throw new Error('OpenClaw mobile bootstrap returned no operator handoff token.');
  return { deviceToken, scopes };
}

function record(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
