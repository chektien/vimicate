import { describe, expect, it } from 'vitest';
import type { WorkspaceProject } from '../workspace/workspaceTypes';
import { parsedPersistedWorkspaceSelection, serializedPersistedWorkspaceSelection } from './persistedWorkspaceSelection';
import { sessionSelectionAfterRefresh } from './sessionRefreshSelection';

const project = (sessionKey: string, id = sessionKey): WorkspaceProject => ({
  id,
  sessionKey,
  name: sessionKey,
  path: `/tmp/${sessionKey}`,
  branch: 'main',
  starred: false,
  threadCount: 1,
  state: 'idle',
  kind: 'project',
});

describe('persisted workspace selection', () => {
  it('reads the legacy stable-session value without inventing a durable identity', () => {
    expect(parsedPersistedWorkspaceSelection('agent:main:thread')).toEqual({
      sessionKey: 'agent:main:thread',
      projectID: '',
    });
  });

  it('round-trips the stable route together with its durable registry identity', () => {
    const serialized = serializedPersistedWorkspaceSelection('old-binding', 'durable-thread');
    expect(parsedPersistedWorkspaceSelection(serialized)).toEqual({
      sessionKey: 'old-binding',
      projectID: 'durable-thread',
    });
  });

  it('restores a cold foreground to the same durable child after its binding changes', () => {
    const restored = parsedPersistedWorkspaceSelection(
      serializedPersistedWorkspaceSelection('old-binding', 'durable-thread'),
    );
    const refreshed = [
      project('root'),
      { ...project('new-binding', 'durable-thread'), kind: 'thread' as const, rootSessionKey: 'root' },
    ];

    expect(sessionSelectionAfterRefresh(
      refreshed,
      restored.sessionKey,
      '',
      restored.projectID,
    )).toBe('new-binding');
  });
});
