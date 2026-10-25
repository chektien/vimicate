import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceProject } from '../workspace/workspaceTypes';
import { HistoryPublicationAuthority } from './historyPublicationAuthority';
import { SessionRunRegistry } from './sessionRunRegistry';

vi.mock('react', () => ({ useCallback: (callback: unknown) => callback }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'thread-command' }));
vi.mock('../../modules/vimicate-diagnostics', () => ({ latestFatalDiagnostic: () => null, recentViewportDiagnostics: () => [] }));
import { useGatewaySubmission } from './useGatewaySubmission';

const root: WorkspaceProject = { id: 'notes', sessionKey: 'root', sessionId: 'root-generation', name: 'notes', path: '~/notes', branch: '—', starred: false, threadCount: 2, state: 'idle', kind: 'project', rootSessionKey: 'root' };
const child: WorkspaceProject = { ...root, id: 'child-id', sessionKey: 'child', name: 'draft', kind: 'thread', rootSessionKey: 'root', parentSessionKey: 'root', threadCount: 0 };
const active = (threadID: string, stableSessionKey: string, label: string) => ({ threadID, parentProjectID: 'notes', label, order: 0, state: 'active', currentBinding: { backend: 'openclaw', stableSessionKey, parentSessionKey: 'root', state: 'current' }, bindings: [] });
const registryUpdate = (threads: unknown[]) => {
  const json = JSON.stringify({ threads }, null, 2) + '\n';
  return { schemaVersion: 2, contract: 'host-current-v1', outcome: 'updated', threads: { json, exists: true, byteCount: new TextEncoder().encode(json).length } };
};
const registry = { projects: { markdown: '## notes\n- id: notes\n- repo: ~/notes\n- backend: openclaw\n- session: root' }, ...registryUpdate([active('child-id', 'child', 'draft')]) };

function submission(projects: WorkspaceProject[], selectedKey: string, updateThreads: unknown) {
  const neverReconciles = new Promise<void>(() => undefined);
  const acceptThreadRegistryMutation = vi.fn();
  const loadSessions = vi.fn(() => neverReconciles);
  const client = {
    status: 'connected',
    createSession: vi.fn(async () => ({ sessionKey: 'fresh', label: 'video', runStarted: false })),
    updateThreadRegistry: vi.fn(async () => updateThreads),
  };
  const submit = useGatewaySubmission({
    client: client as never, status: 'connected', commands: [], projects, messages: [], selectedRef: { current: selectedKey },
    registrySnapshot: { current: registry }, runRegistry: { current: new SessionRunRegistry() }, setDetail: vi.fn(),
    updateSessionMessages: vi.fn(), preparePromptSubmission: vi.fn(), publishSelectedRun: vi.fn(), persistRuns: vi.fn(),
    loadHistory: vi.fn(async () => []), loadPendingApprovals: vi.fn(async () => {}), decideApproval: vi.fn(async () => false),
    loadSessions, acceptThreadRegistryMutation, startRunMonitor: vi.fn(), reconnect: vi.fn(async () => {}),
    repair: vi.fn(async () => {}), recordLocalInteraction: vi.fn(), scenePublicationAuthority: { current: new HistoryPublicationAuthority() },
  });
  return { submit, loadSessions, acceptThreadRegistryMutation };
}

describe('thread mutation submission latency', () => {
  it('returns from new-thread after atomic mutation publication without waiting for the session census', async () => {
    const updated = registryUpdate([active('child-id', 'child', 'draft'), active('fresh-id', 'fresh', 'video')]);
    const test = submission([root, child], 'child', updated);
    await expect(test.submit(':new-thread video')).resolves.toBe(true);
    expect(test.acceptThreadRegistryMutation).toHaveBeenCalledExactlyOnceWith(updated, 'fresh');
    expect(test.loadSessions).toHaveBeenCalledExactlyOnceWith(false, 'fresh', false);
  });

  it('returns from close-thread after its tombstone is published without waiting for the session census', async () => {
    const removed = { ...active('child-id', 'child', 'draft'), state: 'removed', removedAtSeconds: 20 };
    const updated = registryUpdate([removed]);
    const test = submission([root, child], 'child', updated);
    await expect(test.submit(':close-thread')).resolves.toBe(true);
    expect(test.acceptThreadRegistryMutation).toHaveBeenCalledExactlyOnceWith(updated, 'root');
    expect(test.loadSessions).toHaveBeenCalledExactlyOnceWith(false, 'root', false);
  });
});
