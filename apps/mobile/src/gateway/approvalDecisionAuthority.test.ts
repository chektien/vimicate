import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import type { OpenClawClient } from './OpenClawClient';
import { HistoryPublicationAuthority } from './historyPublicationAuthority';
import { SessionRunRegistry } from './sessionRunRegistry';

vi.mock('react', () => ({ useCallback: (callback: unknown) => callback }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'test-command' }));
vi.mock('../../modules/vimicate-diagnostics', () => ({ latestFatalDiagnostic: () => null, recentViewportDiagnostics: () => [] }));
import { useGatewayApprovalDecision } from './useGatewayApprovalDecision';
import { useGatewaySubmission } from './useGatewaySubmission';

const approval = (): WorkspaceMessage => ({ id: 'approval-row', role: 'approval', text: 'approve command?',
  sessionKey: 'one', runId: 'old', state: 'streaming',
  approval: { id: 'approval-id', kind: 'exec', allowedDecisions: ['allow-once', 'deny'], resolved: false } });
function setup(initial = approval()) {
  let resolve!: () => void; let reject!: (error: Error) => void;
  const request = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  const registry = new SessionRunRegistry(); registry.registerRun('one', 'old');
  const scene = new HistoryPublicationAuthority(); let rows = [initial];
  const dependencies: Parameters<typeof useGatewayApprovalDecision>[0] = {
    client: { status: 'connected', resolveApproval: vi.fn(() => request) } as unknown as OpenClawClient,
    selectedRef: { current: 'one' }, runRegistry: { current: registry }, scenePublicationAuthority: { current: scene },
    updateSessionMessages: vi.fn((_key, action) => { rows = typeof action === 'function' ? action(rows) : action; }),
    setDetail: vi.fn(), persistRuns: vi.fn(), publishSelectedRun: vi.fn(), loadPendingApprovals: vi.fn(async () => {}),
  };
  const decide = useGatewayApprovalDecision(dependencies);
  const submit = useGatewaySubmission({ ...dependencies, decideApproval: decide, acceptThreadRegistryMutation: vi.fn(), setDetail: vi.fn(), status: 'connected', commands: [], projects: [], messages: rows,
    registrySnapshot: { current: null }, preparePromptSubmission: vi.fn(), loadHistory: vi.fn(async () => []),
    loadSessions: vi.fn(async () => {}), startRunMonitor: vi.fn(), reconnect: vi.fn(async () => {}),
    repair: vi.fn(async () => {}), recordLocalInteraction: vi.fn() });
  return { dependencies, registry, scene, resolve, reject, submit, rows: () => rows, replace: (next: WorkspaceMessage[]) => { rows = next; },
    decide };
}

async function startDecision(test: ReturnType<typeof setup>, surface: string) {
  const work = surface === 'inline' ? test.decide(approval(), 'allow-once') : test.submit(':approve approval-id');
  await Promise.resolve(); await Promise.resolve();
  expect(test.dependencies.client.resolveApproval).toHaveBeenCalledOnce();
  return { work };
}

