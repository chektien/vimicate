import { describe, expect, it, vi } from 'vitest';
import { gatewayArtifactDownloadSource } from './gatewayArtifactDownload';
vi.mock('expo-crypto', () => ({ randomUUID: () => 'request-one' }));
vi.mock('expo-device', () => ({ isDevice: false, deviceType: 2, DeviceType: { PHONE: 1, TABLET: 2 } }));
vi.mock('../../modules/vimicate-diagnostics', () => ({ recordGatewayDiagnostic: () => undefined }));
vi.mock('./deviceIdentity', () => ({ buildDeviceAuth: async () => ({}), loadOrCreateIdentity: async () => ({}) }));
vi.mock('./mobileBootstrap', () => ({ bootstrapMobileOperator: async () => ({ deviceToken: '', scopes: [] }) }));
import { OpenClawClient } from './OpenClawClient';

const artifactId = 'artifact_managed_image_fixture';
const sessionKey = 'agent:fixture:images';
const path = `/api/chat/media/outgoing/${encodeURIComponent(sessionKey)}/fixture/full?mediaTicket=fixture`;
const artifact = { id: artifactId, sessionKey, type: 'image', download: { mode: 'url' } };
const payload = { artifact, url: path };

describe('paired image artifact response', () => {
  it('resolves the scoped relative capability on the paired Gateway origin', () => {
    expect(gatewayArtifactDownloadSource(payload, 'wss://gateway.example/socket', artifactId, sessionKey))
      .toEqual({ uri: `https://gateway.example${path}` });
  });
  it.each([
    { ...payload, artifact: { ...artifact, id: 'another' } },
    { ...payload, artifact: { ...artifact, sessionKey: 'another' } },
    { ...payload, artifact: { ...artifact, type: 'file' } },
    { ...payload, url: `https://another.example${path}` },
    { ...payload, url: path.replace(encodeURIComponent(sessionKey), 'another') },
    { ...payload, url: path.split('?')[0] },
    { ...payload, url: '/__openclaw__/assistant-media?mediaTicket=fixture' },
  ])('rejects an unrelated or unscoped response %#', (value) => {
    expect(() => gatewayArtifactDownloadSource(value, 'wss://gateway.example', artifactId, sessionKey)).toThrow();
  });
  it('rejects a late RPC result after the connection retires', async () => {
    const client = new OpenClawClient();
    Object.assign(client, { status: 'connected', profile: { endpoint: 'wss://gateway.example' } });
    let resolve!: (value: unknown) => void;
    const request = vi.spyOn(client, 'request').mockReturnValue(new Promise(done => { resolve = done; }));
    const result = client.resolveArtifact(artifactId, sessionKey, new AbortController().signal);
    expect(request).toHaveBeenCalledWith('artifacts.download', { artifactId, sessionKey }, 15000);
    client.disconnect(); resolve(payload);
    await expect(result).rejects.toThrow('retired');
  });
  it('does not admit a cancelled image request', async () => {
    const client = new OpenClawClient();
    const request = vi.spyOn(client, 'request');
    const controller = new AbortController(); controller.abort();
    await expect(client.resolveArtifact(artifactId, sessionKey, controller.signal)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
});
