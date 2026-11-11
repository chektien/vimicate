import { describe, expect, it, vi } from 'vitest';
const policy = vi.hoisted(() => ({ gatewayOrigin: 'wss://home.example', provider: 'anthropic', profileId: 'anthropic:home' }));
const config = vi.hoisted((): { extra: Record<string, unknown> } => ({ extra: {} }));
vi.mock('expo-constants', () => ({ default: { expoConfig: config } }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'quota' }));
vi.mock('expo-device', () => ({ isDevice: false, deviceType: 2, DeviceType: { PHONE: 1, TABLET: 2 } }));
vi.mock('../../modules/vimicate-diagnostics', () => ({ recordGatewayDiagnostic: () => undefined }));
vi.mock('./deviceIdentity', () => ({ buildDeviceAuth: async () => ({}), loadOrCreateIdentity: async () => ({}) }));
vi.mock('./mobileBootstrap', () => ({ bootstrapMobileOperator: async () => ({ deviceToken: '', scopes: [] }) }));
import { OpenClawClient } from './OpenClawClient';
import { providerQuotaForProject } from './providerQuota';

describe('production quota transport composition', () => {
  it('uses the paired Gateway and current account policy on each refresh, without caching account identity', async () => {
    config.extra = { weeklyOnlyQuotaAccounts: [policy] };
    const client = new OpenClawClient();
    Object.assign(client, { profile: { endpoint: policy.gatewayOrigin } });
    let selected = policy.profileId;
    const request = vi.spyOn(client, 'request').mockImplementation(async method => method === 'usage.status'
      ? { providers: [{ provider: policy.provider, windows: [{ label: '5h', usedPercent: 99 }, { label: 'Week', usedPercent: 2 }] }] }
      : { ts: Date.now(), providers: [{ provider: policy.provider, profileOrder: [selected], profiles: [{ profileId: selected, type: 'token', status: 'static' }] }] });
    const read = async () => providerQuotaForProject({ phase: 'ready', snapshot: { payload: await client.providerUsage(), receivedAt: Date.now() } }, { modelProvider: policy.provider } as never);
    expect(await read()).toMatchObject({ text: 'Week 98%', tone: 'normal' });
    selected = 'another-account';
    expect(await read()).toMatchObject({ text: '5h 1% · Week 98%', tone: 'warning' });
    expect(request.mock.calls.filter(call => call[0] === 'models.authStatus')).toHaveLength(3);
    Object.assign(client, { profile: { endpoint: 'wss://other.example' } });
    request.mockClear();
    expect(await read()).toMatchObject({ text: '5h 1% · Week 98%' });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[0]).toBe('usage.status');
  });
  it('does not import shipping policy when the effective contributor extra omits it', async () => {
    config.extra = {};
    const client = new OpenClawClient(); Object.assign(client, { profile: { endpoint: policy.gatewayOrigin } });
    const payload = { providers: [{ provider: policy.provider, windows: [{ label: '5h', usedPercent: 40 }] }] };
    const request = vi.spyOn(client, 'request').mockResolvedValue(payload);
    expect(await client.providerUsage()).toEqual(payload);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[0]).toBe('usage.status');
  });

});
