import { describe, expect, it, vi } from 'vitest';
import { gatewayRequestReachedGateway } from './gatewayRequestDelivery';

vi.mock('expo-crypto', () => ({ randomUUID: () => 'request-one' }));
vi.mock('expo-device', () => ({ isDevice: false, deviceType: 2, DeviceType: { PHONE: 1, TABLET: 2 } }));
vi.mock('../../modules/vimicate-diagnostics', () => ({ recordGatewayDiagnostic: () => undefined }));
vi.mock('./deviceIdentity', () => ({ buildDeviceAuth: async () => ({}), loadOrCreateIdentity: async () => ({}) }));
vi.mock('./mobileBootstrap', () => ({ bootstrapMobileOperator: async () => ({ deviceToken: '', scopes: [] }) }));
import { OpenClawClient } from './OpenClawClient';
import type { GatewayProfile } from './setupCode';

const profile = { endpoint: 'ws://gateway.test', credentialKind: 'deviceToken', credential: 'token' } as unknown as GatewayProfile;

/** Minimal stand-in for the socket `connect` installs before its challenge await. */
class StubSocket {
  static instances: StubSocket[] = [];
  sent: string[] = [];
  throwOnSend: Error | null = null;
  onmessage: unknown; onerror: unknown; onclose: unknown;
  constructor() { StubSocket.instances.push(this); }
  send(frame: string) { if (this.throwOnSend) throw this.throwOnSend; this.sent.push(frame); }
  close() { /* the client only needs `close` to exist */ }
}

/**
 * `connect` assigns its socket synchronously and then awaits the hello-ok
 * challenge, so a request issued now runs against a live socket without
 * completing a handshake this test has no Gateway for.
 */
function connectedClient() {
  StubSocket.instances = [];
  const previous = globalThis.WebSocket;
  (globalThis as { WebSocket?: unknown }).WebSocket = StubSocket;
  const client = new OpenClawClient();
  void client.connect(profile).catch(() => undefined);
  (globalThis as { WebSocket?: unknown }).WebSocket = previous;
  const socket = StubSocket.instances[0];
  if (!socket) throw new Error('connect did not install a socket');
  return { client, socket };
}

describe('gateway request transport', () => {
  it('marks a request the reconnect discarded as one that reached the Gateway', async () => {
    const { client, socket } = connectedClient();
    const pending = client.request('chat.send', { message: 'ship it' });
    expect(socket.sent).toHaveLength(1);

    // `connect` disconnects first, which rejects everything still pending.
    client.disconnect();

    await expect(pending).rejects.toSatisfy(gatewayRequestReachedGateway);
  });

  it('marks a request that never left the app as one that did not reach the Gateway', async () => {
    const { client, socket } = connectedClient();
    socket.throwOnSend = new Error('WebSocket is already in CLOSING or CLOSED state');

    await expect(client.request('chat.send', { message: 'ship it' }))
      .rejects.toSatisfy((error: unknown) => !gatewayRequestReachedGateway(error));
    expect(socket.sent).toEqual([]);
  });

  it('marks a request issued with no socket as one that did not reach the Gateway', async () => {
    const client = new OpenClawClient();

    await expect(client.request('chat.send', { message: 'ship it' }))
      .rejects.toSatisfy((error: unknown) => !gatewayRequestReachedGateway(error));
  });

  it('marks a timed-out request as one that reached the Gateway', async () => {
    vi.useFakeTimers();
    try {
      const { client, socket } = connectedClient();
      const pending = client.request('chat.send', { message: 'ship it' }, 25);
      expect(socket.sent).toHaveLength(1);
      const settled = expect(pending).rejects.toSatisfy(gatewayRequestReachedGateway);
      await vi.advanceTimersByTimeAsync(30);
      await settled;
    } finally { vi.useRealTimers(); }
  });
});

it('sends explicit active-run steering with the same identity and attachment snapshot, never interrupt', async () => {
  const { client, socket } = connectedClient();
  const pending = client.send('qa', 'pause safely', [{ id: 'image-one', byteCount: 1, filename: 'one.png', mimeType: 'image/png', dataBase64: 'AA==' }], 'submission', { queueMode: 'steer', steerPolicy: 'require-active', expectedActiveRunId: 'active-run' });
  expect(JSON.parse(socket.sent[0]!)).toMatchObject({ method: 'chat.send', params: {
    sessionKey: 'qa', message: 'pause safely', queueMode: 'steer', steerPolicy: 'require-active', expectedActiveRunId: 'active-run', idempotencyKey: 'submission', deliver: false, timeoutMs: 0,
    attachments: [{ type: 'file', fileName: 'one.png', mimeType: 'image/png', content: 'AA==' }],
  } });
  client.disconnect();
  await expect(pending).rejects.toSatisfy(gatewayRequestReachedGateway);
});