describe('approval-decision continuation authority', () => {
  it('does not infer the owner of an unscoped approval from the selected thread', async () => {
    const test = setup(); const message = approval(); delete message.sessionKey;
    const work = test.decide(message, 'allow-once'); test.resolve(); await work;
    expect(test.dependencies.client.resolveApproval).not.toHaveBeenCalled();
    expect(test.dependencies.updateSessionMessages).not.toHaveBeenCalled();
  });

  it('does not dispatch a command for another thread from a still-mounted old dataset', async () => {
    const test = setup(); test.dependencies.selectedRef.current = 'two';
    const work = test.submit(':approve approval-id', [], 'two'); test.resolve(); await work;
    expect(test.dependencies.client.resolveApproval).not.toHaveBeenCalled();
  });

  it('checks permitted decisions at the inline owner, not only in the rendered buttons', async () => {
    const test = setup(); const work = test.decide(approval(), 'allow-always'); test.resolve(); await work;
    expect(test.dependencies.client.resolveApproval).not.toHaveBeenCalled();
  });

  it('rejects blank identity, resolved requests, disconnected transport and inactive scenes', async () => {
    const original = approval();
    for (const message of [{ ...original, sessionKey: ' ' },
      { ...original, approval: { ...original.approval!, id: ' ' } },
      { ...original, approval: { ...original.approval!, resolved: true } }]) {
      const test = setup(); expect(await test.decide(message, 'deny')).toBe(false);
      expect(test.dependencies.client.resolveApproval).not.toHaveBeenCalled();
    }
    const disconnected = setup(); Object.assign(disconnected.dependencies.client, { status: 'disconnected' });
    expect(await disconnected.decide(original, 'deny')).toBe(false);
    expect(disconnected.dependencies.client.resolveApproval).not.toHaveBeenCalled();
    const inactive = setup(); inactive.scene.suspend();
    expect(await inactive.decide(original, 'deny')).toBe(false);
    expect(inactive.dependencies.client.resolveApproval).not.toHaveBeenCalled();
  });

  it.each(['inline', 'command'])('%s dispatches a permitted denial exactly once and finalizes only its row', async surface => {
    const test = setup(); const work = surface === 'inline' ? test.decide(approval(), 'deny') : test.submit(':deny approval-id');
    test.resolve(); expect(await work).toBe(true);
    expect(test.dependencies.client.resolveApproval).toHaveBeenCalledExactlyOnceWith('exec', 'approval-id', 'deny');
    expect(test.dependencies.loadPendingApprovals).toHaveBeenCalledExactlyOnceWith('one');
    expect(test.rows()[0]).toMatchObject({ sessionKey: 'one', runId: 'old', state: 'complete',
      approval: { resolved: true, allowedDecisions: [], outcome: 'denied' } });
    expect(test.registry.phaseFor('one')).toBe('accepted');
  });

  it.each(['inline', 'command'])('%s keeps a late decision in its origin after selection changes', async surface => {
    const test = setup(); const { work } = await startDecision(test, surface);
    test.dependencies.selectedRef.current = 'two'; vi.mocked(test.dependencies.setDetail).mockClear();
    vi.mocked(test.dependencies.loadPendingApprovals).mockRejectedValue(new Error('refresh offline'));
    test.resolve(); expect(await work).toBe(true);
    expect(test.dependencies.updateSessionMessages).toHaveBeenCalledWith('one', expect.any(Function));
    expect(test.dependencies.setDetail).not.toHaveBeenCalled();
    expect(test.rows()[0]?.approval?.outcome).toBe('allowed');
  });

  it.each(['inline', 'command'])('%s keeps a newer resolved approval when an earlier resolve succeeds late', async surface => {
    const test = setup(); const original = approval();
    const { work } = await startDecision(test, surface);
    const resolved: WorkspaceMessage = { ...original, text: 'approval denied', state: 'complete',
      approval: { ...original.approval!, resolved: true, allowedDecisions: [], outcome: 'denied' } };
    test.replace([resolved]); test.resolve(); await work;
    expect(test.rows()[0]).toBe(resolved);
  });

  it.each(['inline', 'command'])('%s does not turn a successful decision into expiry when only its refresh fails', async surface => {
    const test = setup(); vi.mocked(test.dependencies.loadPendingApprovals).mockRejectedValue(new Error('unknown approval'));
    const { work } = await startDecision(test, surface);
    test.resolve(); const accepted = await work;
    expect(test.registry.phaseFor('one')).toBe('accepted');
    expect(accepted).toBe(true);
    expect(test.rows()[0]?.approval?.outcome).toBe('allowed');
  });

  it.each(['inline', 'command'])('%s does not resurrect an old run when its approval expires after a newer run completed', async surface => {
    const test = setup(); const { work } = await startDecision(test, surface);
    test.registry.registerRun('one', 'new'); test.registry.finishRun('one', 'new');
    test.reject(new Error('approval expired')); await work;
    expect(test.registry.phaseFor('one')).toBe('completed');
    expect(test.registry.isBusy('one')).toBe(false);
    expect(test.registry.ownsRun('one', 'new')).toBe(true);
    expect(test.rows()[0]?.approval?.outcome).toBe('expired');
  });

  it.each(['inline', 'command'])('%s does not overwrite an approval resolved by a newer event while the decision request was in flight', async surface => {
    const test = setup(); const original = approval(); const { work } = await startDecision(test, surface);
    const resolved: WorkspaceMessage = { ...original, text: 'approval allowed', state: 'complete',
      approval: { ...original.approval!, resolved: true, allowedDecisions: [], outcome: 'allowed' } };
    test.replace([resolved]); test.reject(new Error('unknown approval')); await work;
    expect(test.rows()[0]).toBe(resolved);
  });

  it('still marks the matching active run uncertain on genuine approval expiry', async () => {
    const test = setup(); const work = test.decide(approval(), 'allow-once');
    test.reject(new Error('approval expired')); await work;
    expect(test.registry.phaseFor('one')).toBe('uncertain');
    expect(test.registry.runFor('one')).toBe('old');
    expect(test.rows()[0]?.approval?.outcome).toBe('expired');
  });

  it('does not change a newer active run', async () => {
    const test = setup(); const work = test.decide(approval(), 'allow-once');
    test.registry.registerRun('one', 'new'); test.reject(new Error('approval expired')); await work;
    expect(test.registry.phaseFor('one')).toBe('accepted');
    expect(test.registry.runFor('one')).toBe('new');
  });

  it('retires both successful and failed continuations when the scene changes', async () => {
    for (const success of [false, true]) {
      const test = setup(); const work = test.decide(approval(), 'allow-once');
      test.scene.suspend(); test.scene.resume();
      if (success) test.resolve(); else test.reject(new Error('approval expired'));
      await work;
      expect(test.dependencies.updateSessionMessages).not.toHaveBeenCalled();
      expect(test.dependencies.persistRuns).not.toHaveBeenCalled();
      expect(test.dependencies.loadPendingApprovals).not.toHaveBeenCalled();
    }
  });
});
