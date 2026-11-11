type RecordValue = Record<string, unknown>;
type WeeklyOnlyAccount = { gatewayOrigin: string; provider: string; profileId: string };

/** Explicit account policy, not plan detection. Unknown identities retain ordinary windows. */
export async function readUsage(request: (method: string, params?: RecordValue, timeoutMs?: number) => Promise<unknown>, endpoint = '', policies?: unknown, now = Date.now()) {
  const configured = policies === undefined ? await effectivePolicies() : policies;
  const applicable = array(configured).filter(isPolicy).filter(policy => origin(endpoint) === origin(policy.gatewayOrigin));
  const readIdentity = () => request('models.authStatus', {}, 5000).catch(() => null);
  // Bracket usage with fresh selection reads. The native usage cache is itself
  // credential-bound. Public RPCs do not expose an atomic shared revision.
  const before = applicable.length ? await readIdentity() : null;
  const payload = await request('usage.status');
  if (!record(payload)) throw new Error('Invalid provider usage response');
  const candidates = applicable.filter(policy => identityMatches(before, policy, now));
  if (!candidates.length) return payload;
  const after = await readIdentity();
  const weeklyOnly = candidates.filter(policy => identityMatches(after, policy, now));
  if (!weeklyOnly.length || !Array.isArray(payload.providers)) return payload;
  return { ...payload, providers: payload.providers.map(value => {
    if (!record(value) || !weeklyOnly.some(policy => policy.provider === value.provider) || !Array.isArray(value.windows)) return value;
    return { ...value, windows: value.windows.filter(window => !record(window) || typeof window.label !== 'string' || window.label.trim().toLowerCase() !== '5h') };
  }) };
}

async function effectivePolicies(): Promise<unknown> {
  try { return (await import('expo-constants')).default.expoConfig?.extra?.weeklyOnlyQuotaAccounts; }
  catch { return undefined; }
}

function identityMatches(auth: unknown, policy: WeeklyOnlyAccount, now: number) {
  if (!record(auth) || typeof auth.ts !== 'number' || !Number.isFinite(auth.ts) || Math.abs(now - auth.ts) > 60000) return false;
  const providers = array(auth.providers).filter(record).filter(row => row.provider === policy.provider);
  if (providers.length !== 1) return false;
  const provider = providers[0]!;
  const order = array(provider.profileOrder);
  if (order.length !== 1 || order[0] !== policy.profileId) return false;
  const profiles = array(provider.profiles).filter(record).filter(row => row.profileId === policy.profileId);
  return profiles.length === 1 && ['oauth', 'token'].includes(String(profiles[0]!.type))
    && ['ok', 'static'].includes(String(profiles[0]!.status));
}

function isPolicy(value: unknown): value is WeeklyOnlyAccount {
  return record(value) && typeof value.gatewayOrigin === 'string' && (origin(value.gatewayOrigin) === value.gatewayOrigin
    || /^wss?:\/\/\[[0-9a-f:.]+\](?::\d{1,5})?$/.test(value.gatewayOrigin) && origin(value.gatewayOrigin) !== null)
    && typeof value.provider === 'string' && value.provider.length > 0
    && typeof value.profileId === 'string' && value.profileId.length > 0;
}
/** React Native's URL reports an origin only for http(s), so read the
 * WebSocket authority directly. Credentials and malformed ports never match. */
function origin(endpoint: string) {
  const match = /^(wss?):\/\/([^/?#@\s]+)(?:[/?#]|$)/i.exec(endpoint);
  if (!match) return null;
  const scheme = match[1]!.toLowerCase();
  const authority = /^(?:\[([0-9a-f:.]+)\]|([^:\[\]]+))(?::(\d{1,5}))?$/i.exec(match[2]!);
  if (!authority) return null;
  const host = authority[1] === undefined ? authority[2]!.toLowerCase() : canonicalIPv6(authority[1]);
  if (!host) return null;
  const port = authority[3] === undefined ? '' : String(Number(authority[3]));
  return `${scheme}://${host}${port && port !== (scheme === 'wss' ? '443' : '80') ? `:${port}` : ''}`;
}

/** One spelling per IPv6 address: zero-padded hextets, no compression. */
function canonicalIPv6(address: string) {
  // An embedded IPv4 suffix is the last two hextets in dotted form.
  const octet = '(0|[1-9]\\d{0,2})';
  const dotted = new RegExp(`^(.*:)${octet}\\.${octet}\\.${octet}\\.${octet}$`).exec(address);
  if (dotted) {
    const bytes = dotted.slice(2).map(Number);
    if (bytes.some(byte => byte > 255)) return null;
    address = `${dotted[1]}${((bytes[0]! << 8) | bytes[1]!).toString(16)}:${((bytes[2]! << 8) | bytes[3]!).toString(16)}`;
  } else if (address.includes('.')) return null;
  const halves = address.toLowerCase().split('::');
  if (halves.length > 2) return null;
  const groups = (half: string) => half ? half.split(':') : [];
  const head = groups(halves[0]!); const tail = halves.length === 2 ? groups(halves[1]!) : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const all = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  return all.every(group => /^[0-9a-f]{1,4}$/.test(group)) ? `[${all.map(group => group.padStart(4, '0')).join(':')}]` : null;
}
function record(value: unknown): value is RecordValue { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
