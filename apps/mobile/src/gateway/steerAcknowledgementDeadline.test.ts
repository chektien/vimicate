import { describe, expect, it, vi } from 'vitest';
vi.mock('expo-crypto', () => ({ randomUUID: () => 'send' }));
vi.mock('expo-device', () => ({ isDevice: false, deviceType: 2, DeviceType: { PHONE: 1, TABLET: 2 } }));
vi.mock('../../modules/vimicate-diagnostics', () => ({ recordGatewayDiagnostic: () => undefined }));
vi.mock('./deviceIdentity', () => ({ buildDeviceAuth: async () => ({}), loadOrCreateIdentity: async () => ({}) }));
vi.mock('./mobileBootstrap', () => ({ bootstrapMobileOperator: async () => ({ deviceToken: '', scopes: [] }) }));
import { OpenClawClient } from './OpenClawClient';
import { activeRunSendControl } from './gatewaySendControl';

// Live Claude CLI check (10 Nov): a steer was acknowledged 35.3 s after it was
// sent, when the run's 35 s tool ended. The 35 s request deadline had expired.
describe('chat.send acknowledgement deadline', () => {
  const sent = async (control?: Parameters<OpenClawClient['send']>[4]) => {
    const client = new OpenClawClient();
    const request = vi.spyOn(client, 'request').mockResolvedValue({ runId: 'run' });
    await client.send('agent:main:fixture', 'text', [], 'key', control);
    return request.mock.calls[0]!;
  };

  it('waits for a steered input until the active run can adopt it', async () => {
    for (const control of ['steer' as const, activeRunSendControl('run-active', false)]) {
      const [method, params, timeoutMs] = await sent(control);
      expect(method).toBe('chat.send');
      expect(params).toMatchObject({ sessionKey: 'agent:main:fixture', message: 'text', deliver: false, timeoutMs: 0, idempotencyKey: 'key', queueMode: 'steer' });
      expect(timeoutMs).toBeGreaterThanOrEqual(600_000);
    }
  });

  it('keeps the admission deadline for a new turn, an interrupt and a followup', async () => {
    expect((await sent())[2]).toBe(35_000);
    expect((await sent(activeRunSendControl('run-active', true)))[2]).toBe(35_000);
    expect((await sent({ queueMode: 'followup', sessionId: '11111111-1111-4111-8111-111111111111' }))[2]).toBe(35_000);
  });
});
