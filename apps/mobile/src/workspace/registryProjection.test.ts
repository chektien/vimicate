import { describe, expect, it } from 'vitest';
import { parseProjectRegistry, reconcileRegistryPayload } from './registryProjection';
import type { WorkspaceProject } from './workspaceTypes';

const root = (key: string, name: string): WorkspaceProject => ({ id: key, sessionKey: key, name, path: '~/wrong', branch: 'main', starred: false, threadCount: 2, state: 'idle', kind: 'project', rootSessionKey: key });
const thread = (key: string, rootKey: string, name: string): WorkspaceProject => ({ id: key, sessionKey: key, name, path: '~/wrong', branch: '—', starred: false, threadCount: 0, state: 'running', kind: 'thread', rootSessionKey: rootKey, parentSessionKey: rootKey });

describe('registry projection', () => {
  const markdown = `# Vimicate Projects
## Registry Semantics
- ignored: yes
## notes
- id: notes
- group: home
- repo: ~/projects/example-notes/
- backend: openclaw
- session: agent:main:direct:vimicate-ios:project:notes
## Work App
- id: work-app
- group: work
- repo: ~/repos/work-app/
- backend: openclaw`;

  it('parses human-curated order, labels, groups and display paths', () => {
    expect(parseProjectRegistry(markdown)).toEqual([
      { id: 'notes', name: 'notes', group: 'home', path: '~/projects/example-notes', backend: 'openclaw', sessionKey: 'agent:main:direct:vimicate-ios:project:notes' },
      { id: 'work-app', name: 'Work App', group: 'work', path: '~/repos/work-app', backend: 'openclaw', sessionKey: '' },
    ]);
  });

  it('reconciles durable project/thread identity with live activity and suppresses removed bindings', () => {
    const notesKey = 'agent:main:direct:vimicate-ios:project:notes';
    const activeKey = 'agent:main:dashboard:active'; const removedKey = 'agent:main:dashboard:removed';
    const payload = { projects: { markdown }, threads: { json: JSON.stringify({ threads: [
      { threadID: 'durable-active', label: 'Example Thread', parentProjectID: 'notes', state: 'active', order: 2, currentBinding: { stableSessionKey: activeKey }, bindings: [{ stableSessionKey: activeKey }] },
      { threadID: 'durable-removed', label: 'Old', parentProjectID: 'notes', state: 'removed', order: 1, currentBinding: { stableSessionKey: removedKey }, bindings: [{ stableSessionKey: removedKey }] },
    ] }) } };
    const result = reconcileRegistryPayload([root(notesKey, 'notes'), thread(activeKey, notesKey, 'live label'), thread(removedKey, notesKey, 'must disappear')], payload);
    expect(result.map((item) => item.name)).toEqual(['notes', 'Example Thread', 'Work App']);
    expect(result[0]).toMatchObject({ path: '~/projects/example-notes', group: 'home', threadCount: 2 });
    expect(result[1]).toMatchObject({ id: 'durable-active', sessionKey: activeKey, state: 'running', projectName: 'notes' });
    expect(result[2]).toMatchObject({ sessionKey: 'agent:main:direct:vimicate-ios:project:work-app', group: 'work' });
  });

  it('recovers live registry-thread metadata even when sessions.list omits its parent link', () => {
    const notesKey = 'agent:main:direct:vimicate-ios:project:notes'; const activeKey = 'agent:main:dashboard:active';
    const payload = { projects: { markdown }, threads: { json: JSON.stringify({ threads: [{ threadID: 'durable-active', label: 'Example Thread', parentProjectID: 'notes', state: 'active', order: 1, currentBinding: { stableSessionKey: activeKey } }] }) } };
    const unparentedLive = { ...thread(activeKey, notesKey, 'live'), kind: undefined, rootSessionKey: undefined, parentSessionKey: undefined, sessionId: '33333333-3333-4333-8333-333333333333', sessionStartedAtMs: 1000 } as unknown as WorkspaceProject;
    const result = reconcileRegistryPayload([root(notesKey, 'notes')], payload, [root(notesKey, 'notes'), unparentedLive]);
    expect(result[1]).toMatchObject({ name: 'Example Thread', state: 'running', sessionId: '33333333-3333-4333-8333-333333333333', sessionStartedAtMs: 1000 });
  });

  it('shows the exact bound session explicit label when a rename reaches the session census before the registry', () => {
    const notesKey = 'agent:main:direct:vimicate-ios:project:notes'; const activeKey = 'agent:main:dashboard:active';
    const payload = { projects: { markdown }, threads: { json: JSON.stringify({ threads: [{ threadID: 'durable-active', label: 'example thread', parentProjectID: 'notes', state: 'active', order: 1, currentBinding: { stableSessionKey: activeKey } }] }) } };
    const renamedLive = { ...thread(activeKey, notesKey, 'example-review'), backendLabel: 'example-review' };
    const result = reconcileRegistryPayload([root(notesKey, 'notes'), renamedLive], payload);
    expect(result.find((item) => item.sessionKey === activeKey)).toMatchObject({
      id: 'durable-active',
      name: 'example-review',
      parentSessionKey: notesKey,
      projectName: 'notes',
    });
  });

  it.each(['Vimicate RN', 'Vimicate'])('keeps the durable thread label when the exact session only has derived client name %s', (displayName) => {
    const notesKey = 'agent:main:direct:vimicate-ios:project:notes'; const emailsKey = 'agent:main:dashboard:emails';
    const payload = { projects: { markdown }, threads: { json: JSON.stringify({ threads: [{ threadID: 'durable-emails', label: 'emails', parentProjectID: 'notes', state: 'active', order: 1, currentBinding: { stableSessionKey: emailsKey } }] }) } };
    const derivedLive = thread(emailsKey, notesKey, displayName);
    const result = reconcileRegistryPayload([root(notesKey, 'notes'), derivedLive], payload);

    expect(result.find((item) => item.sessionKey === emailsKey)).toMatchObject({
      id: 'durable-emails',
      name: 'emails',
      projectName: 'notes',
    });
  });

  it('never tombstones an active durable thread merely because a session page omits it', () => {
    const notesKey = 'agent:main:direct:vimicate-ios:project:notes'; const activeKey = 'agent:main:dashboard:active';
    const payload = { projects: { markdown }, threads: { json: JSON.stringify({ threads: [{ threadID: 'durable-active', label: 'Example Thread', parentProjectID: 'notes', state: 'active', order: 1, currentBinding: { stableSessionKey: activeKey }, bindings: [{ stableSessionKey: activeKey }] }] }) } };
    const result = reconcileRegistryPayload([root(notesKey, 'notes')], payload, [root(notesKey, 'notes')]);
    expect(result.map((item) => item.sessionKey)).toContain(activeKey);
    expect(result.find((item) => item.sessionKey === activeKey)).toMatchObject({ kind: 'thread', state: 'idle' });
  });

  it('keeps valid projects.md as the sole top-level project authority and preserves its cross-group order', () => {
    const notesKey = 'agent:main:direct:vimicate-ios:project:notes';
    const unregistered = root('agent:main:direct:vimicate-ios:project:surprise', 'surprise');
    const result = reconcileRegistryPayload([root(notesKey, 'notes'), unregistered], { projects: { markdown }, threads: { json: '{"threads":[]}' } });
    expect(result.filter((item) => item.kind === 'project').map((item) => [item.name, item.group]))
      .toEqual([['notes', 'home'], ['Work App', 'work']]);
    expect(result.some((item) => item.name === 'surprise')).toBe(false);
  });

  it('deduplicates registry roots by durable id or shared session identity', () => {
    const duplicateMarkdown = `${markdown}
## notes duplicate id
- id: notes
- group: work
- repo: ~/wrong
- backend: openclaw
- session: agent:main:direct:vimicate-ios:project:other
## notes duplicate session
- id: other-notes
- group: work
- repo: ~/wrong-again
- backend: openclaw
- session: agent:main:direct:vimicate-ios:project:notes`;
    const result = reconcileRegistryPayload([], { projects: { markdown: duplicateMarkdown }, threads: { json: '{"threads":[]}' } });
    expect(result.filter((item) => item.kind === 'project').map((item) => item.name)).toEqual(['notes', 'Work App']);
  });

  it('uses the binding explicitly marked current when currentBinding is absent', () => {
    const notesKey = 'agent:main:direct:vimicate-ios:project:notes'; const activeKey = 'agent:main:dashboard:active';
    const payload = { projects: { markdown }, threads: { json: JSON.stringify({ threads: [{ threadID: 'durable-active', label: 'Example Thread', parentProjectID: 'notes', state: 'active', order: 1, bindings: [{ stableSessionKey: 'old-key', state: 'archived' }, { stableSessionKey: activeKey, state: 'current', lastSeenAtSeconds: 123 }] }] }) } };
    const result = reconcileRegistryPayload([root(notesKey, 'notes')], payload);
    expect(result.find((item) => item.id === 'durable-active')).toMatchObject({ sessionKey: activeKey, updatedAt: 123000 });
  });

  it('suppresses new-key same-name backend recurrence after removal but permits a newer explicit recreation', () => {
    const notesKey = 'agent:main:direct:vimicate-ios:project:notes';
    const recurring = thread('agent:main:dashboard:new-key', notesKey, 'compact review');
    const removed = { threadID: 'old', label: 'Compact   Review', parentProjectID: 'notes', state: 'removed', order: 1, removedAtSeconds: 50, currentBinding: { stableSessionKey: 'old-key' }, bindings: [{ stableSessionKey: 'old-key' }] };
    const hidden = reconcileRegistryPayload([root(notesKey, 'notes'), recurring], { projects: { markdown }, threads: { json: JSON.stringify({ threads: [removed] }) } });
    expect(hidden.some((item) => item.name === 'compact review')).toBe(false);

    const explicit = { threadID: 'fresh', label: 'compact review', parentProjectID: 'notes', state: 'active', order: 2, explicitlyCreatedAtSeconds: 51, currentBinding: { stableSessionKey: recurring.sessionKey }, bindings: [{ stableSessionKey: recurring.sessionKey }] };
    const visible = reconcileRegistryPayload([root(notesKey, 'notes'), recurring], { projects: { markdown }, threads: { json: JSON.stringify({ threads: [removed, explicit] }) } });
    expect(visible.find((item) => item.sessionKey === recurring.sessionKey)).toMatchObject({ id: 'fresh', name: 'compact review', kind: 'thread' });
  });

  it.each([true, false])('does not readopt a superseded native binding after same-name recreation (current live: %s)', (includeCurrent) => {
    const notesKey = 'agent:main:direct:vimicate-ios:project:notes';
    const old = thread('old-route', notesKey, 'same name');
    const current = thread('fresh-route', notesKey, 'derived client title');
    const unrelated = thread('unregistered-route', notesKey, 'another thread');
    const registry = { threadID: 'fresh-route', parentProjectID: 'notes', label: 'same name', state: 'active',
      explicitlyCreatedAtSeconds: 20, currentBinding: { stableSessionKey: current.sessionKey, state: 'current' },
      bindings: [{ stableSessionKey: current.sessionKey, state: 'current' }, { stableSessionKey: old.sessionKey, state: 'superseded' }] };
    const payload = { projects: { markdown }, threads: { json: JSON.stringify({ threads: [registry] }) } };
    const live = [root(notesKey, 'notes'), old, ...(includeCurrent ? [current] : []), unrelated];
    const visible = reconcileRegistryPayload(live, payload).filter((row) => row.kind === 'thread');
    expect(visible.map((row) => row.sessionKey)).toEqual(['fresh-route', 'unregistered-route']);
    expect(visible.filter((row) => row.name === 'same name')).toHaveLength(1);
    expect(registry.bindings[1]).toEqual({ stableSessionKey: 'old-route', state: 'superseded' });
  });

  it('honors a removed current binding even when its historical bindings array is empty', () => {
    const notesKey = 'agent:main:direct:vimicate-ios:project:notes'; const staleKey = 'agent:main:dashboard:stale';
    const payload = { projects: { markdown }, threads: { json: JSON.stringify({ threads: [{ threadID: 'stale', label: 'stale', parentProjectID: 'notes', state: 'removed', removedAtSeconds: 10, currentBinding: { stableSessionKey: staleKey }, bindings: [] }] }) } };
    expect(reconcileRegistryPayload([root(notesKey, 'notes'), thread(staleKey, notesKey, 'stale')], payload).some((item) => item.sessionKey === staleKey)).toBe(false);
  });
});
