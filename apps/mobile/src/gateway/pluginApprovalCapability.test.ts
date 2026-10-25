import { afterEach, expect, it, vi } from 'vitest';
vi.mock('expo-crypto', () => { let id = 0; return { randomUUID: () => `approval-${++id}` }; });
vi.mock('expo-device', () => ({ isDevice: false, deviceType: 2, DeviceType: { PHONE: 1 } }));
vi.mock('../../modules/vimicate-diagnostics', () => ({ recordGatewayDiagnostic: () => {} }));
vi.mock('./deviceIdentity', () => ({ buildDeviceAuth: async () => ({}), loadOrCreateIdentity: async () => ({}) }));
vi.mock('./mobileBootstrap', () => ({ bootstrapMobileOperator: async () => ({}) }));
import { OpenClawClient } from './OpenClawClient';
import { projectGatewayEvent } from './gatewayEventProjection';

let requests: { method: string; params?: Record<string, unknown> }[] = [];
let socket: Socket;
let subscriptionReply: Record<string, unknown> = {};
let delaySubscription = false;
let delayedSubscription: (() => void) | undefined;
class Socket {
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: unknown; onclose: unknown;
  constructor() { socket = this; queueMicrotask(() => this.emit({ type: 'event', event: 'connect.challenge', payload: { nonce: 'synthetic-nonce' } })); }
  emit(frame: unknown) { this.onmessage?.({ data: JSON.stringify(frame) }); }
  send(raw: string) {
    const frame = JSON.parse(raw); requests.push(frame);
    const reply = () => this.emit({ type: 'res', id: frame.id, ok: true,
      payload: frame.method === 'sessions.messages.subscribe' ? subscriptionReply : frame.method === 'connect' ? { type: 'hello-ok' } : frame.method === 'device.scopes.requestUpgrade' ? { requestId: 'synthetic-upgrade' } : frame.method === 'device.scopes.waitUpgrade' ? { status: 'rejected' } : {},
    });
    if (frame.method === 'sessions.messages.subscribe' && delaySubscription) delayedSubscription = reply;
    else queueMicrotask(reply);
  }
  close() {}
}
const clients: OpenClawClient[] = [];
function client() { vi.stubGlobal('WebSocket', Socket); const value = new OpenClawClient(); clients.push(value); requests = []; return value; }
afterEach(() => { clients.splice(0).forEach(c => c.disconnect()); vi.unstubAllGlobals(); subscriptionReply = {}; delaySubscription = false; delayedSubscription = undefined; });

it.each(['operator.approvals', 'operator.admin'])('advertises plugin approval delivery with the existing %s grant', async grant => {
  const value = client();
  await value.connect({ endpoint: 'ws://synthetic.test', sessionKey: 'one', credentialKind: 'deviceToken', credential: 'synthetic-only', scopes: [grant, 'operator.questions'] });
  const connect = requests.find(r => r.method === 'connect')?.params;
  expect(connect?.caps).toEqual(['tool-events', 'plugin-approvals']);
  expect(new Set(connect?.scopes as string[])).toEqual(new Set(['operator.read', 'operator.write', grant, 'operator.questions']));
});

it('does not advertise approval authority for a device without an approval grant', async () => {
  const value = client();
  await value.connect({ endpoint: 'ws://synthetic.test', sessionKey: 'one', credentialKind: 'deviceToken', credential: 'synthetic-only', scopes: ['operator.questions'] });
  expect(requests.find(r => r.method === 'connect')?.params?.caps).toEqual(['tool-events']);
});

it('routes a Computer Use plugin approval through the existing thread-bound event and decision contract', async () => {
  const value = client(); const event = vi.fn(); value.onEvent = event;
  await value.connect({ endpoint: 'ws://synthetic.test', sessionKey: 'one', credentialKind: 'token', credential: 'synthetic-only' });
  // The gateway recognises iOS as an exec approver by default, but plugin
  // approvals require this separately advertised capability.
  const caps = requests.find(r => r.method === 'connect')?.params?.caps as string[];
  expect(caps).toContain('plugin-approvals');
  const frame = { type: 'event', event: 'plugin.approval.requested', payload: {
    id: 'synthetic-numbers-approval', request: { sessionKey: 'one', description: 'Allow ChatGPT to use Numbers?', allowedDecisions: ['allow-once', 'allow-always', 'deny'] },
  } };
  socket.emit(frame);
  await vi.waitFor(() => expect(event).toHaveBeenCalledWith(frame));
  const message = projectGatewayEvent(frame, 'one')?.message;
  expect(message).toMatchObject({ role: 'approval', sessionKey: 'one', approval: { kind: 'plugin', id: 'synthetic-numbers-approval', resolved: false } });
  expect(projectGatewayEvent(frame, 'two')).toBeNull();
  await value.resolveApproval(message!.approval!.kind, message!.approval!.id, 'allow-once');
  expect(requests.at(-1)).toMatchObject({ method: 'plugin.approval.resolve', params: { id: 'synthetic-numbers-approval', decision: 'allow-once' } });
});

it('opts into session approval replay with existing approval authority', async () => {
  const value = client();
  await value.connect({ endpoint: 'ws://synthetic.test', sessionKey: 'one', credentialKind: 'token', credential: 'synthetic-only' });
  await value.followSession('one');
  expect(requests.at(-1)).toMatchObject({ method: 'sessions.messages.subscribe', params: { key: 'one', includeApprovals: true } });
});
it('does not request approval replay without an approval grant', async () => {
  const value = client();
  await value.connect({ endpoint: 'ws://synthetic.test', sessionKey: 'one', credentialKind: 'deviceToken', credential: 'synthetic-only', scopes: ['operator.questions'] });
  await value.followSession('one');
  expect(requests.at(-1)).toMatchObject({ method: 'sessions.messages.subscribe', params: { key: 'one' } });
  expect(requests.at(-1)?.params).not.toHaveProperty('includeApprovals');
});

it('publishes pending replay from subscribe through the normal session-bound projection', async () => {
  const value = client(); const event = vi.fn(); value.onEvent = event;
  await value.connect({ endpoint: 'ws://synthetic.test', sessionKey: 'one', credentialKind: 'token', credential: 'synthetic-only' });
  subscriptionReply = { key: 'one', approvalReplay: { sessionKey: 'one', approvals: [{ id: 'numbers', status: 'pending', createdAtMs: 1000, expiresAtMs: 121000, presentation: { kind: 'plugin', title: 'Allow Numbers?', allowedDecisions: ['allow-once', 'deny'] } }] } };
  await value.followSession('one');
  const delivered = event.mock.calls.map(call => call[0]).find(frame => frame.event === 'session.approval');
  expect(projectGatewayEvent(delivered, 'one')?.message.approval).toMatchObject({ id: 'numbers', resolved: false });
  expect(projectGatewayEvent(delivered, 'two')).toBeNull();
});
it('does not publish a subscribe replay after disconnect retires its connection', async () => {
  const value = client(); const event = vi.fn(); value.onEvent = event;
  await value.connect({ endpoint: 'ws://synthetic.test', sessionKey: 'one', credentialKind: 'token', credential: 'synthetic-only' });
  delaySubscription = true;
  const following = value.followSession('one').catch(() => undefined);
  value.disconnect(); delayedSubscription?.(); await following;
  expect(event.mock.calls.some(call => call[0].event === 'session.approval')).toBe(false);
});
