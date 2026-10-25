import { describe, expect, it } from 'vitest';
import { promptWithProjectContext } from './projectPromptContext';
import type { WorkspaceProject } from '../workspace/workspaceTypes';

const thread: WorkspaceProject = { id: 'example-thread', sessionKey: 'dashboard:example-thread', name: 'example thread', path: '~/projects/example-notes', branch: '—', starred: false, threadCount: 0, state: 'idle', kind: 'thread', rootSessionKey: 'agent:main:direct:vimicate-ios:project:notes', projectName: 'notes' };

describe('project prompt context', () => {
  it('binds a thread prompt to its parent repo and AGENTS instructions', () => {
    expect(promptWithProjectContext('Review chapter 4', thread)).toContain('- Project: notes\n- Workspace root: ~/projects/example-notes\n- Thread: example thread\n- Before working, read and follow the nearest AGENTS.md');
  });
  it('does not wrap the Vimicate root session', () => {
    expect(promptWithProjectContext('hello', { ...thread, id: 'vimicate', rootSessionKey: 'agent:main:direct:vimicate-ios' })).toBe('hello');
  });
});
