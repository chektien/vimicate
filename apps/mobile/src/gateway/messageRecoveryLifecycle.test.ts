import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type WorkspaceMessage } from '../workspace/workspaceTypes';
import { messagesFromPayload } from '../workspace/historyMessageProjection';
import type { OpenClawClient } from './OpenClawClient';
import { HistoryPublicationAuthority } from './historyPublicationAuthority';
import { externalHistoryPublication } from './historyReviewPublication';
// @ts-expect-error Vitest's Node runtime provides this test-only module.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const nativeRequire = createRequire(require.resolve('react-native/package.json'));
const NativeAbortController = nativeRequire('abort-controller').AbortController as typeof AbortController;

// Explicit render/effect scheduling for the real hook; no native renderer.
const hooks = vi.hoisted(() => {
  const slots: { value: unknown; deps?: readonly unknown[]; cleanup?: (() => void) | undefined }[] = [];
  let index = 0; let effects: (() => void)[] = [];
  const slot = (value: unknown) => slots[index++] ?? (slots[index - 1] = { value });
  return {
    react: {
      useRef: (value: unknown) => slot({ current: value }).value,
      useCallback: (callback: unknown) => { slot(undefined); return callback; },
      useEffect: (run: () => void | (() => void), deps: readonly unknown[]) => {
        const current = slot(undefined);
        if (current.deps && deps.length === current.deps.length && deps.every((dep, i) => Object.is(dep, current.deps![i]))) return;
        current.deps = deps;
        effects.push(() => { current.cleanup?.(); current.cleanup = run() || undefined; });
      },
    },
    render<T>(run: () => T) { index = 0; const result = run(); const pending = effects; effects = []; pending.forEach(effect => effect()); return result; },
    reset() { slots.length = 0; index = 0; effects = []; },
    unmount() { slots.forEach(slot => slot.cleanup?.()); },
  };
});
vi.mock('react', () => hooks.react);
import { useGatewayMessageRecovery } from './useGatewayMessageRecovery';

