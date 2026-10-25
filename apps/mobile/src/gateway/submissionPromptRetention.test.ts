import { describe, expect, it, vi } from 'vitest';
import { type WorkspaceMessage, type WorkspaceProject } from '../workspace/workspaceTypes';
import { messagesFromPayload } from '../workspace/historyMessageProjection';
import { guardedPromptSubmission } from '../prompt/guardedSubmission';
import { gatewayRequestFailure, gatewayResponseFailure } from './gatewayRequestDelivery';
import type { QueuedPromptTracking } from './queuedPromptSubmission';
import { HistoryPublicationAuthority } from './historyPublicationAuthority';
import { SessionRunRegistry } from './sessionRunRegistry';

vi.mock('react', () => ({ useCallback: (callback: unknown) => callback }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'submission-one' }));
vi.mock('../../modules/vimicate-diagnostics', () => ({ latestFatalDiagnostic: () => null, recentViewportDiagnostics: () => ['12:00:00.000 viewport.dataset ds=abcd'] }));
import { useGatewaySubmission } from './useGatewaySubmission';
import { mergeLatestHistory } from './historyPagination';
import { latestPresentationWindow } from './historyWindow';
import { ownedRunLifecycleSignal, runLifecycleSignalForGatewayFrame } from './runLifecycleProjection';

const project: WorkspaceProject = {
  id: 'notes', sessionKey: 'notes', name: 'notes', path: '~/notes', branch: 'main',
  starred: false, threadCount: 1, state: 'idle',
};

function harness(options: { status?: 'connected' | 'idle'; send?: () => Promise<Record<string, unknown>>; health?: () => Promise<Record<string, unknown>>; abort?: () => Promise<Record<string, unknown>>; readSessionRunTruth?: () => Promise<Record<string, unknown>>; queuedPrompts?: QueuedPromptTracking } = {}) {
  const rows: WorkspaceMessage[] = [];
  const selectedRef = { current: 'notes' };
  const scenePublicationAuthority = { current: new HistoryPublicationAuthority() };
  const setDetail = vi.fn();
  const runRegistry = { current: new SessionRunRegistry() };
  const client = {
    status: 'connected',
    send: vi.fn(options.send ?? (async () => ({ runId: 'run-one' }))),
    ...(options.readSessionRunTruth ? { readSessionRunTruth: vi.fn(options.readSessionRunTruth) } : {}),
    health: vi.fn(options.health ?? (async () => ({ ok: true }))),
    abort: vi.fn(options.abort ?? (async () => ({ ok: true, aborted: false, runIds: [] }))),
  };
  const submit = useGatewaySubmission({
    client: client as never, status: options.status ?? 'connected', commands: [], projects: [{ ...project, sessionId: '00000000-0000-4000-8000-000000000106' }], messages: [],
    selectedRef, registrySnapshot: { current: null }, runRegistry,
    setDetail,
    updateSessionMessages: (sessionKey, action) => {
      const next = typeof action === 'function' ? action(rows.slice()) : action;
      rows.splice(0, rows.length, ...latestPresentationWindow(next.filter((message) => message.sessionKey === sessionKey || !message.sessionKey)));
    },
    preparePromptSubmission: vi.fn(), publishSelectedRun: vi.fn(), persistRuns: vi.fn(),
    loadHistory: vi.fn(async () => []), loadPendingApprovals: vi.fn(async () => {}), decideApproval: vi.fn(async () => false),
    loadSessions: vi.fn(async () => {}), acceptThreadRegistryMutation: vi.fn(), startRunMonitor: vi.fn(),
    reconnect: vi.fn(async () => {}), repair: vi.fn(async () => {}), recordLocalInteraction: vi.fn(),
    scenePublicationAuthority,
    ...(options.queuedPrompts ? { queuedPrompts: options.queuedPrompts } : {}),
    rejectPromptSubmission: (_key, id) => { const index = rows.findIndex(row => row.id === id && row.source === 'local'); if (index >= 0) rows.splice(index, 1); },
  });
  const replaceRows = (next: WorkspaceMessage[]) => rows.splice(0, rows.length, ...next);
  return { submit, rows, replaceRows, client, selectedRef, scenePublicationAuthority, setDetail, runRegistry };
}

function pendingCall<T>() {
  let settle!: { resolve: (value: T) => void; reject: (error: unknown) => void };
  const promise = new Promise<T>((resolve, reject) => { settle = { resolve, reject }; });
  let observed!: () => void;
  const invoked = new Promise<void>((resolve) => { observed = resolve; });
  return { promise, invoked, resolve: settle!.resolve, reject: settle!.reject, call: () => { observed(); return promise; } };
}