it('does not override queue mode for an idle submission', async () => {
  const { client, socket } = connectedClient();
  const pending = client.send('qa', 'new task', [], 'submission');
  expect(JSON.parse(socket.sent[0]!).params).not.toHaveProperty('queueMode');
  client.disconnect();
  await expect(pending).rejects.toSatisfy(gatewayRequestReachedGateway);
});

it('sends a separate generation-fenced followup without steering or interrupt fields', async () => {
  const { client, socket } = connectedClient();
  const sessionId = '00000000-0000-4000-a000-000000000128';
  const pending = client.send('qa', 'next task', [], 'followup', { queueMode: 'followup', sessionId });
  const params = JSON.parse(socket.sent[0]!).params;
  expect(params).toMatchObject({ queueMode: 'followup', sessionId, idempotencyKey: 'followup', message: 'next task' });
  expect(params).not.toHaveProperty('steerPolicy'); expect(params).not.toHaveProperty('expectedActiveRunId');
  client.disconnect(); await expect(pending).rejects.toSatisfy(gatewayRequestReachedGateway);
});
it.each(['', 'route-key', 'not-a-uuid'])('rejects followup without a concrete generation before writing: %s', sessionId => {
  const { client, socket } = connectedClient();
  expect(() => client.send('qa', 'next task', [], 'followup', { queueMode: 'followup', sessionId })).toThrow('Refresh this thread');
  expect(socket.sent).toEqual([]); client.disconnect();
});

it('fences an explicit interrupt without enabling strict steering or losing attachments', async () => {
  const { client, socket } = connectedClient();
  const pending = client.send('qa', 'correction', [], 'interrupt-one', { queueMode: 'interrupt', expectedActiveRunId: 'cron-run' });
  expect(JSON.parse(socket.sent[0]!).params).toMatchObject({ queueMode: 'interrupt', expectedActiveRunId: 'cron-run', message: 'correction' });
  expect(JSON.parse(socket.sent[0]!).params).not.toHaveProperty('steerPolicy');
  client.disconnect(); await expect(pending).rejects.toSatisfy(gatewayRequestReachedGateway);
});

it('refuses an empty run fence before writing a frame', () => {
  const { client, socket } = connectedClient();
  expect(() => client.send('qa', 'correction', [], 'interrupt-one', { queueMode: 'interrupt', expectedActiveRunId: '' })).toThrow('Refresh this thread');
  expect(socket.sent).toEqual([]); client.disconnect();
});

it.each(['not-dispatched', 'unconfirmed'])('retains the server control outcome %s at the transport boundary', async inputDisposition => {
  const { client, socket } = connectedClient();
  const pending = client.send('qa', 'correction', [], 'interrupt-one', { queueMode: 'interrupt', expectedActiveRunId: 'cron-run' });
  const request = JSON.parse(socket.sent[0]!);
  const check = expect(pending).rejects.toSatisfy((error: unknown) => gatewayRequestReachedGateway(error) === (inputDisposition === 'unconfirmed'));
  (socket.onmessage as (event: { data: string }) => void)({ data: JSON.stringify({ type: 'res', id: request.id, ok: false, error: { code: 'INVALID_REQUEST', message: 'control refused', details: { inputDisposition } } }) });
  await check; client.disconnect();
});

it.each(['not-dispatched', 'unconfirmed'])('converges the raw error echo only after a confirmed structured refusal: %s', async inputDisposition => {
  const { client, socket } = connectedClient();
  const events = vi.fn(); client.onEvent = events;
  const pending = client.send('qa', 'next task', [], 'submission', { queueMode: 'steer', steerPolicy: 'require-active', expectedActiveRunId: 'cron' });
  const check = expect(pending).rejects.toBeInstanceOf(Error);
  const emit = (frame: unknown) => (socket.onmessage as (event: { data: string }) => void)({ data: JSON.stringify(frame) });
  const message = 'This run has different tool permissions and cannot accept your message.';
  emit({ type: 'res', id: 'request-one', ok: false, payload: { runId: 'submission', status: 'error' }, error: {
    code: 'INVALID_REQUEST', message, details: { reason: 'tool_authority_mismatch', expectedActiveRunId: 'cron', activeRunId: 'cron', inputDisposition },
  } });
  emit({ type: 'event', event: 'chat', payload: { sessionKey: 'qa', runId: 'submission', state: 'error', errorMessage: `ActiveSteerRejectedError: ${message}` } });
  await check;
  expect(events).toHaveBeenCalledTimes(inputDisposition === 'not-dispatched' ? 0 : 1);
  // A real failure from the predecessor must still be visible.
  emit({ type: 'event', event: 'chat', payload: { sessionKey: 'qa', runId: 'cron', state: 'error', errorMessage: 'provider failed' } });
  expect(events).toHaveBeenCalledTimes(inputDisposition === 'not-dispatched' ? 1 : 2);
  client.disconnect();
});
