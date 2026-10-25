// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { SessionRunRegistry } from './sessionRunRegistry';
import { sessionFailureNotice } from './sessionFailureNotice';
import { useStoppedRunNotices } from './useStoppedRunNotices';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';

it('projects confirmation across unchanged, reloaded and older-review raw arrays without rewriting history', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const root = createRoot(document.createElement('div')); const registry = new SessionRunRegistry();
  const raw = sessionFailureNotice({ sessionKey: 'route', lastRunId: 'old', status: 'failed', lastRunError: 'agent run aborted', endedAt: 123 })!;
  let rows = [raw]; let shown: WorkspaceMessage[] = [];
  function View() { shown = useStoppedRunNotices(rows, registry); return null; }
  const render = () => act(async () => root.render(<View />));
  await render(); expect(shown).toBe(rows);
  registry.registerRun('route', 'old'); registry.beginStopRequest('route', 'old')(true);
  await render(); expect(shown[0]?.role).toBe('command'); expect(raw.role).toBe('error');
  const stable = shown; await render(); expect(shown).toBe(stable);
  rows = [{ ...raw }]; await render(); expect(shown[0]?.role).toBe('command');
  registry.registerRun('route', 'next'); registry.beginStopRequest('route', 'next')(true);
  rows = [raw, { ...raw, id: 'session-failure:next', runId: 'next' }];
  await render(); expect(shown.map(row => row.role)).toEqual(['command', 'command']);
  registry.clear(); await render(); expect(shown).toBe(rows);
  await act(async () => root.unmount()); vi.unstubAllGlobals();
});
