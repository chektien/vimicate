// @vitest-environment jsdom
import React, { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { useOlderHistoryRequestPresentation } from './useOlderHistoryRequestPresentation';

let root: Root;
let presentation: ReturnType<typeof useOlderHistoryRequestPresentation>;
const load = vi.fn();
const row = (id: string): WorkspaceMessage => ({ id, role: 'assistant', text: id });
function Probe({ messages, loading = false, canLoad = true, session = 'one', problem = '' }: {
  messages: WorkspaceMessage[]; loading?: boolean; canLoad?: boolean; session?: string; problem?: string;
}) {
  const value = useOlderHistoryRequestPresentation({ datasetKey: session, messages, canLoadOlder: canLoad,
    loadingOlder: loading, historyProblem: problem, onLoadOlder: load });
  useLayoutEffect(() => { presentation = value; });
  return null;
}
async function render(messages: WorkspaceMessage[], options: { loading?: boolean; canLoad?: boolean; session?: string; problem?: string } = {}) {
  await act(async () => root.render(<Probe messages={messages} {...options} />));
}
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('React', React); vi.clearAllMocks(); root = createRoot(document.createElement('div')); });
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

it('owns one deliberate request and reports the settled added-message boundary', async () => {
  const latest = [row('previous-top'), row('tail')];
  let finish!: () => void;
  load.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
  await render(latest);
  await act(async () => {
    expect(presentation.request()).toBe(true);
    expect(presentation.request()).toBe(false);
  });
  expect(load).toHaveBeenCalledOnce();
  await render(latest, { loading: true });
  expect(presentation.status).toBe('loading older history…');
  await render([row('older-a'), row('older-b'), ...latest]);
  expect(presentation.status).toBe('2 older messages loaded');
  expect(presentation.boundaryMessageIDs).toEqual(['previous-top']);
  expect(presentation.refreshing).toBe(false);
  finish();
});

it('keeps every retained completed boundary through later loads and resets them for another dataset', async () => {
  const latest = [row('previous-top'), row('tail')];
  load.mockReturnValueOnce(new Promise<void>(() => {}));
  await render(latest); await act(async () => { presentation.request(); });
  await render(latest, { loading: true });
  await render([row('older'), ...latest]);
  await render([row('older'), row('previous-top'), row('tail-revised')]);
  expect(presentation.boundaryMessageIDs).toEqual(['previous-top']);
  expect(presentation.status).toBe('1 older message loaded');
  load.mockReturnValueOnce(new Promise<void>(() => {}));
  await act(async () => { presentation.request(); });
  await render([row('older'), row('previous-top'), row('tail-revised')], { loading: true });
  await render([row('oldest'), row('older'), row('previous-top'), row('tail-revised')]);
  expect(presentation.boundaryMessageIDs).toEqual(['previous-top', 'older']);
  await render([row('oldest'), row('older'), row('tail-revised')]);
  expect(presentation.boundaryMessageIDs).toEqual(['older']);
  await render([row('other')], { session: 'two' });
  expect(presentation.boundaryMessageIDs).toEqual([]);
  expect(presentation.status).toBe('');
});

it('reports a completed check with no added rows and does not request unavailable history', async () => {
  const latest = [row('top')];
  let finish!: () => void;
  load.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
  await render(latest); await act(async () => { presentation.request(); });
  await render(latest, { loading: true });
  await render(latest, { canLoad: false });
  expect(presentation.status).toBe('loading older history…');
  await act(async () => { finish(); });
  expect(presentation.status).toBe('oldest history reached');
  expect(presentation.request()).toBe(false);
});

it('settles a fast no-op request explicitly and retires only its transient result label', async () => {
  vi.useFakeTimers();
  const latest = [row('top')];
  load.mockResolvedValueOnce(undefined);
  await render(latest);
  await act(async () => { expect(presentation.request()).toBe(true); await Promise.resolve(); });
  expect(presentation.status).toBe('history checked · no older messages added');
  await act(async () => { vi.advanceTimersByTime(4_000); });
  expect(presentation.status).toBe('');
  expect(presentation.boundaryMessageIDs).toEqual([]);
  vi.useRealTimers();
});

it('uses the owner receipt after React commits the accepted page', async () => {
  const latest = [row('previous-top'), row('tail')];
  let finish!: (result: unknown) => void;
  load.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  await render(latest);
  await act(async () => { expect(presentation.request()).toBe(true); });
  await render([row('older-a'), row('older-b'), ...latest], { loading: true });
  await act(async () => { finish({ committed: true, published: true, addedMessageCount: 2 }); await Promise.resolve(); });
  await render([row('older-a'), row('older-b'), ...latest]);
  expect(presentation.status).toBe('2 older messages loaded');
  expect(presentation.boundaryMessageIDs).toEqual(['previous-top']);
  await render([row('older-a'), row('older-b'), ...latest]);
  expect(presentation.status).toBe('2 older messages loaded');
  expect(presentation.boundaryMessageIDs).toEqual(['previous-top']);
});

it('reports an older publication that extends an existing leading message identity', async () => {
  const latest = [{ ...row('leading-tool-group'), text: 'partial' }, row('tail')];
  let finish!: (result: unknown) => void;
  load.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  await render(latest);
  await act(async () => { expect(presentation.request()).toBe(true); });
  await render([{ ...row('leading-tool-group'), text: 'partial\nolder detail' }, row('tail')], { loading: true });
  await act(async () => { finish({ committed: true, published: true, addedMessageCount: 0 }); await Promise.resolve(); });
  await render([{ ...row('leading-tool-group'), text: 'partial\nolder detail' }, row('tail')]);
  expect(presentation.status).toBe('older history loaded');
  expect(presentation.boundaryMessageIDs).toEqual(['leading-tool-group']);
});

it('reports raw cursor progress honestly when a continued collapsed tool group adds no visible rows', async () => {
  const latest = [row('leading-tool-group'), row('tail')];
  let finish!: (result: unknown) => void;
  load.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  await render(latest);
  await act(async () => { expect(presentation.request()).toBe(true); });
  await render(latest, { loading: true });
  await act(async () => { finish({ committed: true, published: true, addedMessageCount: 80, addedVisibleRowCount: 0 }); });
  await render(latest);
  expect(presentation.status).toBe('80 older records loaded · no new visible rows');
  await act(async () => { expect(presentation.request()).toBe(true); await Promise.resolve(); });
});

// Gateway transport returns before React commits; its receipt owns completion.
it.each([true, false])('does not report a false empty page while publication is pending (canLoad=%s)', async (canLoad) => {
  const latest = [row('top'), row('tail')];
  let publish!: (result: unknown) => void;
  const publication = new Promise(resolve => { publish = resolve; });
  load.mockResolvedValueOnce({ publication });
  await render(latest);
  await act(async () => { presentation.request(); });
  await render(latest, { canLoad });
  expect(presentation.status).toBe('loading older history…');
  expect(presentation.refreshing).toBe(true);
  await render([row('older'), ...latest], { canLoad });
  await act(async () => { publish({ committed: true, published: true, addedMessageCount: 1 }); });
  expect(presentation.status).toBe('1 older message loaded');
  expect(presentation.boundaryMessageIDs).toEqual(['top']);
});
