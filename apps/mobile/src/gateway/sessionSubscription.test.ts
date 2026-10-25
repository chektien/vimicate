import { afterEach, expect, it, vi } from 'vitest';
vi.mock('expo-crypto', () => { let id = 0; return { randomUUID: () => `subscription-${++id}` }; });
vi.mock('expo-device', () => ({ isDevice: false, deviceType: 2, DeviceType: { PHONE: 1 } }));
vi.mock('../../modules/vimicate-diagnostics', () => ({ recordGatewayDiagnostic: () => {} }));
vi.mock('./deviceIdentity', () => ({ buildDeviceAuth: async () => ({}), loadOrCreateIdentity: async () => ({}) }));
vi.mock('./mobileBootstrap', () => ({ bootstrapMobileOperator: async () => ({}) }));
import { OpenClawClient } from './OpenClawClient';

type Request = { id: string; method: string; params?: { key?: string } };
class Socket {
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: unknown; onclose: unknown;
  requests: Request[] = [];
  subscriptions = new Set<string>();
  held: Request[] = [];
  hold = false;
  constructor() { sockets.push(this); queueMicrotask(() => this.emit({ type: 'event', event: 'connect.challenge', payload: { nonce: 'fixture' } })); }
  emit(frame: unknown) { this.onmessage?.({ data: JSON.stringify(frame) }); }
  send(raw: string) {
    const request = JSON.parse(raw) as Request; this.requests.push(request);
    if (this.hold && request.method.startsWith('sessions.messages.')) this.held.push(request);
    else queueMicrotask(() => this.reply(request));
  }
  reply(request: Request, ok = true, extra: Record<string, unknown> = {}) {
    const key = request.params?.key ?? '';
    if (ok && request.method === 'sessions.messages.subscribe') this.subscriptions.add(`canonical-${key}`);
    if (ok && request.method === 'sessions.messages.unsubscribe') this.subscriptions.delete(key);
    this.emit({ type: 'res', id: request.id, ok, ...(ok ? { payload: request.method === 'connect' ? { type: 'hello-ok' } : { key: `canonical-${key}`, ...extra } } : { error: { message: 'subscription refused' } }) });
  }
  close() {}
}
const sockets: Socket[] = []; const clients: OpenClawClient[] = [];
const observed = (promise: Promise<void>) => { void promise.catch(() => undefined); return promise; };
const drain = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
async function connect() {
  vi.stubGlobal('WebSocket', Socket); const client = new OpenClawClient(); clients.push(client);
  await client.connect({ endpoint: 'ws://fixture.invalid', sessionKey: 'a', credentialKind: 'token', credential: 'fixture' });
  return { client, socket: sockets.at(-1)! };
}
afterEach(() => { for (const client of clients.splice(0)) client.disconnect(); sockets.length = 0; vi.unstubAllGlobals(); });

it('coalesces a rapid switch burst into one in-flight subscription and the latest selection without leaking intermediate subscriptions', async () => {
  const { client, socket } = await connect(); socket.hold = true;
  const requests = [observed(client.followSession('a'))];
  for (let i = 0; i < 40; i++) requests.push(observed(client.followSession(i % 2 ? 'c' : 'b')));
  expect(socket.held.map(request => request.params?.key)).toEqual(['a']);
  socket.reply(socket.held.shift()!); await drain();
  expect(socket.held.map(request => request.params?.key)).toEqual(['canonical-a']);
  socket.reply(socket.held.shift()!); await drain();
  expect(socket.held.map(request => request.params?.key)).toEqual(['c']);
  socket.reply(socket.held.shift()!); await Promise.all(requests);
  expect(socket.subscriptions).toEqual(new Set(['canonical-c']));
  expect(socket.requests.filter(request => request.method === 'sessions.messages.subscribe')).toHaveLength(2);
  await client.followSession('c'); expect(socket.held).toHaveLength(0);
});

it('returns to the original selection during an in-flight switch rather than accepting its retired subscription', async () => {
  const { client, socket } = await connect(); await client.followSession('a'); socket.hold = true;
  const b = observed(client.followSession('b')); const a = observed(client.followSession('a'));
  socket.reply(socket.held.shift()!); await drain();
  expect(socket.held.map(request => request.params?.key)).toEqual(['a']);
  socket.reply(socket.held.shift()!); await Promise.all([a, b]);
  expect(socket.subscriptions).toEqual(new Set(['canonical-a']));
});

it('cannot send an old continuation to the replacement connection after disconnect during unsubscribe', async () => {
  const { client, socket } = await connect(); await client.followSession('a'); socket.hold = true;
  const retired = client.followSession('b').catch(() => undefined);
  await client.connect({ endpoint: 'ws://replacement.invalid', sessionKey: 'c', credentialKind: 'token', credential: 'fixture' });
  await retired; await client.followSession('c');
  expect(sockets.at(-1)!.requests.filter(request => request.method === 'sessions.messages.subscribe').map(request => request.params?.key)).toEqual(['c']);
});

it('joins duplicate requests without dropping live notifications or replaying the superseded selection', async () => {
  const { client, socket } = await connect(); const events = vi.fn(); client.onEvent = events; socket.hold = true;
  const a = observed(client.followSession('a')); const same = observed(client.followSession('a'));
  const b = observed(client.followSession('b'));
  expect(socket.held).toHaveLength(1);
  const message = { type: 'event', event: 'sessions.changed', payload: { sessionKey: 'b', phase: 'message' } };
  socket.emit(message); await drain(); expect(events).toHaveBeenCalledWith(message);
  socket.reply(socket.held.shift()!, true, { approvalReplay: { sessionKey: 'a', approvals: [{ id: 'retired', status: 'pending', createdAtMs: 1000, expiresAtMs: 121000, presentation: { kind: 'plugin', title: 'Retired approval', allowedDecisions: ['allow-once', 'deny'] } }] } });
  await drain(); expect(events.mock.calls.some(call => call[0].event === 'session.approval')).toBe(false);
  socket.reply(socket.held.shift()!); await drain(); socket.reply(socket.held.shift()!); await Promise.all([a, same, b]);
  expect(socket.subscriptions).toEqual(new Set(['canonical-b']));
});

it('continues to the latest target after an obsolete subscription failure and permits an explicit retry after a current failure', async () => {
  const { client, socket } = await connect(); socket.hold = true;
  const a = observed(client.followSession('a')); const b = observed(client.followSession('b'));
  socket.reply(socket.held.shift()!, false); await drain();
  expect(socket.held.map(request => request.params?.key)).toEqual(['b']);
  socket.reply(socket.held.shift()!, false);
  await expect(a).rejects.toThrow('subscription refused'); await expect(b).rejects.toThrow('subscription refused');
  const retry = observed(client.followSession('b')); socket.reply(socket.held.shift()!); await retry;
  expect(socket.subscriptions).toEqual(new Set(['canonical-b']));
});

it('retires pending targets after disconnect during subscribe without blocking a fresh connection', async () => {
  const { client, socket } = await connect(); socket.hold = true;
  const a = observed(client.followSession('a')); const b = observed(client.followSession('b'));
  await client.connect({ endpoint: 'ws://replacement.invalid', sessionKey: 'c', credentialKind: 'token', credential: 'fixture' });
  await Promise.all([a, b]); await client.followSession('c');
  expect(sockets.at(-1)!.requests.filter(request => request.method === 'sessions.messages.subscribe').map(request => request.params?.key)).toEqual(['c']);
});