describe('submission prompt retention', () => {
  it(':stop reports a negative receipt without masking a later failure', async () => {
    const test = harness(); test.runRegistry.current.registerRun('notes', 'active-run');
    await expect(test.submit(':stop')).resolves.toBe(true);
    expect(test.client.abort).toHaveBeenCalledWith('notes', 'active-run');
    expect(test.rows.some(row => row.text === ':stop — Gateway did not stop this run.')).toBe(true);
    test.runRegistry.current.observePhase('notes', 'failed', 'active-run');
    expect(test.runRegistry.current.phaseFor('notes')).toBe('failed');
  });
  it(':stop confirms its exact run after an early terminal event', async () => {
    const gateway = pendingCall<Record<string, unknown>>(); const test = harness({ abort: gateway.call });
    test.runRegistry.current.registerRun('notes', 'active-run'); const pending = test.submit(':stop'); await gateway.invoked;
    test.runRegistry.current.observePhase('notes', 'failed', 'active-run');
    gateway.resolve({ ok: true, aborted: true, runIds: ['active-run'] }); await pending;
    expect(test.runRegistry.current.phaseFor('notes')).toBe('completed');
    expect(test.rows.some(row => row.text === ':stop — Stop accepted.')).toBe(true);
  });
  it.each(['idle', 'active'])('sends a pasted multiline diagnostics report literally while %s', async (mode) => {
    const test = harness();
    if (mode === 'active') test.runRegistry.current.registerRun('notes', 'active-run');
    const report = ':diagnostics — retained fatal breadcrumb\nat=1789888492883 fatal.native Maximum update depth exceeded\nstack locations:\nFlashList @ index.js:90343:7\n[diagnostic shortened]est';
    await expect(test.submit(report)).resolves.toBe(true);
    expect(test.client.send).toHaveBeenCalledOnce();
    expect(test.client.send).toHaveBeenCalledWith('notes', expect.stringContaining(`User prompt:\n${report}`), [], 'submission-one', ...(mode === 'active' ? [{ queueMode: 'steer', steerPolicy: 'require-active', expectedActiveRunId: 'active-run' }] : []));
    expect(test.rows.filter(row => row.role === 'user').map(row => row.text)).toEqual([report]);
    expect(test.setDetail).not.toHaveBeenCalledWith(':diagnostics takes no arguments.');
  });

  it('retains explicit single-line diagnostics command validation', async () => {
    const test = harness();
    await expect(test.submit(':diagnostics unexpected')).resolves.toBe(false);
    expect(test.setDetail).toHaveBeenCalledWith(':diagnostics takes no arguments.');
    await expect(test.submit(':diagnostics')).resolves.toBe(true);
    expect(test.client.send).not.toHaveBeenCalled();
    expect(test.rows.some((row) => row.role === 'command' && row.text.startsWith(':diagnostics — no retained fatal breadcrumb\nrecent viewport (oldest to newest)\n12:00:00.000 viewport.dataset ds=abcd\ntranscript rows (oldest to newest)\n'))).toBe(true);
  });

  it('explicitly steers active ordinary input without replacing or aborting its run', async () => {
    const test = harness();
    test.runRegistry.current.registerRun('notes', 'active-run');
    await expect(test.submit('pause safely', [])).resolves.toBe(true);
    expect(test.client.send).toHaveBeenCalledWith('notes', expect.any(String), [], 'submission-one', { queueMode: 'steer', steerPolicy: 'require-active', expectedActiveRunId: 'active-run' });
    expect(test.runRegistry.current.runFor('notes')).toBe('active-run');
    expect(test.rows[0]?.runId).toBe('active-run');
    expect(test.rows[0]?.inputReceiptRunId).toBe('run-one');
  });

  it('never registers a queued receipt as the running turn after a concurrent census', async () => {
    const gateway = pendingCall<Record<string, unknown>>();
    const test = harness({ send: gateway.call });
    test.runRegistry.current.registerRun('notes', 'streaming-run');
    test.runRegistry.current.observePhase('notes', 'running', 'streaming-run');
    const submission = test.submit('queued follow-up');
    await gateway.invoked;
    test.runRegistry.current.finishRun('notes', 'streaming-run');
    gateway.resolve({ runId: 'queued-receipt' });
    await expect(submission).resolves.toBe(true);
    expect(test.runRegistry.current.runFor('notes')).toBe('');
    expect(test.rows.find(row => row.role === 'user')).toMatchObject({
      runId: 'streaming-run', inputReceiptRunId: 'queued-receipt',
    });
    const receiptFinal = runLifecycleSignalForGatewayFrame({ event: 'chat', payload: {
      sessionKey: 'notes', runId: 'queued-receipt', state: 'final',
    } });
    expect(receiptFinal).toMatchObject({ runId: 'queued-receipt', phase: 'completed' });
    expect(ownedRunLifecycleSignal(receiptFinal, test.runRegistry.current)).toBeNull();
    expect(test.runRegistry.current.phaseFor('notes')).toBe('completed');
  });

  it('retires pending custody when its acknowledgement resolves after the history page', async () => {
    const gateway = pendingCall<Record<string, unknown>>();
    const test = harness({ send: gateway.call });
    test.runRegistry.current.registerRun('notes', 'active-run');
    const submission = test.submit('keep both identities exact');
    await gateway.invoked;
    const pending = messagesFromPayload({
      sessionKey: 'notes', sessionId: '00000000-0000-4000-8000-000000000106',
      messages: [
        { role: 'assistant', content: 'earlier commentary', timestamp: 1789839783000,
          __openclaw: { id: 'earlier', transcriptPosition: { source: 'sqlite', rawSeq: 10 } } },
        { role: 'assistant', content: 'newer commentary', timestamp: 1789839784000,
          __openclaw: { id: 'newer', transcriptPosition: { source: 'sqlite', rawSeq: 11 } } },
      ],
      pendingInputs: { items: [{
        id: 'queued-input', runId: 'queued-receipt', acceptedAt: 1789839783745, state: 'queued',
        message: { role: 'user', content: 'keep both identities exact', __openclaw: { id: 'pending:queued-input' } },
      }] },
    });
    test.replaceRows(mergeLatestHistory(pending, test.rows, 'notes'));
    expect(test.rows.filter(row => row.role === 'user')).toHaveLength(2);

    gateway.resolve({ runId: 'queued-receipt', status: 'started' });
    await expect(submission).resolves.toBe(true);
    expect(test.rows.filter(row => row.role === 'user')).toEqual([expect.objectContaining({
      id: 'local-submission-one', runId: 'active-run', inputReceiptRunId: 'queued-receipt',
      inputAcceptedAtMs: 1789839783745,
    })]);
    // Receipt publication itself must fix the slot, without another history fetch.
    expect(test.rows.map(row => row.text)).toEqual([
      'earlier commentary', 'keep both identities exact', 'newer commentary',
    ]);
  });

  it('restores a draft if backgrounding interrupts attachment preparation before any send', async () => {
    const attachments = pendingCall<[]>();
    const test = harness();
    const outcome = guardedPromptSubmission(() => test.submit('review the attachment', attachments.promise));
    test.scenePublicationAuthority.current.suspend();
    attachments.resolve([]);
    await expect(outcome).resolves.toEqual({ kind: 'rejected' });
    expect(test.client.send).not.toHaveBeenCalled();
    expect(test.rows).toEqual([]);
  });

  it('does not send an empty second prompt when a cleared attachment draft is still in a stale render snapshot', async () => {
    const test = harness();
    const stalePreview = {
      id: 'slide-preview', uri: 'file:///slide.png', filename: 'slide.png',
      mimeType: 'image/png', byteCount: 775883, kind: 'image' as const,
    };
    const firstPayload = { ...stalePreview, dataBase64: 'AQIDBA==' };

    await expect(test.submit('review these slide changes', Promise.resolve([firstPayload]), 'notes', [stalePreview])).resolves.toBe(true);
    await expect(test.submit('', Promise.resolve([]), 'notes', [stalePreview])).resolves.toBe(false);
    expect(test.client.send).toHaveBeenCalledOnce();
    expect(test.rows.filter((row) => row.role === 'user')).toEqual([
      expect.objectContaining({ text: 'review these slide changes', attachments: [expect.objectContaining({ id: 'slide-preview' })] }),
    ]);
  });

  it('does not display a stale image on a later text-only submission', async () => {
    const test = harness();
    const stalePreview = {
      id: 'slide-preview', uri: 'file:///slide.png', filename: 'slide.png',
      mimeType: 'image/png', byteCount: 775883, kind: 'image' as const,
    };

    await expect(test.submit('next instruction', Promise.resolve([]), 'notes', [stalePreview])).resolves.toBe(true);
    expect(test.client.send).toHaveBeenCalledWith('notes', expect.any(String), [], 'submission-one');
    expect(test.rows.filter((row) => row.role === 'user')).toEqual([
      expect.objectContaining({ text: 'next instruction' }),
    ]);
    expect(test.rows[0]?.attachments).toBeUndefined();
  });

  it('retains a real image-only submission after materialization', async () => {
    const test = harness();
    const image = {
      id: 'new-slide', uri: 'file:///new-slide.png', filename: 'new-slide.png',
      mimeType: 'image/png', byteCount: 4, kind: 'image' as const,
    };
    const payload = { ...image, dataBase64: 'AQIDBA==' };

    await expect(test.submit('', Promise.resolve([payload]), 'notes', [image])).resolves.toBe(true);
    expect(test.client.send).toHaveBeenCalledWith('notes', expect.any(String), [payload], 'submission-one');
    expect(test.rows[0]?.attachments).toEqual([expect.objectContaining({ id: 'new-slide' })]);
  });

  it.each(['offline', 'retired'] as const)('does not invoke lazy media preparation after %s admission refusal', async reason => {
    const test = harness({ status: reason === 'offline' ? 'idle' : 'connected' });
    if (reason === 'retired') test.scenePublicationAuthority.current.suspend();
    const prepare = vi.fn(async () => { throw new Error('synthetic unreadable image'); });
    const image = { id: 'image', uri: 'file:///synthetic/image.png', filename: 'image.png', mimeType: 'image/png', byteCount: 1, kind: 'image' as const };
    await expect(test.submit('', prepare, 'notes', [image])).resolves.toBe(false);
    expect(prepare).not.toHaveBeenCalled(); expect(test.client.send).not.toHaveBeenCalled();
    expect(test.rows).toEqual([]); expect(test.runRegistry.current.isBusy('notes')).toBe(false);
  });

  it.each(['', 'review the image'])('owns an admitted media preparation rejection without a sent row for text=%j', async text => {
    const test = harness();
    const prepare = vi.fn(async () => { throw new Error('synthetic unreadable image'); });
    const image = { id: 'image', uri: 'file:///synthetic/image.png', filename: 'image.png', mimeType: 'image/png', byteCount: 1, kind: 'image' as const };
    await expect(guardedPromptSubmission(() => test.submit(text, prepare, 'notes', [image]))).resolves.toEqual({ kind: 'rejected' });
    expect(prepare).toHaveBeenCalledOnce(); expect(test.client.send).not.toHaveBeenCalled();
    expect(test.rows).toEqual([]); expect(test.runRegistry.current.isBusy('notes')).toBe(false);
    expect(test.setDetail).toHaveBeenLastCalledWith('synthetic unreadable image');
  });

  it('publishes a lazy image-only payload only after preparation and retains it on an unconfirmed acknowledgement', async () => {
    const prepared = pendingCall<import('../prompt/promptAttachments').GatewayPromptAttachment[]>();
    const receipt = pendingCall<Record<string, unknown>>();
    const test = harness({ send: receipt.call });
    const image = { id: 'image', uri: 'file:///synthetic/image.png', filename: 'image.png', mimeType: 'image/png', byteCount: 1, kind: 'image' as const };
    const prepare = vi.fn(prepared.call);
    const pending = test.submit('', prepare, 'notes', [image]);
    expect(test.rows).toEqual([]); expect(test.client.send).not.toHaveBeenCalled();
    prepared.resolve([{ ...image, dataBase64: 'AQ==' }]); await receipt.invoked;
    expect(test.rows[0]?.attachments).toEqual([expect.objectContaining({ id: image.id })]);
    receipt.reject(gatewayRequestFailure('synthetic lost receipt', true));
    await expect(pending).resolves.toBe(true);
    expect(prepare).toHaveBeenCalledOnce(); expect(test.client.send).toHaveBeenCalledOnce();
    expect(test.rows[0]?.attachments).toEqual([expect.objectContaining({ id: image.id })]);
  });

  it('reports a prompt as sent when the scene retires after its transcript row and frame are committed', async () => {
    const gateway = pendingCall<Record<string, unknown>>();
    const test = harness({ send: gateway.call });
    const submission = test.submit('ship the release notes');
    expect(test.rows.map((row) => row.text)).toEqual(['ship the release notes']);

    await gateway.invoked;
    // Home, lock, or any non-active scene tick suspends publication and tears
    // down the socket, so the in-flight `chat.send` never answers.
    test.scenePublicationAuthority.current.suspend();
    gateway.reject(new Error('Gateway disconnected'));

    await expect(submission).resolves.toBe(true);
    expect(test.rows.map((row) => row.text)).toEqual(['ship the release notes']);
    expect(test.client.send).toHaveBeenCalledOnce();
  });

  it('reports the same outcome when the retired submission no longer owns the selected thread', async () => {
    const gateway = pendingCall<Record<string, unknown>>();
    const test = harness({ send: gateway.call });
    const submission = test.submit('ship the release notes');
    expect(test.rows).toHaveLength(1);

    await gateway.invoked;
    test.selectedRef.current = 'other-thread';
    test.scenePublicationAuthority.current.suspend();
    gateway.reject(new Error('Gateway disconnected'));

    await expect(submission).resolves.toBe(true);
    expect(test.rows).toHaveLength(1);
    expect(test.client.send).toHaveBeenCalledOnce();
  });

  it('still rejects a send that never reached the Gateway, so its draft is preserved and its row is withdrawn', async () => {
    const test = harness({ send: async () => { throw gatewayRequestFailure('Gateway is not connected', false); } });

    await expect(test.submit('ship the release notes')).resolves.toBe(false);
    expect(test.rows).toEqual([]);
    expect(test.setDetail).toHaveBeenCalledWith('Gateway is not connected');
  });

  it('reports a prompt as sent when the frame reached the Gateway and the reconnect discarded its answer', async () => {
    const gateway = pendingCall<Record<string, unknown>>();
    const test = harness({ send: gateway.call });
    const submission = test.submit('ship the release notes');
    expect(test.rows.map((row) => row.text)).toEqual(['ship the release notes']);

    await gateway.invoked;
    // No scene change: the socket dropped, and the reconnect rejected every
    // request still pending. The frame is already on the wire, so the Gateway
    // may have accepted, run and stored the prompt before the answer was lost.
    gateway.reject(gatewayRequestFailure('Gateway disconnected', true));

    await expect(submission).resolves.toBe(true);
    expect(test.rows.map((row) => row.text)).toEqual(['ship the release notes']);
    expect(test.client.send).toHaveBeenCalledOnce();
    expect(test.setDetail).toHaveBeenCalledWith('prompt sent; reconnecting for its answer');
  });

  it('reports a delivered prompt as sent when the selection moved to another thread', async () => {
    const gateway = pendingCall<Record<string, unknown>>();
    const test = harness({ send: gateway.call });
    const submission = test.submit('ship the release notes');
    expect(test.rows).toHaveLength(1);

    await gateway.invoked;
    test.selectedRef.current = 'other-thread';
    gateway.reject(gatewayRequestFailure('chat.send timed out', true));

    await expect(submission).resolves.toBe(true);
    expect(test.rows).toHaveLength(1);
    expect(test.client.send).toHaveBeenCalledOnce();
  });

  it('routes a delivered prompt whose answer was lost to prompt history rather than draft restoration', async () => {
    const gateway = pendingCall<Record<string, unknown>>();
    const test = harness({ send: gateway.call });
    const outcome = guardedPromptSubmission(() => test.submit('ship the release notes'));

    await gateway.invoked;
    gateway.reject(gatewayRequestFailure('Gateway disconnected', true));

    await expect(outcome).resolves.toEqual({ kind: 'accepted' });
  });

  it('still rejects a command whose frame reached the Gateway, because a command publishes no prompt row', async () => {
    const health = pendingCall<Record<string, unknown>>();
    const test = harness({ health: health.call });
    const submission = test.submit(':healthcheck');

    await health.invoked;
    health.reject(gatewayRequestFailure('Gateway disconnected', true));

    await expect(submission).resolves.toBe(false);
    expect(test.rows).toEqual([]);
  });

  it('routes the retired prompt to prompt history rather than draft restoration', async () => {
    const gateway = pendingCall<Record<string, unknown>>();
    const test = harness({ send: gateway.call });
    // Exactly the boundary the prompt owner reads: `accepted` records the
    // prompt in history and leaves the pane empty; anything else restores the
    // draft into the pane or merges it into the session's saved draft.
    const outcome = guardedPromptSubmission(() => test.submit('ship the release notes'));

    await gateway.invoked;
    test.scenePublicationAuthority.current.suspend();
    gateway.reject(new Error('Gateway disconnected'));

    await expect(outcome).resolves.toEqual({ kind: 'accepted' });
  });

  it('still rejects a retired command that published no prompt row', async () => {
    const health = pendingCall<Record<string, unknown>>();
    const test = harness({ health: health.call });
    const submission = test.submit(':healthcheck');

    await health.invoked;
    test.scenePublicationAuthority.current.suspend();
    health.reject(new Error('Gateway disconnected'));

    await expect(submission).resolves.toBe(false);
    expect(test.rows).toEqual([]);
  });
});

