import { describe, expect, it } from 'vitest';
import type { WorkspaceProject } from '../workspace/workspaceTypes';
import { activeThreadEntry, assertThreadRegistryUpdate, createdGatewaySession, removedThreadEntries, rootProjectForSelection, threadBootstrapMessage } from './threadRegistryMutation';

const root: WorkspaceProject = { id: 'notes', sessionKey: 'agent:main:direct:vimicate-ios:project:notes', name: 'notes', path: '~/projects/example-notes', branch: '—', starred: false, threadCount: 2, state: 'idle', kind: 'project', rootSessionKey: 'agent:main:direct:vimicate-ios:project:notes' };
const child: WorkspaceProject = { id: 'example-thread', sessionKey: 'agent:main:dashboard:example-thread', name: 'example thread', path: root.path, branch: '—', starred: false, threadCount: 0, state: 'idle', kind: 'thread', rootSessionKey: root.sessionKey, parentSessionKey: root.sessionKey };
const registry = { threads: { json: JSON.stringify({ threads: [{ threadID: child.sessionKey, parentProjectID: 'notes', label: child.name, order: 7, state: 'active', currentBinding: { backend: 'openclaw', stableSessionKey: child.sessionKey, parentSessionKey: root.sessionKey, state: 'current' }, bindings: [] }] }) } };

describe('typed thread lifecycle wire policy', () => {
  it('parses nested or top-level session creation responses and rejects missing keys', () => {
    expect(createdGatewaySession({ entry: { key: 'child' }, runId: 'run-1' })).toEqual({ sessionKey: 'child', runId: 'run-1', runStarted: true });
    expect(() => createdGatewaySession({ id: 'concrete-only' })).toThrow(/session key/);
  });

  it('derives the parent from either a root or selected child and builds independent bootstrap context', () => {
    expect(rootProjectForSelection([root, child], child.sessionKey)).toEqual(root);
    expect(threadBootstrapMessage('review', root)).toContain('Use ~/projects/example-notes as the working project');
    expect(threadBootstrapMessage('review', root)).toContain('AGENTS.md');
  });

  it('creates a current binding after the existing maximum registry order', () => {
    const entry = activeThreadEntry({ sessionKey: 'new-child', sessionId: 'sid', runStarted: false }, root, 'review', registry, 123);
    expect(entry).toMatchObject({ threadID: 'new-child', parentProjectID: 'notes', label: 'review', order: 8, state: 'active', currentBinding: { stableSessionKey: 'new-child', sessionID: 'sid', parentSessionKey: root.sessionKey } });
  });

  it('marks the selected thread and descendants removed without touching its root', () => {
    const grandchild: WorkspaceProject = { ...child, id: 'deep', sessionKey: 'deep', parentSessionKey: child.sessionKey };
    const removed = removedThreadEntries(registry, [root, child, grandchild], child.sessionKey, 456);
    expect(removed.map((entry) => entry.threadID)).toEqual([child.sessionKey, 'deep']);
    expect(removed.every((entry) => entry.state === 'removed' && entry.removedAtSeconds === 456)).toBe(true);
    expect(removedThreadEntries(registry, [root, child], root.sessionKey, 456)).toEqual([]);
  });

  it.each([
    { bindings: [] },
    { bindings: [{ backend: 'openclaw', stableSessionKey: 'retired-key', state: 'superseded' }] },
  ])(
    'retains the durable removal identity when only currentBinding names the selected session: $bindings', ({ bindings }) => {
      const existing = {
        threadID: 'durable-child', parentProjectID: 'notes', label: child.name,
        order: 7, state: 'active', firstSeenAtSeconds: 10,
        currentBinding: { backend: 'openclaw', stableSessionKey: child.sessionKey, parentSessionKey: root.sessionKey, state: 'current' },
        bindings,
      };
      const payload = { threads: { json: JSON.stringify({ threads: [existing] }) } };
      const result = removedThreadEntries(payload, [root, { ...child, id: existing.threadID }], child.sessionKey, 456);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        threadID: existing.threadID, parentProjectID: 'notes', label: child.name,
        order: 7, firstSeenAtSeconds: 10, state: 'removed', removedAtSeconds: 456,
        currentBinding: existing.currentBinding,
      });
      expect(result[0]?.bindings).toEqual(bindings.length ? bindings : [existing.currentBinding]);
    },
  );

  it('accepts only the complete host-current atomic response contract', () => {
    const json = '{"threads":[]}';
    expect(assertThreadRegistryUpdate({ schemaVersion: 2, contract: 'host-current-v1', outcome: 'updated', threads: { json, exists: true, byteCount: new TextEncoder().encode(json).length } })).toBeTruthy();
    expect(() => assertThreadRegistryUpdate({ outcome: 'updated' })).toThrow(/atomic/);
  });

  it('validates the exact newline-terminated UTF-8 bytes emitted by the host', () => {
    const json = JSON.stringify({ threads: [{ label: 'review — 图片' }] }, null, 2) + '\n';
    const payload = { schemaVersion: 2, contract: 'host-current-v1', outcome: 'updated',
      threads: { json, exists: true, byteCount: new TextEncoder().encode(json).length } };
    expect(assertThreadRegistryUpdate(payload)).toBe(payload);
    expect(() => assertThreadRegistryUpdate({ ...payload,
      threads: { ...payload.threads, byteCount: payload.threads.byteCount - 1 },
    })).toThrow(/atomic/);
    expect(() => assertThreadRegistryUpdate({ ...payload,
      threads: { ...payload.threads, json: json.trim() },
    })).toThrow(/atomic/);
  });
});
