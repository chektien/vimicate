import * as Crypto from 'expo-crypto';
import { buildDeviceAuth, type DeviceIdentity } from './deviceIdentity';
import type { GatewayProfile } from './setupCode';
import { operatorHandoffFromHello, type MobileOperatorHandoff } from './mobileBootstrapPayload';

export function bootstrapMobileOperator(profile: GatewayProfile, identity: DeviceIdentity, deviceFamily: 'ipad' | 'iphone', timeoutMs = 15000) {
  return new Promise<MobileOperatorHandoff>((resolve, reject) => {
    let settled = false;
    let connectID = '';
    let socket: WebSocket;
    const finish = (error?: Error, handoff?: MobileOperatorHandoff) => {
      if (settled) return;
      settled = true; clearTimeout(timer); socket.close();
      if (error) reject(error); else resolve(handoff!);
    };
    const timer = setTimeout(() => finish(new Error('OpenClaw mobile bootstrap timed out.')), timeoutMs);
    try { socket = new WebSocket(profile.endpoint); }
    catch (error) { clearTimeout(timer); reject(error instanceof Error ? error : new Error('Invalid Gateway WebSocket endpoint')); return; }
    socket.onerror = () => finish(new Error('OpenClaw mobile bootstrap transport failed.'));
    socket.onclose = () => { if (!settled) finish(new Error('OpenClaw mobile bootstrap closed before handoff.')); };
    socket.onmessage = (event) => {
      void (async () => {
        let frame: Record<string, unknown>;
        try { frame = JSON.parse(String(event.data)) as Record<string, unknown>; }
        catch { return; }
        if (frame.type === 'event' && frame.event === 'connect.challenge') {
          const nonce = typeof record(frame.payload).nonce === 'string' ? String(record(frame.payload).nonce) : '';
          if (!nonce) { finish(new Error('OpenClaw mobile bootstrap challenge was invalid.')); return; }
          connectID = Crypto.randomUUID();
          const device = await buildDeviceAuth(identity, profile.credential, nonce, [], { role: 'node', mode: 'node', deviceFamily });
          socket.send(JSON.stringify({
            type: 'req', id: connectID, method: 'connect', params: {
              minProtocol: 3, maxProtocol: 4,
              client: { id: 'openclaw-ios', displayName: 'Vimicate', version: '0.1.0', platform: 'ios', deviceFamily, mode: 'node' },
              role: 'node', scopes: [], caps: [], commands: [], permissions: {}, locale: 'en', userAgent: 'vimicate-rn/0.1.0',
              auth: { bootstrapToken: profile.credential }, device,
            },
          }));
          return;
        }
        if (frame.type !== 'res' || frame.id !== connectID) return;
        if (frame.ok !== true) { finish(new Error(typeof record(frame.error).message === 'string' ? String(record(frame.error).message) : 'OpenClaw mobile bootstrap failed.')); return; }
        try { finish(undefined, operatorHandoffFromHello(record(frame.payload))); }
        catch (error) { finish(error instanceof Error ? error : new Error('OpenClaw mobile bootstrap handoff was invalid.')); }
      })().catch((error: unknown) => finish(error instanceof Error ? error : new Error('OpenClaw mobile bootstrap failed.')));
    };
  });
}

function record(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
