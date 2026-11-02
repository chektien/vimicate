import type { SessionRunPhase, SessionRunRegistry } from '../gateway/sessionRunRegistry';
import type { WorkspaceProject } from './workspaceTypes';

export function projectsWithRunPhases(projects: WorkspaceProject[], registry: SessionRunRegistry) {
  let changed = false;
  const next = projects.map((project) => {
    const runPhase = registry.phaseFor(project.sessionKey);
    const state = projectState(runPhase);
    if (project.runPhase === runPhase && project.state === state) return project;
    changed = true;
    const { runPhase: _previousPhase, ...stableProject } = project;
    return { ...stableProject, state, ...(runPhase ? { runPhase } : {}) };
  });
  return changed ? next : projects;
}

export function projectRunLabel(phase: SessionRunPhase | undefined) {
  if (phase === 'completed') return 'idle';
  return phase ?? 'idle';
}

export function projectRunGlyph(phase: SessionRunPhase | undefined) {
  if (phase === 'submitting' || phase === 'accepted' || phase === 'running') return { symbol: '●', label: 'running', tone: 'running' as const };
  if (phase === 'waiting') return { symbol: '◆', label: 'waiting', tone: 'waiting' as const };
  if (phase === 'failed') return { symbol: '●', label: 'crashed', tone: 'failed' as const };
  if (phase === 'uncertain') return { symbol: '?', label: 'uncertain', tone: 'uncertain' as const };
  return null;
}

function projectState(phase: SessionRunPhase | undefined): WorkspaceProject['state'] {
  if (phase === 'submitting' || phase === 'accepted' || phase === 'running' || phase === 'waiting' || phase === 'uncertain') return 'running';
  return phase === 'failed' ? 'error' : 'idle';
}