it('retries async answers using their original outbox key, exact Control UI body and reply anchor', async () => {
  const test = harness(); const states: string[] = []; const body = '> Which route?\n\nSecond';
  const delivery = { idempotencyKey: 'answer-uuid', replyToId: 'source-id', onState: (state: string) => states.push(state) };
  await expect(test.submit(body, [], 'notes', [], delivery)).resolves.toBe(true);
  await expect(test.submit(body, [], 'notes', [], delivery)).resolves.toBe(true);
  expect((test.client.send.mock.calls as unknown[][]).every(call => call[1] === body && call[3] === 'answer-uuid' && call[5] === 'source-id')).toBe(true);
  expect(test.rows.filter(row => row.idempotencyKey === 'answer-uuid')).toHaveLength(1); expect(states).toEqual(['sending', 'accepted', 'sending', 'accepted']);
});

it('restores a refused steer without aborting or replacing the active run', async () => {
  const test = harness({ send: async () => { throw new Error('This run cannot accept steering. Draft kept. Use :interrupt <prompt>.'); } });
  test.runRegistry.current.registerRun('notes', 'scheduled-run');
  const outcome = await guardedPromptSubmission(() => test.submit('ignore my last prompt'));
  expect(outcome.kind).not.toBe('accepted');
  expect(test.rows.filter(row => row.role === 'user')).toEqual([]);
  expect(test.client.send).toHaveBeenCalledOnce();
  expect(test.client.abort).not.toHaveBeenCalled();
  expect(test.runRegistry.current.runFor('notes')).toBe('scheduled-run');
  expect(test.setDetail).toHaveBeenCalledWith(expect.stringContaining('cannot accept steering'));
});

