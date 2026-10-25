import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceProject } from '../workspace/workspaceTypes';
import { closeWorkspaceThread, createWorkspaceThread, type ThreadMutationClient } from './workspaceThreadActions';

const root: WorkspaceProject = { id: 'notes', sessionKey: 'root', sessionId: 'root-generation', name: 'notes', path: '~/notes', branch: '—', starred: false, threadCount: 2, state: 'idle', kind: 'project', rootSessionKey: 'root' };
const child: WorkspaceProject = { ...root, id: 'child', sessionKey: 'child', name: 'draft', kind: 'thread', rootSessionKey: 'root', parentSessionKey: 'root', threadCount: 0 };
const registry = { threads: { json: JSON.stringify({ threads: [{ threadID: 'child', parentProjectID: 'notes', label: 'draft', order: 2, state: 'active', currentBinding: { backend: 'openclaw', stableSessionKey: 'child', parentSessionKey: 'root', state: 'current' }, bindings: [] }] }) } };
const registryUpdate = (threads: unknown[]) => {
  const json = JSON.stringify({ threads });
  return { schemaVersion: 2, contract: 'host-current-v1', outcome: 'updated', threads: { json, exists: true, byteCount: new TextEncoder().encode(json).length } };
};

describe('workspace thread actions', () => {
  it('explains an uninitialized project without attempting to create an orphan child', async () => {
    const client: ThreadMutationClient = { createSession: vi.fn(), updateThreadRegistry: vi.fn() };
    const fresh = { ...root }; delete fresh.sessionId;
    await expect(createWorkspaceThread(client, [fresh], 'root', 'review', registry)).rejects.toThrow('Send a first prompt');
    expect(client.createSession).not.toHaveBeenCalled();
    expect(client.updateThreadRegistry).not.toHaveBeenCalled();
  });
  it('creates under the selected child’s root and persists before selection', async () => {
    const client: ThreadMutationClient = {
      createSession: vi.fn(async () => ({ sessionKey: 'fresh', runStarted: false })),
      updateThreadRegistry: vi.fn(async (_mode, entries) => registryUpdate(entries)),
    };
    const result = await createWorkspaceThread(client, [root, child], child.sessionKey, ' review ', registry, 10);
    expect(client.createSession).toHaveBeenCalledWith('root', 'review', expect.stringContaining('AGENTS.md'));
    expect(client.updateThreadRegistry).toHaveBeenCalledWith('upsert', [expect.objectContaining({ threadID: 'fresh', state: 'active' })]);
    expect(result.selectedKey).toBe('fresh');
    expect(result.registryPayload).toMatchObject({ outcome: 'updated', threads: { exists: true } });
  });

  it('fails closed on duplicate labels and pre-existing returned keys', async () => {
    const duplicate: ThreadMutationClient = { createSession: vi.fn(), updateThreadRegistry: vi.fn() };
    await expect(createWorkspaceThread(duplicate, [root, child], 'root', 'DRAFT', registry)).rejects.toThrow(/already exists/);
    const reused: ThreadMutationClient = { createSession: vi.fn(async () => ({ sessionKey: 'child', runStarted: false })), updateThreadRegistry: vi.fn() };
    await expect(createWorkspaceThread(reused, [root, child], 'root', 'other', registry)).rejects.toThrow(/already existed/);
  });

  it('recreates a removed project-local name without competing for its retained native label', async () => {
    const retired = registryUpdate([{ threadID: 'retired', parentProjectID: 'notes', label: 'DRAFT', state: 'removed', order: 1,
      removedAtSeconds: 9, currentBinding: { backend: 'openclaw', stableSessionKey: 'old-route', state: 'current' }, bindings: [] }]);
    const before = JSON.stringify(retired);
    const client: ThreadMutationClient = {
      createSession: vi.fn(async (_parent, nativeLabel) => {
        if (nativeLabel !== undefined) throw new Error('label already in use: draft');
        return { sessionKey: 'fresh-route', sessionId: 'fresh-id', label: 'native generated title', runStarted: false };
      }),
      updateThreadRegistry: vi.fn(async (_mode, entries) => registryUpdate(entries)),
    };
    const result = await createWorkspaceThread(client, [root], 'root', 'draft', retired, 10);
    expect(client.createSession).toHaveBeenCalledExactlyOnceWith('root', undefined, expect.stringContaining('draft'));
    expect(client.updateThreadRegistry).toHaveBeenCalledExactlyOnceWith('upsert', [expect.objectContaining({
      threadID: 'fresh-route', label: 'draft', state: 'active', explicitlyCreatedAtSeconds: 10,
    })]);
    expect(result.selectedKey).toBe('fresh-route');
    expect(result.message).toContain(':new-thread draft');
    expect(JSON.stringify(retired)).toBe(before);
  });

  it('does not reuse a retired binding or apply recreation rules from another project', async () => {
    const entry = { threadID: 'retired', parentProjectID: 'notes', label: 'draft', state: 'removed', order: 1,
      currentBinding: { backend: 'openclaw', stableSessionKey: 'old-route', state: 'current' }, bindings: [] };
    const client: ThreadMutationClient = {
      createSession: vi.fn(async () => ({ sessionKey: 'old-route', runStarted: false })),
      updateThreadRegistry: vi.fn(async (_mode, entries) => registryUpdate(entries)),
    };
    await expect(createWorkspaceThread(client, [root], 'root', 'draft', registryUpdate([entry]), 10)).rejects.toThrow(/retired/);
    expect(client.updateThreadRegistry).not.toHaveBeenCalled();
    client.createSession = vi.fn(async () => ({ sessionKey: 'fresh-route', runStarted: false }));
    await createWorkspaceThread(client, [root], 'root', 'draft', registryUpdate([{ ...entry, parentProjectID: 'another-project' }]), 10);
    expect(client.createSession).toHaveBeenCalledExactlyOnceWith('root', 'draft', expect.any(String));
  });

  it('blocks root/active-run closure and removes a child through the host registry', async () => {
    const removed = { threadID: 'child', parentProjectID: 'notes', label: 'draft', order: 2, state: 'removed', removedAtSeconds: 20, currentBinding: { backend: 'openclaw', stableSessionKey: 'child', parentSessionKey: 'root', state: 'current' }, bindings: [] };
    const client: ThreadMutationClient = { createSession: vi.fn(), updateThreadRegistry: vi.fn(async () => registryUpdate([removed])) };
    await expect(closeWorkspaceThread(client, [root, child], 'root', registry, false)).rejects.toThrow(/selected child/);
    await expect(closeWorkspaceThread(client, [root, child], 'child', registry, true)).rejects.toThrow(/active run/);
    const result = await closeWorkspaceThread(client, [root, child], 'child', registry, false, '', 20);
    expect(client.updateThreadRegistry).toHaveBeenCalledWith('remove', [expect.objectContaining({ threadID: 'child', state: 'removed', removedAtSeconds: 20 })]);
    expect(result.selectedKey).toBe('root');
    expect(result.registryPayload).toMatchObject({ outcome: 'updated', threads: { exists: true } });
  });

  it('fails visibly when a legacy host shape acknowledges removal without retaining its tombstone', async () => {
    const client: ThreadMutationClient = { createSession: vi.fn(), updateThreadRegistry: vi.fn(async () => registryUpdate([])) };
    await expect(closeWorkspaceThread(client, [root, child], 'child', registry, false, '', 20)).rejects.toThrow(/did not retain every removal tombstone/);
  });

  it('sends the existing durable thread record for a current-only binding without removing its sibling', async () => {
    const currentBinding = { backend: 'openclaw' as const, stableSessionKey: 'child', parentSessionKey: 'root', state: 'current' as const };
    const entry = { threadID: 'durable-child', parentProjectID: 'notes', label: 'draft', order: 2, state: 'active', currentBinding, bindings: [] };
    const sibling = { ...child, id: 'sibling', sessionKey: 'sibling', name: 'keep' };
    const payload = registryUpdate([entry]);
    const client: ThreadMutationClient = {
      createSession: vi.fn(),
      updateThreadRegistry: vi.fn(async (_mode, entries) => registryUpdate(entries)),
    };
    const result = await closeWorkspaceThread(client, [root, { ...child, id: entry.threadID }, sibling], 'child', payload, false, '', 20);
    expect(client.updateThreadRegistry).toHaveBeenCalledExactlyOnceWith('remove', [{
      ...entry, state: 'removed', removedAtSeconds: 20, bindings: [currentBinding],
    }]);
    expect(result.selectedKey).toBe('root');
  });
});
