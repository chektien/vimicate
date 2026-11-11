import { describe, expect, it, vi } from 'vitest';
import { readUsage } from './providerUsagePolicy';
import { providerQuotaForProject } from './providerQuota';

const now = Date.UTC(2026, 10, 10);
const endpoint = 'wss://home.example/socket';
const policies = [{ gatewayOrigin: 'wss://home.example', provider: 'anthropic', profileId: 'anthropic:home' }];
const usage = () => ({ updatedAt: now, providers: [
  { provider: 'anthropic', observedAt: now - 120000, source: 'cli-rate-limit-event', windows: [
    { label: '5h', usedPercent: 99, resetAt: now + 3600000 }, { label: 'Week', usedPercent: 20 },
  ] },
  { provider: 'openai', windows: [{ label: '5h', usedPercent: 50 }] },
] });
const auth = (profileOrder: unknown = ['anthropic:home']) => ({ ts: now, providers: [{
  provider: 'anthropic', profileOrder,
  profiles: [{ profileId: 'anthropic:home', type: 'token', status: 'static' }],
}] });
function fixture(identity: unknown = auth(), target = endpoint, policy: unknown = policies) {
  const payload = usage();
  const request = vi.fn(async (method: string) => {
    if (method === 'models.authStatus') {
      if (identity instanceof Error) throw identity;
      return identity as Record<string, unknown>;
    }
    return payload;
  });
  return { payload, request, load: () => readUsage(request, target, policy, now) };
}
function quota(payload: Record<string, unknown>) {
  return providerQuotaForProject({ phase: 'ready', snapshot: { payload, receivedAt: now } }, { modelProvider: 'claude-cli' } as never, now);
}

describe('account-scoped weekly-only quota policy', () => {
  it('hides only the confirmed account five-hour window before computing warning tone, preserving age and raw input', async () => {
    const test = fixture(); const original = structuredClone(test.payload);
    expect(quota(await test.load())).toEqual({ provider: 'anthropic', text: 'last known 2m · Week 80%', tone: 'normal' });
    expect(test.payload).toEqual(original);
    expect(test.request).toHaveBeenCalledWith('models.authStatus', {}, 5000);
  });
  // Physical iPad (10 Nov): React Native's URL reports an origin only for
  // http(s), so every wss policy was discarded and the window stayed visible.
  it('matches the paired Gateway where URL has no origin for WebSocket schemes', async () => {
    const NodeURL = URL;
    vi.stubGlobal('URL', class extends NodeURL { override get origin() { return /^https?:/.test(this.href) ? super.origin : ''; } });
    try {
      for (const target of [endpoint, 'wss://HOME.example:443/socket?x=1', 'wss://home.example']) {
        expect(quota(await fixture(auth(), target).load())).toMatchObject({ text: 'last known 2m · Week 80%' });
      }
      for (const target of ['wss://home.example:8443/socket', 'wss://user@home.example/socket', 'wss://home.example.evil.test/', 'ws://home.example/', 'https://home.example/']) {
        expect(quota(await fixture(auth(), target).load())).toMatchObject({ text: expect.stringContaining('5h 1%') });
      }
    } finally { vi.unstubAllGlobals(); }
  });
  it('compares IPv6 Gateway addresses by value, not by spelling', async () => {
    const policy = [{ ...policies[0]!, gatewayOrigin: 'wss://[::1]' }];
    expect(quota(await fixture(auth(), 'wss://[::1]/socket', policy).load())).toMatchObject({ text: 'last known 2m · Week 80%' });
    for (const target of ['wss://[0:0:0:0:0:0:0:1]/socket', 'wss://[0000:0000:0000:0000:0000:0000:0000:0001]:443', 'wss://[::0:1]']) {
      expect(quota(await fixture(auth(), target, [{ ...policies[0]!, gatewayOrigin: 'wss://[0:0:0:0:0:0:0:1]' }]).load())).toMatchObject({ text: 'last known 2m · Week 80%' });
    }
    const mapped = [{ ...policies[0]!, gatewayOrigin: 'wss://[::ffff:192.0.2.128]' }];
    for (const target of ['wss://[::ffff:192.0.2.128]/socket', 'wss://[::ffff:c000:280]', 'wss://[0:0:0:0:0:ffff:192.0.2.128]:443/']) {
      expect(quota(await fixture(auth(), target, mapped).load())).toMatchObject({ text: 'last known 2m · Week 80%' });
    }
    for (const target of ['wss://[::ffff:192.0.2.129]/', 'wss://[::ffff:192.0.2.256]/', 'wss://[192.0.2.128]/', 'wss://[::ffff:192.0.2]/', 'wss://[::ffff:192.000.2.128]/', 'wss://[::ffff:192.0.002.128]/']) {
      expect(quota(await fixture(auth(), target, mapped).load())).toMatchObject({ text: expect.stringContaining('5h 1%') });
    }
    for (const target of ['wss://[::2]/socket', 'wss://[::1]:8443/', 'wss://[1::2::3]/', 'wss://[::12345]/', 'wss://[1:2:3:4:5:6:7:8:9]/']) {
      expect(quota(await fixture(auth(), target, [{ ...policies[0]!, gatewayOrigin: 'wss://[0:0:0:0:0:0:0:1]' }]).load())).toMatchObject({ text: expect.stringContaining('5h 1%') });
    }
  });
  it.each([['anthropic:work'], ['anthropic:home', 'anthropic:work'], [], null, 'anthropic:home'])('does not hide another or ambiguous account %j', async (order) => {
    const test = fixture(auth(order)); expect(await test.load()).toEqual(test.payload);
  });
  it.each([null, {}, { providers: null }, { ...auth(), ts: now - 60001 }, new Error('unsupported')])('fails open to ordinary reported windows if identity is unavailable %#', async (identity) => {
    const test = fixture(identity); expect(await test.load()).toEqual(test.payload);
  });
  it.each(['wss://other.example', 'wss://home.example:1234', 'ws://home.example', 'invalid'])('does not apply HOME policy to another Gateway %s', async (target) => {
    const test = fixture(auth(), target); expect(await test.load()).toEqual(test.payload);
    expect(test.request).toHaveBeenCalledTimes(1);
  });
  it.each([null, {}, [], [{ ...policies[0], profileId: '' }]])('ignores absent or malformed policy %#', async (policy) => {
    const test = fixture(auth(), endpoint, policy); expect(await test.load()).toEqual(test.payload);
    expect(test.request).toHaveBeenCalledTimes(1);
  });
  it('preserves other providers, weekly warnings, provider errors and missing weekly data', async () => {
    const test = fixture(); test.payload.providers[0]!.windows[1]!.usedPercent = 95;
    const result = await test.load();
    expect(quota(result)?.tone).toBe('warning');
    expect((result.providers as unknown[])[1]).toEqual(test.payload.providers[1]);
    const missing = fixture(); missing.payload.providers[0]!.windows.splice(1);
    expect(quota(await missing.load())?.text).toBe('quota unavailable');
    const failed = fixture(); Object.assign(failed.payload.providers[0]!, { error: 'HTTP 429' });
    expect(quota(await failed.load())?.text).toBe('quota rate-limited');
  });
  it('does not suppress a work-account reading when selection changes during the usage read', async () => {
    const payload = usage(); let selected = 'anthropic:home';
    const request = vi.fn(async (method: string) => {
      if (method === 'models.authStatus') return auth([selected]);
      selected = 'anthropic:work'; return payload;
    });
    expect(await readUsage(request, endpoint, policies, now)).toEqual(payload);
  });
});