it('explicit interrupt sends only its prompt and fences the exact active run', async () => {
  const test = harness(); test.runRegistry.current.registerRun('notes', 'scheduled-run');
  await expect(test.submit(':interrupt ignore my last prompt')).resolves.toBe(true);
  expect(test.client.send).toHaveBeenCalledWith('notes', expect.stringContaining('User prompt:\nignore my last prompt'), [], 'submission-one', { queueMode: 'interrupt', expectedActiveRunId: 'scheduled-run' });
  expect((test.client.send.mock.calls as unknown[][])[0]?.[1]).not.toContain('User prompt:\n:interrupt');
  expect(test.client.abort).not.toHaveBeenCalled();
  expect(test.runRegistry.current.runFor('notes')).toBe('run-one');
});

it.each([':interrupt', ':interrupt new prompt'])('refuses interrupt without an active target: %s', async input => {
  const test = harness(); await expect(test.submit(input)).resolves.toBe(false);
  expect(test.client.send).not.toHaveBeenCalled(); expect(test.rows).toEqual([]);
});

it('refuses an empty interrupt without changing the run', async () => {
  const test = harness(); test.runRegistry.current.registerRun('notes', 'scheduled-run');
  await expect(test.submit(':interrupt')).resolves.toBe(false);
  expect(test.client.send).not.toHaveBeenCalled(); expect(test.runRegistry.current.runFor('notes')).toBe('scheduled-run');
});

