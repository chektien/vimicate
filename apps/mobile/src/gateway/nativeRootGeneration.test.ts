import { expect, it } from 'vitest';
import { sessionEntriesFromPayload } from '../workspace/workspaceTypes';
import { archivedStateForProject } from './archivedHistory';
import { gatewaySessionGeneration } from './registrySessionIdentity';
const key = 'agent:main:direct:vimicate-ios:project:r3cap';
const id = '00000000-0000-4000-a000-000000000127';
const project = sessionEntriesFromPayload({ sessions: [{ key, sessionId: id }] })[0];
const registry = { capabilities: { sessionHistory: 'sqlite-display-v1', archivedSessionFamily: 'sqlite-family-v1' },
  currentSessionGenerations: { [key]: { sessionId: id, sessionStartedAtMs: 1000 } } };
it('native root projects obtain their missing list epoch from the explicit registry census', () => {
  expect(gatewaySessionGeneration(project, registry)).toEqual({ sessionId: id, sessionStartedAtMs: 1000, historyModel: 'sqlite-display-v1' });
  expect(archivedStateForProject(project, registry)?.identity.currentSessionStartedAtMs).toBe(1000);
});
it('rejects wrong scope, malformed generation and an unadvertised census', () => {
  for (const bad of [{ ...registry, capabilities: {} }, { ...registry, currentSessionGenerations: { other: registry.currentSessionGenerations[key] } },
    { ...registry, currentSessionGenerations: { [key]: { sessionId: id, sessionStartedAtMs: -1 } } }]) {
    expect(gatewaySessionGeneration(project, bad)?.sessionStartedAtMs).toBe(0);
  }
});
