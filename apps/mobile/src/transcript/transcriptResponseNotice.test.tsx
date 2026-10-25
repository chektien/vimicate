// @vitest-environment jsdom
import React, { act, startTransition, Suspense } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useTranscriptResponseNotice } from './useTranscriptResponseNotice';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
let root: Root; let visible = false; let acknowledge: (messages: WorkspaceMessage[]) => void;
const waiting = new Promise<never>(() => {});
const reply = (text: string, role: WorkspaceMessage['role'] = 'narration'): WorkspaceMessage => ({ id: text, role, text });
function Probe({ messages, reviewing = true, session = 'one', suspend = false }: { messages: WorkspaceMessage[]; reviewing?: boolean; session?: string; suspend?: boolean }) {
  const notice = useTranscriptResponseNotice(session, messages, reviewing);
  React.useLayoutEffect(() => { visible = notice.visible; acknowledge = notice.acknowledge; });
  if (suspend) throw waiting;
  return null;
}
beforeEach(() => { vi.stubGlobal('React', React); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); root = createRoot(document.createElement('div')); visible = false; });
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
const render = async (props: React.ComponentProps<typeof Probe>) => act(async () => root.render(<Suspense fallback={null}><Probe {...props} /></Suspense>));
it('notifies for text streaming at constant row count, not older history, tools, or canonical ID hydration', async () => {
  const first = reply('Checking'); await render({ messages: [first] }); expect(visible).toBe(false);
  await render({ messages: [reply('old'), { ...first, id: 'canonical' }, reply('tool', 'tool')] }); expect(visible).toBe(false);
  await render({ messages: [{ ...first, text: 'Checking more' }] }); expect(visible).toBe(true);
  await render({ messages: [{ ...first, text: 'Checking more' }], reviewing: false }); expect(visible).toBe(false);
  await render({ messages: [reply('Final', 'assistant')], reviewing: false }); expect(visible).toBe(false);
});
it('does not inherit another thread notice or notify for an abandoned response render', async () => {
  await render({ messages: [reply('a')] });
  await act(async () => startTransition(() => root.render(<Suspense fallback={null}><Probe messages={[reply('uncommitted')]} suspend /></Suspense>)));
  expect(visible).toBe(false);
  await render({ messages: [reply('a')] }); expect(visible).toBe(false);
  await render({ messages: [reply('b')] }); expect(visible).toBe(true);
  await render({ messages: [reply('foreign')], session: 'two' }); expect(visible).toBe(false);
});

it('acknowledges only loaded current prose and keeps later streaming independently unread', async () => {
  const old = reply('old'); const latest = reply('new');
  await render({ messages: [old] });
  await render({ messages: [old, latest] }); expect(visible).toBe(true);
  await act(async () => acknowledge([old])); expect(visible).toBe(true);
  await act(async () => acknowledge([old, { ...latest, id: 'canonical' }, reply('tool', 'tool')])); expect(visible).toBe(false);
  await render({ messages: [old, latest] }); expect(visible).toBe(false);
  const stale = acknowledge;
  await render({ messages: [old, { ...latest, text: 'new text continues' }] }); expect(visible).toBe(true);
  await act(async () => stale([old, latest])); expect(visible).toBe(true);
  await render({ session: 'two', messages: [reply('foreign')] });
  await render({ session: 'two', messages: [latest] }); expect(visible).toBe(true);
  await act(async () => stale([latest])); expect(visible).toBe(true);
});