it('keeps pasted multiline interrupt text literal, never a cancellation command', async () => {
  const test = harness(); test.runRegistry.current.registerRun('notes', 'scheduled-run');
  await expect(test.submit(':interrupt example\nthis is pasted text')).resolves.toBe(true);
  expect(test.client.send).toHaveBeenCalledWith('notes', expect.stringContaining('User prompt:\n:interrupt example\nthis is pasted text'), [], 'submission-one', { queueMode: 'steer', steerPolicy: 'require-active', expectedActiveRunId: 'scheduled-run' });
});

it('refused exact interrupt restores the command and preserves a successor run', async () => {
  const gateway = pendingCall<Record<string, unknown>>(); const test = harness({ send: gateway.call });
  test.runRegistry.current.registerRun('notes', 'old-run');
  const pending = test.submit(':interrupt a correction'); await gateway.invoked;
  test.runRegistry.current.registerRun('notes', 'successor');
  gateway.reject(new Error('Active run changed. Refresh before interrupting.'));
  await expect(pending).resolves.toBe(false);
  expect(test.runRegistry.current.runFor('notes')).toBe('successor'); expect(test.rows).toEqual([]);
  expect(test.client.send).toHaveBeenCalledOnce(); expect(test.client.abort).not.toHaveBeenCalled();
});

it('keeps an unconfirmed interrupt visible and never automatically resends it', async () => {
  const test = harness({ send: async () => { throw gatewayRequestFailure('chat.send timed out', true); } });
  test.runRegistry.current.registerRun('notes', 'scheduled-run');
  await expect(test.submit(':interrupt a correction')).resolves.toBe(true);
  expect(test.rows.filter(row => row.role === 'user')).toHaveLength(1);
  expect(test.client.send).toHaveBeenCalledOnce(); expect(test.client.abort).not.toHaveBeenCalled();
});

it('does not replace a newer observed run with a late interrupt acknowledgement', async () => {
  const gateway = pendingCall<Record<string, unknown>>(); const test = harness({ send: gateway.call });
  test.runRegistry.current.registerRun('notes', 'old-run');
  const pending = test.submit(':interrupt a correction'); await gateway.invoked;
  test.runRegistry.current.registerRun('notes', 'newer-run');
  gateway.resolve({ runId: 'interrupt-turn' }); await expect(pending).resolves.toBe(true);
  expect(test.runRegistry.current.runFor('notes')).toBe('newer-run');
  expect(test.rows.find(row => row.role === 'user')).toMatchObject({ runId: 'interrupt-turn' });
});

