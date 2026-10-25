// @vitest-environment jsdom
import React, { act, startTransition, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useSynchronousState } from '../app/useSynchronousState';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { authorizedTranscriptProjection } from './transcriptProjectionAuthority';
import { createTranscriptBuffer, createTranscriptVimState, projectTranscriptVimState } from './transcriptVim';
import { buildVisibleTranscriptRenderRows, transcriptNavigationSourceRows } from './transcriptVisibleRows';
import { useSessionTranscriptNavigation } from './useSessionTranscriptNavigation';
import type { TranscriptPaneHandle } from './TranscriptPane';

const initial: WorkspaceMessage[] = [{ id: 'tool', role: 'tool', text: 'summary\ndetail\nlast', tool: { name: 'read', summary: 'summary' } }];
const tailReveal = { consumeIfAdvanced: () => false };
let publish: React.Dispatch<React.SetStateAction<WorkspaceMessage[]>>;
let commits: number[];
const container = document.createElement('div');
let root: ReturnType<typeof createRoot>;
function Probe({ seed = initial }: { seed?: WorkspaceMessage[] }) {
  const [messages, setMessages] = useState(seed); publish = setMessages;
  const buffer = useMemo(() => createTranscriptBuffer(messages), [messages]);
  const [navigation, setNavigation, navigationRef] = useSynchronousState(() => createTranscriptVimState(buffer));
  const viewportRef = useRef<TranscriptPaneHandle | null>(null);
  const rows = useMemo(() => transcriptNavigationSourceRows(buildVisibleTranscriptRenderRows(messages, new Set())), [messages]);
  useLayoutEffect(() => { viewportRef.current = { navigationSourceRows: () => rows } as unknown as TranscriptPaneHandle; }, [rows]);
  useSessionTranscriptNavigation({ sessionKey: 'test', buffer, navigationRef, setNavigation, viewportRef, tailReveal });
  const projected = useMemo(() => projectTranscriptVimState(navigation, buffer, rows), [navigation, buffer, rows]);
  useEffect(() => {
    commits.push(navigation.cursor.row);
    if (projected !== navigation) setNavigation(current => authorizedTranscriptProjection(current, navigation, projected));
  }, [navigation, projected, setNavigation]);
  return <div>{navigation.cursor.row}</div>;
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('React', React);
  vi.stubGlobal('requestAnimationFrame', () => 1); vi.stubGlobal('cancelAnimationFrame', () => {});
  commits = []; root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
// A lower-priority update remains queued while React replays the urgent
// functional updater on each synchronous commit. No synthetic setter loop.
it.each([
  ['folded tool', initial],
  ['blank-line tail', [{ id: 'answer', role: 'assistant', text: 'answer\n\n' }]],
  ['bounded answer', [{ id: 'answer', role: 'assistant', text: 'long line\n'.repeat(500) }]],
] as const)('converges %s across transition/urgent publication overlap', async (_name, seed) => {
  await act(async () => root.render(<Probe seed={seed as WorkspaceMessage[]} />));
  commits = [];
  await act(async () => {
    startTransition(() => publish(current => [...current, { id: 'later', role: 'tool', text: 'next\nbody', tool: { name: 'read', summary: 'next' } }]));
    publish(current => current.map(message => ({ ...message, text: `${message.text}\n` })));
  });
  expect(commits.length).toBeLessThan(10);
  expect(container.textContent).toBe(String(seed[0]!.text.split('\n').length + 1));
});
