import { afterEach, expect, it, vi } from 'vitest';
vi.mock('expo-crypto', () => { let id = 0; return { randomUUID: () => `qa-${++id}` }; });
vi.mock('expo-device', () => ({ isDevice: false, deviceType: 2, DeviceType: { PHONE: 1 } }));
vi.mock('../../modules/vimicate-diagnostics', () => ({ recordGatewayDiagnostic: () => {} }));
vi.mock('./deviceIdentity', () => ({ buildDeviceAuth: async () => ({}), loadOrCreateIdentity: async () => ({}) }));
vi.mock('./mobileBootstrap', () => ({ bootstrapMobileOperator: async () => ({}) }));
import { OpenClawClient } from './OpenClawClient';
let refuseQuestionScope = false;
let upgrade: 'rejected' | 'approved' = 'rejected';
let holdUpgradeRequest = false;
let releaseUpgradeRequest: (() => void) | undefined;
let holdUpgradeWait = false;
let requests: { method: string; params: Record<string, unknown> }[] = [];
class Socket {
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: unknown; onclose: unknown;
  constructor() { queueMicrotask(() => this.emit({ type: 'event', event: 'connect.challenge', payload: { nonce: 'qa-nonce' } })); }
  emit(frame: unknown) { this.onmessage?.({ data: JSON.stringify(frame) }); }
  send(raw: string) {
    const frame = JSON.parse(raw); requests.push(frame);
    queueMicrotask(() => {
      const questions = frame.params?.scopes?.includes('operator.questions');
      if (frame.method === 'connect' && questions && refuseQuestionScope) { this.emit({ type: 'res', id: frame.id, ok: false, error: { message: 'device token scope mismatch (re-pair or approve scope upgrade)' } }); return; }
      if (frame.method === 'device.scopes.requestUpgrade' && holdUpgradeRequest) { releaseUpgradeRequest = () => this.emit({ type: 'res', id: frame.id, ok: true, payload: { requestId: 'qa-upgrade' } }); return; }
      if (frame.method === 'device.scopes.waitUpgrade' && holdUpgradeWait) return;
      const payload = frame.method === 'connect' ? { type: 'hello-ok' }
        : frame.method === 'device.scopes.requestUpgrade' ? { requestId: 'qa-upgrade' }
        : frame.method === 'device.scopes.waitUpgrade' ? upgrade === 'approved' ? { status: 'approved', deviceToken: 'approved-test-token', scopes: ['operator.read', 'operator.write', 'operator.questions'] } : { status: 'rejected' }
        : {};
      this.emit({ type: 'res', id: frame.id, ok: true, payload });
    });
  }
  close() {}
}
const clients: OpenClawClient[] = [];
function client() { vi.stubGlobal('WebSocket', Socket); const value = new OpenClawClient(); clients.push(value); requests = []; return value; }
afterEach(() => { clients.splice(0).forEach(c => c.disconnect()); vi.unstubAllGlobals(); refuseQuestionScope = false; upgrade = 'rejected'; holdUpgradeRequest = false; releaseUpgradeRequest = undefined; holdUpgradeWait = false; });
it('keeps token connections working when the additional scope is refused', async () => {
  refuseQuestionScope = true; const value = client();
  await value.connect({ endpoint: 'ws://qa.test', sessionKey: 'qa', credentialKind: 'token', credential: 'test-only' });
  expect(value.status).toBe('connected'); expect(value.hasOperatorScope('operator.questions')).toBe(false);
  expect(requests.filter(r => r.method === 'connect').map(r => (r.params.scopes as string[]).includes('operator.questions'))).toEqual([true, false]);
  expect(value.questionScopeNotice).toContain('Question cards need approval');
});
it('connects with existing device grants before requesting an approval-bound upgrade', async () => {
  const value = client(); await value.connect({ endpoint: 'ws://qa.test', sessionKey: 'qa', credentialKind: 'deviceToken', credential: 'test-only', scopes: ['operator.read', 'operator.write'] });
  await vi.waitFor(() => expect(value.questionScopeNotice).toContain('were not approved'));
  expect(value.status).toBe('connected'); expect(requests[0]?.params.scopes).toEqual(['operator.read', 'operator.write']);
  expect(requests.find(r => r.method === 'device.scopes.requestUpgrade')?.params).toEqual({ scopes: ['operator.read', 'operator.write', 'operator.questions'] });
  await value.connect({ endpoint: 'ws://qa.test', sessionKey: 'qa', credentialKind: 'deviceToken', credential: 'test-only', scopes: ['operator.read', 'operator.write'] });
  await vi.waitFor(() => expect(requests.filter(r => r.method === 'device.scopes.requestUpgrade')).toHaveLength(2));
  expect(value.status).toBe('connected');
});
it('publishes only the identity-bound rotated token and reconnects with the approved scope', async () => {
  upgrade = 'approved'; const value = client(); const issued = vi.fn(); value.onIssuedDeviceToken = issued;
  await value.connect({ endpoint: 'ws://qa.test', sessionKey: 'qa', credentialKind: 'deviceToken', credential: 'old-test-token', scopes: ['operator.read', 'operator.write'] });
  await vi.waitFor(() => expect(requests.filter(r => r.method === 'health')).toHaveLength(2));
  expect(issued).toHaveBeenCalledWith('approved-test-token', ['operator.read', 'operator.write', 'operator.questions']);
  expect(value.hasOperatorScope('operator.questions')).toBe(true); expect(value.status).toBe('connected'); expect(value.questionScopeNotice).toBe('');
});

it('shows plain-language pending approval only while the confirmed upgrade is awaiting a decision', async () => {
  holdUpgradeWait = true;
  const value = client(); await value.connect({ endpoint: 'ws://qa.test', sessionKey: 'qa', credentialKind: 'deviceToken', credential: 'test-only', scopes: ['operator.read', 'operator.write'] });
  await vi.waitFor(() => expect(requests.some(r => r.method === 'device.scopes.waitUpgrade')).toBe(true));
  expect(value.questionScopeNotice).toBe('Question cards are waiting for device approval in OpenClaw. Normal chat still works.');
  expect(value.status).toBe('connected');
});
it('does not publish a retired upgrade request after a replacement connection already has access', async () => {
  holdUpgradeRequest = true;
  const value = client(); await value.connect({ endpoint: 'ws://qa.test', sessionKey: 'qa', credentialKind: 'deviceToken', credential: 'test-only', scopes: ['operator.read', 'operator.write'] });
  await vi.waitFor(() => expect(releaseUpgradeRequest).toBeDefined());
  await value.connect({ endpoint: 'ws://qa.test', sessionKey: 'qa', credentialKind: 'deviceToken', credential: 'new-test-token', scopes: ['operator.read', 'operator.write', 'operator.questions'] });
  releaseUpgradeRequest!(); await new Promise(resolve => setTimeout(resolve, 0));
  expect(value.questionScopeNotice).toBe(''); expect(value.status).toBe('connected');
  expect(requests.filter(r => r.method === 'device.scopes.waitUpgrade')).toHaveLength(0);
});