it.each(['completed', 'cleared'] as const)('does not resurrect a stale interrupt after a successor is %s', async state => {
  const gateway = pendingCall<Record<string, unknown>>(); const test = harness({ send: gateway.call });
  test.runRegistry.current.registerRun('notes', 'old-run');
  const pending = test.submit(':interrupt a correction'); await gateway.invoked;
  test.runRegistry.current.registerRun('notes', 'newer-run');
  if (state === 'completed') test.runRegistry.current.finishRun('notes', 'newer-run');
  else test.runRegistry.current.clear();
  gateway.resolve({ runId: 'interrupt-turn' }); await expect(pending).resolves.toBe(true);
  expect(test.runRegistry.current.runFor('notes')).toBe('');
  expect(test.rows.find(row => row.role === 'user')).toMatchObject({ runId: 'interrupt-turn' });
});

it('accepts a replacement receipt after the targeted run completes', async () => {
  const gateway = pendingCall<Record<string, unknown>>(); const test = harness({ send: gateway.call });
  test.runRegistry.current.registerRun('notes', 'old-run');
  const pending = test.submit(':interrupt a correction'); await gateway.invoked;
  test.runRegistry.current.finishRun('notes', 'old-run');
  gateway.resolve({ runId: 'interrupt-turn' }); await expect(pending).resolves.toBe(true);
  expect(test.runRegistry.current.runFor('notes')).toBe('interrupt-turn');
});

it('preserves intentional spacing in the explicit replacement prompt', async () => {
  const test = harness(); test.runRegistry.current.registerRun('notes', 'scheduled-run');
  await expect(test.submit(':interrupt retain  these   spaces')).resolves.toBe(true);
  expect((test.client.send.mock.calls as unknown[][])[0]?.[1]).toContain('User prompt:\nretain  these   spaces');
});


it('refreshes the actual target after a definitive refusal without resending the prompt', async () => {
  const refusal = gatewayResponseFailure({ code: 'INVALID_REQUEST', message: 'The active run changed. Draft kept.',
    details: { reason: 'active_run_changed', expectedActiveRunId: 'stale', activeRunId: 'untrusted-snapshot', inputDisposition: 'not-dispatched' } });
  const test = harness({ send: async () => { throw refusal; }, readSessionRunTruth: async () => ({ session: { key: 'notes', hasActiveRun: true, activeRunId: 'actual-runtime-owner' } }) });
  test.runRegistry.current.registerRun('notes', 'stale');
  await expect(test.submit('please continue')).resolves.toBe(false);
  expect(test.client.send).toHaveBeenCalledOnce();
  expect(test.client.readSessionRunTruth).toHaveBeenCalledWith('notes');
  expect(test.runRegistry.current.runFor('notes')).toBe('actual-runtime-owner');
  expect(test.rows.filter(row => row.role === 'user')).toEqual([]);
  expect(test.setDetail).toHaveBeenLastCalledWith('The active run changed. Draft kept.');
  expect(test.client.abort).not.toHaveBeenCalled();
});
it('does not refresh or replay an unconfirmed provider write', async () => {
  const test = harness({ send: async () => { throw gatewayResponseFailure({ message: 'Delivery unconfirmed',
    details: { reason: 'active_run_changed', expectedActiveRunId: 'stale', inputDisposition: 'unconfirmed' } }); },
    readSessionRunTruth: async () => ({ session: { key: 'notes', activeRunId: 'new' } }) });
  test.runRegistry.current.registerRun('notes', 'stale');
  await expect(test.submit('please continue')).resolves.toBe(true);
  expect(test.client.readSessionRunTruth).not.toHaveBeenCalled(); expect(test.client.send).toHaveBeenCalledOnce();
  expect(test.rows.some(row => row.role === 'user')).toBe(true);
});

it('a late refusal cannot refresh over an already observed successor', async () => {
  const pending = pendingCall<Record<string, unknown>>();
  const test = harness({ send: pending.call, readSessionRunTruth: async () => ({ session: { key: 'notes', activeRunId: 'older' } }) });
  test.runRegistry.current.registerRun('notes', 'stale');
  const submitted = test.submit('continue'); await pending.invoked;
  test.runRegistry.current.registerRun('notes', 'successor'); test.runRegistry.current.noteLiveFrame('notes', 'successor');
  pending.reject(gatewayResponseFailure({ message: 'Draft kept.', details: { expectedActiveRunId: 'stale', reason: 'active_run_changed', inputDisposition: 'not-dispatched' } }));
  expect(await submitted).toBe(false);
  expect(test.client.readSessionRunTruth).not.toHaveBeenCalled();
  expect(test.runRegistry.current.runFor('notes')).toBe('successor');
});


