import { describe, expect, it } from 'vitest';
import type { WorkspaceProject } from '../workspace/workspaceTypes';
import { sessionSelectionAfterRefresh } from './sessionRefreshSelection';

const project = (sessionKey: string): WorkspaceProject => ({
  id: sessionKey,
  sessionKey,
  name: sessionKey,
  path: `/tmp/${sessionKey}`,
  branch: 'main',
  starred: false,
  threadCount: 1,
  state: 'idle',
  group: 'home',
  kind: 'project',
});

describe('session selection after an asynchronous project refresh', () => {
  const projects = [project('thread-a'), project('thread-b'), project('new-thread')];

  it('keeps the live selection when an ordinary refresh began in another thread', () => {
    expect(sessionSelectionAfterRefresh(projects, 'thread-b')).toBe('thread-b');
  });

  it('admits an explicit mutation result as the intentional selection target', () => {
    expect(sessionSelectionAfterRefresh(projects, 'thread-b', 'new-thread')).toBe('new-thread');
  });

  it('falls back deterministically when neither selection exists', () => {
    expect(sessionSelectionAfterRefresh(projects, 'missing', 'also-missing')).toBe('thread-a');
  });

  it('follows the selected durable thread when its current session binding changes', () => {
    const rebound = [
      project('unrelated-root'),
      { ...project('new-binding'), id: 'durable-thread' },
    ];

    expect(sessionSelectionAfterRefresh(
      rebound,
      'old-binding',
      '',
      'durable-thread',
    )).toBe('new-binding');
  });

  it('does not follow a same-name session that lacks the selected durable identity', () => {
    const rebound = [
      project('unrelated-root'),
      { ...project('new-binding'), id: 'different-thread', name: 'same label' },
    ];

    expect(sessionSelectionAfterRefresh(
      rebound,
      'old-binding',
      '',
      'durable-thread',
    )).toBe('unrelated-root');
  });
});
