import { expect, it, vi } from 'vitest';
vi.mock('expo-crypto', () => ({ randomUUID: () => 'census' }));
vi.mock('expo-device', () => ({ isDevice: false, deviceType: 2, DeviceType: { PHONE: 1, TABLET: 2 } }));
vi.mock('../../modules/vimicate-diagnostics', () => ({ recordGatewayDiagnostic: () => undefined }));
vi.mock('./deviceIdentity', () => ({ buildDeviceAuth: async () => ({}), loadOrCreateIdentity: async () => ({}) }));
vi.mock('./mobileBootstrap', () => ({ bootstrapMobileOperator: async () => ({ deviceToken: '', scopes: [] }) }));
import { OpenClawClient } from './OpenClawClient';
import { sessionEntriesFromPayload } from '../workspace/workspaceTypes';

const details = {
  contextWindows: [1000], contextWindowDefault: 1000, thinkingLevels: ['high'], thinkingOptions: [],
  thinkingDefault: 'high', toolOverrides: {}, providerReview: { status: 'ready' }, nativeRuntimeConsent: 'consent',
  contextBudgetStatus: {}, agentRuntime: { id: 'claude-cli' }, pluginExtensions: { fixture: {} },
};
const full = (fields = {}) => ({ sessions: [{ key: 'thread', sessionId: 'generation', lifecycleRevision: 'life', sessionModelRevision: 'model', kind: 'direct', ...details, ...fields }], defaults: { agentRuntime: { id: 'codex' } } });
const compact = (fields = {}) => ({ sessions: [{ key: 'thread', sessionId: 'generation', lifecycleRevision: 'life', sessionModelRevision: 'model', kind: 'direct', rowMode: 'compact', ...fields }], defaults: { agentRuntime: { id: 'codex' } } });
const deferred = () => { let resolve!: (value: unknown) => void; const promise = new Promise(resolveValue => { resolve = resolveValue; }); return { promise, resolve }; };

it('hydrates full details once and retains every omitted detail during routine compact census', async () => {
  const client = new OpenClawClient(); const request = vi.spyOn(client, 'request');
  request.mockResolvedValueOnce(full({ unread: true, lastRunError: 'old' })).mockResolvedValueOnce(compact({ totalTokens: 456 }));
  await client.listSessions(); const payload = await client.listSessions();
  expect(request.mock.calls.map(call => call.slice(0, 2))).toEqual([
    ['sessions.list', { limit: 1000 }], ['sessions.list', { limit: 1000, rowMode: 'compact' }],
  ]);
  expect(payload.sessions).toEqual([{ ...compact().sessions[0], ...details, totalTokens: 456 }]);
  expect(sessionEntriesFromPayload(payload)[0]).toMatchObject({ agentRuntime: 'claude-cli', totalTokens: 456 });
  expect(sessionEntriesFromPayload(payload)[0]?.unread).toBeUndefined();
});

it('explicit detail reload replaces rather than inherits full-row omissions and tombstones', async () => {
  const client = new OpenClawClient(); const request = vi.spyOn(client, 'request');
  request.mockResolvedValueOnce(full()).mockResolvedValueOnce({ sessions: [{ key: 'thread', sessionId: 'generation', lifecycleRevision: 'life', sessionModelRevision: 'model' }] }).mockResolvedValueOnce(compact());
  await client.listSessions(); await client.listSessions(true); const result = await client.listSessions();
  expect(request.mock.calls[1]?.[1]).toEqual({ limit: 1000 });
  expect((result.sessions as Record<string, unknown>[])[0]?.agentRuntime).toBeUndefined();
});

it.each([{ sessionId: 'new' }, { lifecycleRevision: 'new' }, { sessionModelRevision: 'new' }, { key: 'new-thread' }])('hydrates incompatible compact identity before exposing runtime defaults %#', async fields => {
  const client = new OpenClawClient(); const request = vi.spyOn(client, 'request');
  request.mockResolvedValueOnce(full()).mockResolvedValueOnce(compact(fields)).mockResolvedValueOnce(full({ ...fields, agentRuntime: { id: 'native' } }));
  await client.listSessions(); const result = await client.listSessions();
  expect(request).toHaveBeenCalledTimes(3); expect(request.mock.calls[2]?.[1]).toEqual({ limit: 1000 });
  expect(sessionEntriesFromPayload(result)[0]?.agentRuntime).toBe('native');
});

it.each([null, [], {}, { sessions: null }, { sessions: [null] }, { sessions: [{ key: 3 }] }, { sessions: [{ key: 'x', rowMode: 'tiny' }] }, { sessions: [{ key: 'x', sessionId: 3 }] }, { sessions: [{ key: 'x' }, { key: 'x' }] }, { sessions: Array.from({ length: 1001 }, (_, i) => ({ key: String(i) })) }])('rejects malformed census before it can acquire detail-cache authority %#', async payload => {
  const client = new OpenClawClient(); vi.spyOn(client, 'request').mockResolvedValue(payload);
  await expect(client.listSessions()).rejects.toThrow(/session census/i);
});

it('evicts disappeared rows rather than accumulating a connection-lifetime cache', async () => {
  const client = new OpenClawClient(); const request = vi.spyOn(client, 'request');
  request.mockResolvedValueOnce(full()).mockResolvedValueOnce({ sessions: [] }).mockResolvedValueOnce(compact()).mockResolvedValueOnce(full());
  await client.listSessions(); await client.listSessions(); await client.listSessions();
  expect(request).toHaveBeenCalledTimes(4); expect(request.mock.calls[3]?.[1]).toEqual({ limit: 1000 });
});

it('disconnect retires full-row facts and rejects late cache publication', async () => {
  const client = new OpenClawClient(); const request = vi.spyOn(client, 'request'); const old = deferred();
  request.mockReturnValueOnce(old.promise);
  const pending = client.listSessions(); client.disconnect();
  request.mockResolvedValueOnce(full({ agentRuntime: { id: 'native' } })); await client.listSessions();
  old.resolve(full()); await expect(pending).rejects.toThrow(/retired/i);
  request.mockResolvedValueOnce(compact());
  expect(sessionEntriesFromPayload(await client.listSessions())[0]?.agentRuntime).toBe('native');
});

it('an older concurrent read cannot overwrite newer detail authority', async () => {
  const client = new OpenClawClient(); const request = vi.spyOn(client, 'request'); const old = deferred();
  request.mockReturnValueOnce(old.promise).mockResolvedValueOnce(full({ agentRuntime: { id: 'native' } }));
  const pending = client.listSessions(); await client.listSessions(); old.resolve(full()); await pending;
  request.mockResolvedValueOnce(compact());
  expect(sessionEntriesFromPayload(await client.listSessions())[0]?.agentRuntime).toBe('native');
});

it('accepts long identity strings that the Gateway contract leaves unbounded', async () => {
  const client = new OpenClawClient(); const request = vi.spyOn(client, 'request');
  const key = `agent:main:${'k'.repeat(2048)}`; const sessionId = 's'.repeat(512);
  request.mockResolvedValueOnce(full({ key, sessionId }));
  const payload = await client.listSessions();
  expect((payload.sessions as Record<string, unknown>[])[0]).toMatchObject({ key, sessionId });
});
