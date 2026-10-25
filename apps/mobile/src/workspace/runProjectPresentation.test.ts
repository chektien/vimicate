import { describe, expect, it } from 'vitest';
import { SessionRunRegistry } from '../gateway/sessionRunRegistry';
import { projectRunGlyph, projectRunLabel, projectsWithRunPhases } from './runProjectPresentation';
import type { WorkspaceProject } from './workspaceTypes';

const project: WorkspaceProject = { id: 'one', sessionKey: 'one', name: 'one', path: '~', branch: '—', starred: false, threadCount: 1, state: 'running' };

describe('project run presentation', () => {
  it('does not trust a stale session-list running flag', () => {
    const registry = new SessionRunRegistry();
    const presented = projectsWithRunPhases([project], registry)[0];
    expect(presented).toMatchObject({ state: 'idle' });
    expect(presented).not.toHaveProperty('runPhase');
  });

  it('uses the shared authoritative lifecycle grammar', () => {
    const registry = new SessionRunRegistry(); registry.registerRun('one', 'r1'); registry.observePhase('one', 'waiting', 'r1');
    expect(projectsWithRunPhases([project], registry)[0]).toMatchObject({ state: 'running', runPhase: 'waiting' });
    registry.observePhase('one', 'completed', 'r1');
    expect(projectRunLabel(registry.phaseFor('one'))).toBe('idle');
  });

  it('does not leave a success glyph on a completed project', () => {
    expect(projectRunGlyph('running')).toMatchObject({ symbol: '●', label: 'running' });
    expect(projectRunGlyph('waiting')).toMatchObject({ symbol: '◆', label: 'waiting' });
    expect(projectRunGlyph('failed')).toMatchObject({ symbol: '●', label: 'crashed' });
    expect(projectRunGlyph('uncertain')).toMatchObject({ symbol: '?', label: 'uncertain' });
    expect(projectRunGlyph('completed')).toBeNull();
  });
});