const informationalRefusals = [
  ['tool_authority_mismatch', 'different tool permissions'],
  ['input_visibility_mismatch', 'cannot receive messages from this chat'],
  ['run_not_ready', 'cannot accept messages right now'],
] as const;
it.each(informationalRefusals)('keeps %s refusals informational without changing run identity or retrying', async (reason, wording) => {
  const failure = gatewayResponseFailure({ code: 'INVALID_REQUEST', message: 'ActiveSteerRejectedError: internal refusal',
    details: { reason, expectedActiveRunId: 'active-run', activeRunId: 'active-run', inputDisposition: 'not-dispatched' } });
  const test = harness({ send: async () => { throw failure; }, readSessionRunTruth: async () => ({}) });
  test.runRegistry.current.registerRun('notes', 'active-run');
  const outcome = await guardedPromptSubmission(() => test.submit('please continue'));
  expect(outcome.kind).not.toBe('accepted');
  expect(test.rows.filter(row => row.role === 'user')).toEqual([]);
  expect(test.rows).toHaveLength(1);
  expect(test.rows[0]).toMatchObject({ role: 'command', state: 'complete', text: expect.stringContaining(wording) });
  expect(test.rows[0]?.text).not.toMatch(/ActiveSteerRejectedError|cron/i);
  expect(test.rows[0]?.text).toContain('draft');
  expect(test.client.readSessionRunTruth).not.toHaveBeenCalled();
  expect(test.client.send).toHaveBeenCalledOnce(); expect(test.client.abort).not.toHaveBeenCalled();
  expect(test.runRegistry.current.runFor('notes')).toBe('active-run');
  expect(test.runRegistry.current.phaseFor('notes')).not.toBe('failed');
});
it.each(informationalRefusals)('does not reinterpret an unconfirmed %s write as safely unsent', async (reason) => {
  const test = harness({ send: async () => { throw gatewayResponseFailure({ message: 'Delivery unconfirmed',
    details: { reason, expectedActiveRunId: 'active-run', activeRunId: 'active-run', inputDisposition: 'unconfirmed' } }); },
    readSessionRunTruth: async () => ({}) });
  test.runRegistry.current.registerRun('notes', 'active-run');
  await expect(test.submit('please continue')).resolves.toBe(true);
  expect(test.rows).toHaveLength(1); expect(test.rows[0]?.role).toBe('user');
  expect(test.client.readSessionRunTruth).not.toHaveBeenCalled();
  expect(test.client.send).toHaveBeenCalledOnce(); expect(test.client.abort).not.toHaveBeenCalled();
});
it.each(informationalRefusals)('a late %s refusal leaves a successor and its transcript intact', async (reason) => {
  const gateway = pendingCall<Record<string, unknown>>();
  const test = harness({ send: gateway.call, readSessionRunTruth: async () => ({}) });
  test.runRegistry.current.registerRun('notes', 'active-run');
  const pending = test.submit('please continue'); await gateway.invoked;
  test.runRegistry.current.registerRun('notes', 'successor');
  test.rows.push({ id: 'next-message', role: 'assistant', text: 'New turn', runId: 'successor', sessionKey: 'notes' });
  gateway.reject(gatewayResponseFailure({ message: 'Internal refusal',
    details: { reason, expectedActiveRunId: 'active-run', activeRunId: 'active-run', inputDisposition: 'not-dispatched' } }));
  await expect(pending).resolves.toBe(false);
  expect(test.runRegistry.current.runFor('notes')).toBe('successor');
  expect(test.rows.find(row => row.id === 'next-message')?.text).toBe('New turn');
  expect(test.client.readSessionRunTruth).not.toHaveBeenCalled();
  expect(test.client.send).toHaveBeenCalledOnce(); expect(test.client.abort).not.toHaveBeenCalled();
});

const queueRefusal = () => gatewayResponseFailure({ code: 'INVALID_REQUEST', message: 'tool permissions differ',
  details: { reason: 'tool_authority_mismatch', expectedActiveRunId: 'cron', activeRunId: 'cron', inputDisposition: 'not-dispatched' } });
function tracking() { return { prepare: vi.fn(async () => {}), accepted: vi.fn(async () => {}), failed: vi.fn(async () => {}) }; }
const scheduledCron = async () => ({ session: { key: 'notes', sessionId: '00000000-0000-4000-8000-000000000106', hasActiveRun: true, activeRunId: 'cron', status: 'running',
  activeRunOrigin: { kind: 'scheduled', runId: 'cron', sessionId: '00000000-0000-4000-8000-000000000106' } } });
