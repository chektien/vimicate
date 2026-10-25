// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { HistoryPublicationAuthority } from './historyPublicationAuthority';
import { SessionRunRegistry } from './sessionRunRegistry';
import { gatewayResponseFailure } from './gatewayRequestDelivery';
vi.mock('../storage/workspaceStore', () => ({ loadValue: vi.fn(async () => null), saveValue: vi.fn(async () => {}) }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'composed-send' }));
vi.mock('../../modules/vimicate-diagnostics', () => ({ latestFatalDiagnostic: () => null, recentViewportDiagnostics: () => [] }));
import { useGatewayQueuedPrompts } from './useGatewayQueuedPrompts';
import { useGatewaySubmission } from './useGatewaySubmission';

const generation = '00000000-0000-4000-8000-000000000106';
// "pending-status" replies interrupt while the first custody read is still in
// flight. "not-ready" is a non-injectable run named only as the attached run.
it.each(['ordinary', 'scheduled', 'announcement', 'ordinary pending-status', 'ordinary not-ready', 'ordinary image', 'ordinary image auto-pickup'])('composes steer refusal, one queued turn and literal interrupt for %s work', async origin => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const root = createRoot(document.createElement('div')); const rows: WorkspaceMessage[] = [];
  const authority = { current: new HistoryPublicationAuthority() };
  const registry = { current: new SessionRunRegistry() }; registry.current.registerRun('notes', 'predecessor');
  const queuedIds = new Set<string>(); let submit!: ReturnType<typeof useGatewaySubmission>;
  let queue!: ReturnType<typeof useGatewayQueuedPrompts>; let consumed = false;
  const attachments = origin.includes('image') ? [{ id: 'image', uri: 'file:///synthetic/image.png', filename: 'image.png', mimeType: 'image/png', byteCount: 1, dataBase64: 'AQ==', kind: 'image' as const }] : [];
  const prepareAttachments = vi.fn(async () => attachments);
  const setDetail = vi.fn(); let holdFirstRead = origin.endsWith('pending-status');
  const client = {
    request: vi.fn(async (method: string, params?: Record<string, unknown>) => method === 'chat.history' && holdFirstRead && !(holdFirstRead = false)
      ? new Promise<never>(() => {})
      : method === 'chat.abort'
      ? { ok: true, aborted: true, runIds: [params!.runId] }
      : { sessionKey: 'notes', sessionId: generation, inputReceipts: queuedIds.has((params!.inputRunIds as string[])[0]!)
        ? [consumed ? { runId: (params!.inputRunIds as string[])[0], state: 'consumed', consumedByEventId: 'saved-image-input' }
          : { runId: (params!.inputRunIds as string[])[0], state: 'pending', queued: true }] : [] }),
    readSessionRunTruth: vi.fn(async () => ({ session: { key: 'notes', sessionId: generation, hasActiveRun: true,
      ...(origin.endsWith('not-ready') ? { attachedRunId: 'predecessor' } : { activeRunId: 'predecessor' }),
      ...(origin === 'scheduled' ? { activeRunOrigin: { kind: origin, runId: 'predecessor', sessionId: generation } } : {}) } })),
    send: vi.fn(async (_key: string, _text: string, _attachments: unknown, id: string, control: { queueMode: string }) => {
      if (control.queueMode === 'steer') throw gatewayResponseFailure({ code: 'INVALID_REQUEST', details: {
        reason: origin.endsWith('not-ready') ? 'run_not_ready' : 'tool_authority_mismatch', inputDisposition: 'not-dispatched', expectedActiveRunId: 'predecessor', activeRunId: 'predecessor' } });
      queuedIds.add(id); return { runId: id, status: 'started' };
    }),
  };
  function Component() {
    const queuedPrompts = useGatewayQueuedPrompts({ endpoint: 'ws://composed', status: 'connected', client,
      authority, runRegistry: registry, selectedSessionKey: 'notes', selectedSessionId: generation });
    queue = queuedPrompts;
    submit = useGatewaySubmission({ client: client as never, status: 'connected', commands: [],
      projects: [{ id: 'notes', sessionKey: 'notes', sessionId: generation, name: 'Notes', path: '', branch: '', starred: false, threadCount: 0, state: 'idle' }],
      messages: rows, selectedRef: { current: 'notes' }, registrySnapshot: { current: null }, runRegistry: registry,
      scenePublicationAuthority: authority, queuedPrompts, setDetail,
      updateSessionMessages: (_key, action) => { rows.splice(0, rows.length, ...(typeof action === 'function' ? action(rows.slice()) : action)); },
      preparePromptSubmission: vi.fn(), publishSelectedRun: vi.fn(), persistRuns: vi.fn(), loadHistory: vi.fn(async () => []),
      loadPendingApprovals: vi.fn(async () => {}), decideApproval: vi.fn(async () => false), loadSessions: vi.fn(async () => {}),
      acceptThreadRegistryMutation: vi.fn(), startRunMonitor: vi.fn(), reconnect: vi.fn(async () => {}), repair: vi.fn(async () => {}), recordLocalInteraction: vi.fn(),
    });
    return null;
  }
  try {
    await act(async () => root.render(<Component />));
    await act(async () => { expect(await submit('next task', prepareAttachments, 'notes', attachments)).toBe(true); });
    expect(prepareAttachments).toHaveBeenCalledOnce();
    expect(client.send).toHaveBeenCalledTimes(2);
    expect(client.send.mock.calls.map(call => call[2])).toEqual([attachments, attachments]);
    expect(client.send.mock.calls.map(call => call[4].queueMode)).toEqual(['steer', 'followup']);
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ text: 'next task', idempotencyKey: 'composed-send:followup' });
    expect(setDetail).toHaveBeenCalledWith(expect.stringContaining('Reply "interrupt"'));
    if (origin.endsWith('auto-pickup')) {
      expect(queue.view(rows[0]!)?.state).toBe('queued');
      consumed = true;
      await act(async () => queue.refresh());
      expect(queue.view(rows[0]!)).toMatchObject({ state: 'consumed', canCancel: false, canRunNow: false });
      expect(client.send).toHaveBeenCalledTimes(2);
      expect(client.request.mock.calls.some(call => call[0] === 'chat.abort')).toBe(false);
      return;
    }
    await act(async () => { expect(await submit('interrupt')).toBe(true); });
    expect(client.send).toHaveBeenCalledTimes(2); expect(rows).toHaveLength(1);
    expect(client.request.mock.calls.filter(call => call[0] === 'chat.abort')).toEqual([
      ['chat.abort', { sessionKey: 'notes', runId: 'predecessor' }],
    ]);
    expect(registry.current.stopWasConfirmed('notes', 'predecessor')).toBe(true);
    if (attachments.length) {
      consumed = true;
      await act(async () => queue.refresh());
      expect(queue.view(rows[0]!)).toMatchObject({ state: 'consumed', canCancel: false, canRunNow: false });
      expect(client.send).toHaveBeenCalledTimes(2);
    }
  } finally { await act(async () => root.unmount()); }
});
