import { describe, expect, it } from 'vitest';
import { projectHierarchyMeta, projectParentLabel } from './projectHierarchyPresentation';
import type { WorkspaceProject } from './workspaceTypes';

const root: WorkspaceProject = { id: 'root', sessionKey: 'root', name: 'Example Research', path: '/repo', branch: 'main', starred: false, threadCount: 2, state: 'idle', kind: 'project', rootSessionKey: 'root' };

describe('project hierarchy presentation', () => {
  it('shows the root project on a thread in every flat list', () => {
    const thread: WorkspaceProject = { ...root, id: 'thread', sessionKey: 'thread', name: 'example slides', kind: 'thread', rootSessionKey: 'root', projectName: 'Example Research' };
    expect(projectParentLabel(thread, [root, thread])).toBe('Example Research');
    expect(projectHierarchyMeta(thread, [root, thread])).toBe('↳ example research');
  });
  it('falls back through root identity and keeps roots labelled root', () => {
    const thread: WorkspaceProject = { ...root, id: 'thread', sessionKey: 'thread', name: 'child', kind: 'thread', rootSessionKey: 'root' };
    expect(projectParentLabel(thread, [root, thread])).toBe('Example Research');
    expect(projectHierarchyMeta(root, [root, thread])).toBe('root');
  });
});
