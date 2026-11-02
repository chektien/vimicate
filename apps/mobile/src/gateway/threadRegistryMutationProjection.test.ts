import { describe, expect, it, vi } from 'vitest';
vi.mock('react', () => ({ useCallback: (callback: unknown) => callback }));
vi.mock('../storage/workspaceStore', () => ({ saveValue: async () => {} }));
import { useGatewayThreadRegistryMutation } from './useGatewayThreadRegistryMutation';
import { WorkspaceActivityLedger } from '../workspace/workspaceActivityLedger';
import { WorkspaceAttentionLedger } from '../workspace/workspaceAttention';
import { SessionRunRegistry } from './sessionRunRegistry';
import type { WorkspaceProject } from '../workspace/workspaceTypes';
import { immediateThreadRegistryMutationProjection } from './threadRegistryMutationProjection';

const projectsMarkdown = [
  '## notes',
  '- id: notes',
  '- group: home',
  '- repo: ~/notes',
  '- backend: openclaw',
  '- session: root',
].join('\n');

const root: WorkspaceProject = { id: 'notes', sessionKey: 'root', name: 'notes', path: '~/notes', branch: '—', starred: false, threadCount: 2, state: 'idle', kind: 'project', rootSessionKey: 'root' };
const child: WorkspaceProject = { ...root, id: 'child-id', sessionKey: 'child', name: 'draft', kind: 'thread', rootSessionKey: 'root', parentSessionKey: 'root', threadCount: 0 };
const active = (threadID: string, stableSessionKey: string, label: string, order: number) => ({ threadID, parentProjectID: 'notes', label, order, state: 'active', currentBinding: { backend: 'openclaw', stableSessionKey, parentSessionKey: 'root', state: 'current' }, bindings: [] });
const registry = (threads: unknown[]) => {
  const json = JSON.stringify({ threads });
  return { schemaVersion: 2, contract: 'host-current-v1', outcome: 'updated', threads: { json, exists: true, byteCount: new TextEncoder().encode(json).length } };
};
const acceptedRegistry = { projects: { markdown: projectsMarkdown }, ...registry([active('child-id', 'child', 'draft', 0)]) };

describe('immediate thread-registry mutation projection', () => {
  it('materializes and selects a newly-created registry thread without waiting for another session census', () => {
    const result = immediateThreadRegistryMutationProjection(
      [root, child], acceptedRegistry,
      registry([active('child-id', 'child', 'draft', 0), active('fresh-id', 'fresh', 'video', 1)]),
      'child', 'fresh',
    );
    expect(result.projects.map((project) => project.sessionKey)).toEqual(['root', 'child', 'fresh']);
    expect(result.projects.at(-1)).toMatchObject({ name: 'video', kind: 'thread', rootSessionKey: 'root' });
    expect(result.selectedKey).toBe('fresh');
  });

  it('removes a closed thread and selects its root from the accepted tombstone response', () => {
    const removed = { ...active('child-id', 'child', 'draft', 0), state: 'removed', removedAtSeconds: 20 };
    const result = immediateThreadRegistryMutationProjection([root, child], acceptedRegistry, registry([removed]), 'child', 'root');
    expect(result.projects.map((project) => project.sessionKey)).toEqual(['root']);
    expect(result.selectedKey).toBe('root');
  });
});


it('keeps inherited legacy activity untrusted through an actual registry mutation and persistence', () => {
  const ledger = new WorkspaceActivityLedger(); ledger.restore(JSON.stringify([['child', 900]]));
  const projectsRef = { current: ledger.reconcile([root, child]) };
  const accept = useGatewayThreadRegistryMutation({
    projectsRef, registrySnapshot: { current: acceptedRegistry }, selectedRef: { current: 'child' }, selectedProjectIDRef: { current: 'child-id' },
    activityLedger: { current: ledger }, attentionLedger: { current: new WorkspaceAttentionLedger() }, starOverrides: { current: {} }, runRegistry: { current: new SessionRunRegistry() },
    setProjects: vi.fn(), setProjectsReady: vi.fn(), setSelectedKey: vi.fn(), resetHistory: vi.fn(), publishSelectedRun: vi.fn(),
  });
  accept(registry([active('child-id', 'child', 'draft', 0)]), 'child');
  expect(projectsRef.current.find(row => row.sessionKey === 'child')?.updatedAt).toBe(900);
  const restored = new WorkspaceActivityLedger(); restored.restore(ledger.serialized());
  expect(restored.record('child', 700)).toBe(700);
});
