import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-crypto', () => { let id = 0; return { randomUUID: () => `handshake-${++id}` }; });
vi.mock('expo-device', () => ({ isDevice: false, deviceType: 2, DeviceType: { PHONE: 1 } }));
vi.mock('../../modules/vimicate-diagnostics', () => ({ recordGatewayDiagnostic: () => undefined }));
vi.mock('./deviceIdentity', () => ({ buildDeviceAuth: vi.fn(async () => ({})), loadOrCreateIdentity: vi.fn(async () => ({})) }));
vi.mock('./mobileBootstrap', () => ({ bootstrapMobileOperator: vi.fn(async () => ({ deviceToken: 'bootstrapped', scopes: ['operator.questions'] })) }));
import { OpenClawClient } from './OpenClawClient';
import { buildDeviceAuth, loadOrCreateIdentity } from './deviceIdentity';
import type { GatewayProfile } from './setupCode';

const profile: GatewayProfile = { endpoint: 'ws://gateway.test', sessionKey: 'qa', credentialKind: 'deviceToken', credential: 'test-only', scopes: ['operator.read', 'operator.write', 'operator.questions'] };
type Request = { id: string; method: string; params?: Record<string, unknown> };
class Socket {
  static instances: Socket[] = [];
  sent: Request[] = [];
  closed = false;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor() { Socket.instances.push(this); }
  send(raw: string) { if (this.closed) throw new Error('Socket closed'); this.sent.push(JSON.parse(raw)); }
  close() { this.closed = true; }
  emit(frame: unknown) { this.onmessage?.({ data: JSON.stringify(frame) }); }
  challenge() { this.emit({ type: 'event', event: 'connect.challenge', payload: { nonce: 'test-nonce' } }); }
  reply(method: string, payload: unknown = {}) {
    const request = this.sent.find(frame => frame.method === method);
    if (!request) throw new Error(`Missing ${method} request`);
    this.emit({ type: 'res', id: request.id, ok: true, payload });
  }
}
const clients: OpenClawClient[] = [];
// Drain only promise continuations. Responses and timeouts remain explicitly controlled.
async function flush() { for (let index = 0; index < 12; index += 1) await Promise.resolve(); }
function createClient() { const client = new OpenClawClient(); clients.push(client); return client; }
function start(client: OpenClawClient) {
  const result = client.connect(profile).then(() => undefined, (error: Error) => error);
  return { socket: Socket.instances.at(-1)!, result };
}
async function throughHello(socket: Socket) {
  socket.challenge(); await flush();
  expect(socket.sent.map(frame => frame.method)).toEqual(['connect']);
  socket.reply('connect', { type: 'hello-ok' }); await flush();
  expect(socket.sent.map(frame => frame.method)).toEqual(['connect', 'sessions.subscribe']);
}
async function complete(socket: Socket) {
  await throughHello(socket); socket.reply('sessions.subscribe'); await flush(); socket.reply('health'); await flush();
}
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('WebSocket', Socket); Socket.instances = []; });
afterEach(async () => { clients.splice(0).forEach(client => client.disconnect()); await flush(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('Gateway handshake generation ownership at the socket boundary', () => {
  it('connects only after hello, session subscription and health all succeed', async () => {
    const client = createClient(); const { socket, result } = start(client);
    await throughHello(socket); expect(client.status).toBe('connecting');
    socket.reply('sessions.subscribe'); await flush(); expect(client.status).toBe('connecting');
    socket.reply('health'); await flush(); expect(client.status).toBe('connected'); expect(await result).toBeUndefined();
  });

  it('keeps a current health timeout fatal and preserves the five-second readiness gate', async () => {
    const client = createClient(); const { socket, result } = start(client);
    await throughHello(socket); socket.reply('sessions.subscribe'); await flush();
    await vi.advanceTimersByTimeAsync(5000);
    expect(await result).toMatchObject({ message: 'health timed out' }); expect(client.status).toBe('error'); expect(socket.closed).toBe(true);
  });

  it.each(['sessions.subscribe', 'health'])('does not let rejection of retired %s close the replacement', async stage => {
    const client = createClient(); const old = start(client); await throughHello(old.socket);
    if (stage === 'health') { old.socket.reply('sessions.subscribe'); await flush(); }
    const replacement = start(client); await flush();
    expect(await old.result).toMatchObject({ message: 'Gateway disconnected' });
    expect(client.status).toBe('connecting'); expect(replacement.socket.closed).toBe(false);
    await complete(replacement.socket); expect(await replacement.result).toBeUndefined(); expect(client.status).toBe('connected');
  });

  it('does not send health on a replacement when the retired subscription already resolved', async () => {
    const client = createClient(); const old = start(client); await throughHello(old.socket);
    old.socket.reply('sessions.subscribe');
    const replacement = start(client); await flush();
    expect(replacement.socket.sent).toEqual([]); expect(client.status).toBe('connecting');
    await complete(replacement.socket); expect(await replacement.result).toBeUndefined();
  });

  it('does not publish connected when retired health resolved just before replacement', async () => {
    const client = createClient(); const old = start(client); await throughHello(old.socket);
    old.socket.reply('sessions.subscribe'); await flush(); old.socket.reply('health');
    const replacement = start(client); await flush();
    expect(client.status).toBe('connecting'); expect(replacement.socket.sent).toEqual([]);
    await complete(replacement.socket); expect(await replacement.result).toBeUndefined();
  });

  it('does not turn explicit disconnect into an error when health is pending', async () => {
    const client = createClient(); const old = start(client); await throughHello(old.socket);
    old.socket.reply('sessions.subscribe'); await flush(); client.disconnect(); await flush();
    expect(client.status).toBe('idle'); expect(await old.result).toMatchObject({ message: 'Gateway disconnected' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['identity', 'authentication'])('does not send retired credentials after delayed %s preparation', async stage => {
    let release!: (value: never) => void;
    const delayed = new Promise<never>(resolve => { release = resolve; });
    if (stage === 'identity') vi.mocked(loadOrCreateIdentity).mockReturnValueOnce(delayed);
    else vi.mocked(buildDeviceAuth).mockReturnValueOnce(delayed);
    const client = createClient(); const old = start(client); old.socket.challenge(); await flush();
    const replacement = start(client); release({} as never); await flush();
    expect(old.socket.sent).toEqual([]); expect(replacement.socket.sent).toEqual([]); expect(client.status).toBe('connecting');
    await complete(replacement.socket); expect(await replacement.result).toBeUndefined();
  });
});