const clipped = (): WorkspaceMessage => ({ id: 'row', role: 'assistant', text: 'partial...(truncated)...', sessionKey: 'one', source: 'history', recovery: { sourceMessageId: 'source', state: 'available' } });
function deferred() {
  let resolve!: (value: Record<string, unknown>) => void; let reject!: (error: Error) => void;
  const promise = new Promise<Record<string, unknown>>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function setup(rows = [clipped()]) {
  const scene = new HistoryPublicationAuthority(); const request = deferred();
  const messages = { current: rows }; const selected = { current: 'one' };
  const updates: string[] = [];
  const dependencies: Parameters<typeof useGatewayMessageRecovery>[0] = {
    client: { getMessage: vi.fn(() => request.promise), decorateMessages: (rows: WorkspaceMessage[]) => rows } as unknown as OpenClawClient,
    selectedRef: selected, messagesRef: messages, messageSessionKey: 'one', projectsRef: { current: [] },
    updateSessionMessages: vi.fn((key, action) => {
      // Same scene gate as the real history owner; background writes are inert.
      if (!scene.isActive) return;
      updates.push(key); messages.current = typeof action === 'function' ? action(messages.current) : action;
    }),
    scenePublicationAuthority: { current: scene }, setDetail: vi.fn(),
  };
  const render = () => hooks.render(() => useGatewayMessageRecovery(dependencies));
  return { scene, request, messages, selected, updates, dependencies, render };
}

describe('full-message recovery lifetime', () => {
  beforeEach(() => { hooks.reset(); vi.stubGlobal('AbortController', NativeAbortController); });
  afterEach(() => { hooks.unmount(); vi.unstubAllGlobals(); });

  it('recovers one oversized canonical-history omission through its preserved session and message identities', async () => {
    const [omitted] = messagesFromPayload({
      sessionKey: 'one',
      messages: [{
        role: 'assistant',
        content: '[chat.history omitted: message too large]',
        __openclaw: { id: 'source', runId: 'run-one', truncated: true, reason: 'oversized' },
      }],
    });
    const context = setup([omitted!]);
    const work = context.render()('source'); await Promise.resolve();
    expect(context.dependencies.client.getMessage).toHaveBeenCalledWith('one', 'source', 524_288);
    context.request.resolve({ ok: true, message: { text: 'Done.' } }); await work;
    expect(context.messages.current[0]).toMatchObject({
      id: 'source', sessionKey: 'one', runId: 'run-one', text: 'Done.', recovery: { state: 'recovered' },
    });
  });

  it.each([
    ['not_found', 'message was not found'],
    ['not_visible', 'message is not visible'],
    ['oversized', 'message is too large'],
  ])('treats %s as terminal without inviting another retry', async (reason, detail) => {
    const context = setup(); const work = context.render()('row'); await Promise.resolve();
    context.request.resolve({ ok: false, unavailableReason: reason }); await work;
    expect(context.messages.current[0]?.recovery).toMatchObject({ state: 'unavailable', detail: expect.stringContaining(detail) });
    expect(context.messages.current[0]?.recovery?.detail).not.toContain('retry');
    await context.render()('row');
    expect(context.dependencies.client.getMessage).toHaveBeenCalledTimes(1);
  });

  it('projects a recovered Claude tool call and result as a tool row', async () => {
    const omitted = messagesFromPayload({ sessionKey: 'one', messages: [{ role: 'assistant', content: '[chat.history omitted: message too large]', __openclaw: { id: 'source', truncated: true, reason: 'oversized' } }] })[0]!;
    expect(omitted).toMatchObject({ role: 'assistant', text: '[chat.history omitted: message too large]', recovery: { state: 'available', sourceMessageId: 'source' } });
    const context = setup([omitted]); const work = context.render()('source'); await Promise.resolve();
    const native = { role: 'assistant', content: [
      { type: 'toolcall', id: 'call-1', name: 'Read', arguments: { file_path: '/project/screenshot.png' } },
      { type: 'tool_result', tool_use_id: 'call-1', name: 'Read', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' } }] },
    ], __openclaw: { id: 'source' } };
    const historyRows = messagesFromPayload({ sessionKey: 'one', messages: [native] });
    context.request.resolve({ ok: true, message: native }); await work;
    expect(context.messages.current[0]).toMatchObject({ id: 'source', role: 'tool', tool: { name: 'Read' }, recovery: { state: 'recovered' } });
    expect(context.messages.current.map(row => ({ role: row.role, text: row.text, tool: row.tool })))
      .toEqual(historyRows.map(row => ({ role: row.role, text: row.text, tool: row.tool })));
    expect(context.messages.current[0]?.text).toContain('screenshot.png');
    expect(context.messages.current[0]?.attachments?.[0]?.mimeType).toBe('image/png');
  });

  it('makes an interrupted loading row retryable on resume without publishing while inactive', async () => {
    const context = setup(); const first = context.render()('row'); await Promise.resolve();
    expect(context.messages.current[0]?.recovery?.state).toBe('loading');
    context.scene.suspend(); const updates = context.updates.length;
    context.request.reject(new Error('disconnected')); await first; context.render();
    expect(context.updates).toHaveLength(updates);
    context.scene.resume(); context.render();
    expect(context.messages.current[0]?.recovery?.state).toBe('available');
  });

  it('readmits before the retired request returns and ignores its later failure', async () => {
    const context = setup(); const first = context.render()('row'); await Promise.resolve();
    context.scene.suspend(); context.scene.resume();
    const resumed = deferred(); vi.mocked(context.dependencies.client.getMessage).mockReturnValue(resumed.promise);
    const retry = context.render(); const second = retry('row'); await Promise.resolve();
    context.request.reject(new Error('retired failure')); await first;
    const stateBeforeCurrentResult = context.messages.current[0]?.recovery?.state;
    resumed.resolve({ message: { text: 'partial and now complete' } }); await second;
    expect(context.dependencies.client.getMessage).toHaveBeenCalledTimes(2);
    expect(stateBeforeCurrentResult).toBe('loading');
    expect(context.dependencies.setDetail).not.toHaveBeenCalledWith('retired failure');
    expect(context.messages.current[0]).toMatchObject({ text: 'partial and now complete', recovery: { state: 'recovered' } });
  });

  it('repairs orphaned loading from a prior lifetime without making an automatic request', () => {
    const row = clipped(); row.recovery!.state = 'loading';
    const context = setup([row]); context.render();
    expect(context.messages.current[0]?.recovery?.state).toBe('available');
    expect(context.dependencies.client.getMessage).not.toHaveBeenCalled();
  });

  it('repairs and recovers the visible older row rather than only its hidden live tail', async () => {
    const row = clipped(); row.recovery!.state = 'loading';
    const context = setup([row]); let latest: WorkspaceMessage[] = [];
    context.dependencies.updateSessionMessages = vi.fn((_key, action, intent) => {
      const publication = externalHistoryPublication('older', context.messages.current, latest, action, intent);
      context.messages.current = publication.visible; latest = publication.latest;
    });
    const recover = context.render();
    expect(context.messages.current[0]?.recovery?.state).toBe('available');
    const work = recover('row'); await Promise.resolve();
    expect(context.messages.current[0]?.recovery?.state).toBe('loading');
    context.request.resolve({ message: { text: 'partial and now complete' } }); await work;
    expect(context.messages.current[0]?.recovery?.state).toBe('recovered');
    expect(latest).toEqual([]);
  });

  it('does not use a newly selected thread to recover a still-mounted previous transcript', async () => {
    const context = setup(); context.selected.current = 'two';
    const work = context.render()('row'); context.request.resolve({ message: { text: 'foreign answer' } }); await work;
    expect(context.dependencies.client.getMessage).not.toHaveBeenCalled();
    expect(context.updates).toEqual([]);
  });

  it('deduplicates rapid requests and preserves a genuinely active loading row on render', async () => {
    const context = setup(); const recover = context.render();
    const first = recover('row'); const duplicate = recover('row'); await Promise.resolve();
    context.render();
    expect(context.dependencies.client.getMessage).toHaveBeenCalledOnce();
    expect(context.messages.current[0]?.recovery?.state).toBe('loading');
    context.request.resolve({ message: { text: 'partial and now complete' } }); await Promise.all([first, duplicate]);
    const updates = context.updates.length; context.render();
    expect(context.updates).toHaveLength(updates);
    expect(context.messages.current[0]?.recovery?.state).toBe('recovered');
  });

  it('does not spend the failure budget on scene-cancelled attempts', async () => {
    const context = setup();
    for (let index = 0; index < 5; index += 1) {
      const request = deferred(); vi.mocked(context.dependencies.client.getMessage).mockReturnValue(request.promise);
      const work = context.render()('row'); await Promise.resolve();
      context.scene.suspend(); request.reject(new Error('disconnected')); await work;
      context.scene.resume(); context.render();
    }
    vi.mocked(context.dependencies.client.getMessage).mockResolvedValue({ message: { text: 'partial and now complete' } });
    await context.render()('row');
    expect(context.dependencies.client.getMessage).toHaveBeenCalledTimes(6);
    expect(context.messages.current[0]?.recovery?.state).toBe('recovered');
  });

  it('still caps genuine failed attempts and never treats an incomplete payload as recovered', async () => {
    const context = setup();
    vi.mocked(context.dependencies.client.getMessage).mockResolvedValue({ message: { text: 'short' } });
    for (let index = 0; index < 5; index += 1) await context.render()('row');
    expect(context.dependencies.client.getMessage).toHaveBeenCalledTimes(4);
    expect(context.messages.current[0]).toMatchObject({ text: clipped().text, recovery: { state: 'unavailable' } });
  });

  it('disposes the listener and rejects late publication after controller unmount', async () => {
    const context = setup(); const remove = vi.spyOn(context.scene.signal, 'removeEventListener');
    const work = context.render()('row'); await Promise.resolve(); const updates = context.updates.length;
    hooks.unmount(); context.request.resolve({ message: { text: 'partial and now complete' } }); await work;
    expect(context.updates).toHaveLength(updates);
    expect(context.dependencies.setDetail).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledOnce();
  });

  it('keeps a completed request scoped to its original dataset after a selection change', async () => {
    const context = setup(); const work = context.render()('row'); await Promise.resolve();
    context.selected.current = 'two'; context.render();
    context.request.resolve({ message: { text: 'partial and now complete' } }); await work;
    expect(context.updates.every(key => key === 'one')).toBe(true);
    expect(context.dependencies.setDetail).not.toHaveBeenCalled();
  });

  it('does not overwrite a newer canonical recovered representation', async () => {
    const context = setup(); const work = context.render()('row'); await Promise.resolve();
    context.messages.current = [{ ...clipped(), text: 'newer canonical full answer', recovery: { sourceMessageId: 'source', state: 'recovered' } }];
    context.request.resolve({ message: { text: 'partial and now complete' } }); await work;
    expect(context.messages.current[0]).toMatchObject({ text: 'newer canonical full answer', recovery: { state: 'recovered' } });
  });

  it('bounds concurrent source requests and releases capacity after settlement', async () => {
    const context = setup(Array.from({ length: 65 }, (_, index) => ({ ...clipped(), id: `row-${index}`, recovery: { sourceMessageId: `source-${index}`, state: 'available' as const } })));
    const recover = context.render(); const tasks = context.messages.current.map(row => recover(row.id));
    await Promise.resolve(); expect(context.dependencies.client.getMessage).toHaveBeenCalledTimes(64);
    context.request.resolve({ message: { text: 'partial and now complete' } }); await Promise.all(tasks);
    await context.render()('row-64');
    expect(context.dependencies.client.getMessage).toHaveBeenCalledTimes(65);
    expect(context.messages.current.every(row => row.recovery?.state === 'recovered')).toBe(true);
  });
});