it('queues a confirmed permission refusal as one independent user turn, keeping the active cron lifecycle', async () => {
  const queue = tracking(); let calls = 0;
  const test = harness({ queuedPrompts: queue, readSessionRunTruth: scheduledCron, send: async () => {
    if (++calls === 1) throw queueRefusal();
    return { runId: 'submission-one:followup', status: 'started' };
  } });
  test.runRegistry.current.registerRun('notes', 'cron');
  expect(await test.submit('continue after the schedule')).toBe(true);
  expect(test.client.send).toHaveBeenCalledTimes(2);
  expect(test.client.send.mock.calls[1]).toEqual(['notes', expect.stringContaining('continue after the schedule'), [], 'submission-one:followup', { queueMode: 'followup', sessionId: '00000000-0000-4000-8000-000000000106' }]);
  expect(test.rows).toHaveLength(1);
  expect(test.rows[0]).toMatchObject({ role: 'user', idempotencyKey: 'submission-one:followup', inputReceiptRunId: 'submission-one:followup', runId: 'submission-one:followup' });
  expect(test.runRegistry.current.runFor('notes')).toBe('cron');
  expect(test.client.abort).not.toHaveBeenCalled();
  expect(queue.accepted).toHaveBeenCalledOnce();
  expect(test.setDetail).toHaveBeenCalledWith('Message accepted to run automatically after the current task. Checking queue status. Reply "interrupt" to stop the current task and run queued messages next.');
});
it('keeps an uncertain followup standing and never submits it a third time', async () => {
  const queue = tracking(); let calls = 0;
  const test = harness({ queuedPrompts: queue, readSessionRunTruth: scheduledCron, send: async () => { if (++calls === 1) throw queueRefusal(); throw gatewayRequestFailure('connection lost', true); } });
  test.runRegistry.current.registerRun('notes', 'cron');
  expect(await test.submit('do this next')).toBe(true);
  expect(test.client.send).toHaveBeenCalledTimes(2);
  expect(test.rows[0]?.idempotencyKey).toBe('submission-one:followup');
  expect(queue.failed).toHaveBeenCalledOnce(); expect(queue.accepted).not.toHaveBeenCalled();
});
it('restores the draft after a confirmed refusal even when the scene retired before the reply', async () => {
  const pending = pendingCall<Record<string, unknown>>(); const queue = tracking();
  const test = harness({ queuedPrompts: queue, send: pending.call }); test.runRegistry.current.registerRun('notes', 'cron');
  const submission = test.submit('keep this draft'); await pending.invoked;
  test.scenePublicationAuthority.current.suspend(); pending.reject(queueRefusal());
  expect(await submission).toBe(false); expect(test.rows).toEqual([]);
  expect(test.client.send).toHaveBeenCalledOnce(); expect(queue.prepare).not.toHaveBeenCalled();
});
it('restores the draft if suspension retires queue preparation before the followup frame', async () => {
  const prepared = pendingCall<void>(); const queue = { ...tracking(), prepare: vi.fn(prepared.call) };
  const test = harness({ queuedPrompts: queue, readSessionRunTruth: scheduledCron, send: async () => { throw queueRefusal(); } }); test.runRegistry.current.registerRun('notes', 'cron');
  const submission = test.submit('keep this draft'); await prepared.invoked;
  test.scenePublicationAuthority.current.suspend(); prepared.resolve();
  expect(await submission).toBe(false); expect(test.rows).toEqual([]);
  expect(test.client.send).toHaveBeenCalledOnce();
});
it('queues an ordinary run without scheduled origin after exact generation proof', async () => {
  const queue = tracking(); let calls = 0;
  const test = harness({ queuedPrompts: queue, send: async () => { if (++calls === 1) throw queueRefusal(); return { runId: 'submission-one:followup', status: 'started' }; },
    readSessionRunTruth: async () => ({ session: { key: 'notes', sessionId: '00000000-0000-4000-8000-000000000106', hasActiveRun: true, activeRunId: 'cron' } }) });
  test.runRegistry.current.registerRun('notes', 'cron');
  expect(await test.submit('steer this run')).toBe(true);
  expect(test.client.send).toHaveBeenCalledTimes(2); expect(queue.prepare).toHaveBeenCalledOnce();
  expect(test.runRegistry.current.runFor('notes')).toBe('cron');
});
it('never queues an async-question answer using ordinary prompt fallback', async () => {
  const queue = tracking(); const test = harness({ queuedPrompts: queue, send: async () => { throw queueRefusal(); } });
  test.runRegistry.current.registerRun('notes', 'cron');
  expect(await test.submit('answer', [], 'notes', [], { idempotencyKey: 'answer' })).toBe(false);
  expect(test.client.send).toHaveBeenCalledOnce(); expect(queue.prepare).not.toHaveBeenCalled();
});

it('routes literal interrupt to scoped queued control with no prompt send or replacement', async () => {
  const interruptQueued = vi.fn(async () => ({ accepted: true, detail: 'Stop accepted. Queued messages will run next in order.' }));
  const test = harness({ queuedPrompts: { ...tracking(), interruptQueued } });
  test.runRegistry.current.registerRun('notes', 'cron');
  expect(await test.submit('interrupt')).toBe(true);
  expect(interruptQueued).toHaveBeenCalledExactlyOnceWith({ sessionKey: 'notes', sessionId: '00000000-0000-4000-8000-000000000106', predecessorRunId: 'cron' });
  expect(test.client.send).not.toHaveBeenCalled(); expect(test.client.abort).not.toHaveBeenCalled(); expect(test.rows).toEqual([]);
});
it('does not send stale interrupt instructions to the model when no queued control is available', async () => {
  const test = harness(); test.runRegistry.current.registerRun('notes', 'successor');
  expect(await test.submit('interrupt')).toBe(false);
  expect(test.client.send).not.toHaveBeenCalled(); expect(test.client.abort).not.toHaveBeenCalled();
  expect(test.setDetail).toHaveBeenCalledWith(expect.stringContaining('No confirmed queued message'));
});
it('keeps interrupt attachments and draft without stopping or sending anything', async () => {
  const interruptQueued = vi.fn(); const test = harness({ queuedPrompts: { ...tracking(), interruptQueued } });
  test.runRegistry.current.registerRun('notes', 'cron');
  expect(await test.submit('interrupt', [{ id: 'image', filename: 'a.png', mimeType: 'image/png', byteCount: 1, dataBase64: 'YQ==' }])).toBe(false);
  expect(interruptQueued).not.toHaveBeenCalled(); expect(test.client.send).not.toHaveBeenCalled();
});

it('accepts literal interrupt through an asynchronously materialized empty attachment list', async () => {
  const interruptQueued = vi.fn(async () => ({ accepted: true, detail: 'Stop accepted.' }));
  const test = harness({ queuedPrompts: { ...tracking(), interruptQueued } }); test.runRegistry.current.registerRun('notes', 'cron');
  expect(await test.submit('interrupt', Promise.resolve([]))).toBe(true);
  expect(interruptQueued).toHaveBeenCalledOnce(); expect(test.client.send).not.toHaveBeenCalled();
});
it('does not retarget literal interrupt when attachment preparation outlives its predecessor', async () => {
  const pending = pendingCall<never[]>(); const interruptQueued = vi.fn();
  const test = harness({ queuedPrompts: { ...tracking(), interruptQueued } }); test.runRegistry.current.registerRun('notes', 'cron');
  const submitted = test.submit('interrupt', pending.promise); test.runRegistry.current.registerRun('notes', 'successor'); pending.resolve([]);
  expect(await submitted).toBe(false); expect(interruptQueued).not.toHaveBeenCalled(); expect(test.client.send).not.toHaveBeenCalled();
});
