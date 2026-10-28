// @vitest-environment jsdom
import React, { act, startTransition, Suspense, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { buildVisibleTranscriptRenderRows } from './transcriptVisibleRows';
import { useTranscriptDisplayOptions } from './useTranscriptDisplayOptions';
vi.mock('../storage/workspaceStore', () => ({ loadValue: async () => null, saveValue: async () => {} }));
let root: Root;
let committed: WorkspaceMessage[];
let attempts = 0;
const pending = new Promise<never>(() => {});
const tool = (id: string): WorkspaceMessage => ({ id, role: 'tool', text: 'read\ndetail' });
function Owner({ messages, session }: { messages: WorkspaceMessage[]; session: string }) {
  attempts++;
  const display = useTranscriptDisplayOptions(messages, session);
  useLayoutEffect(() => { committed = display.messages; });
  return null;
}
function Pause({ suspend }: { suspend: boolean }) { if (suspend) throw pending; return null; }
function Scene({ messages, session = 's', suspend = false }: { messages: WorkspaceMessage[]; session?: string; suspend?: boolean }) {
  return <Suspense fallback={null}><Owner messages={messages} session={session} /><Pause suspend={suspend} /></Suspense>;
}
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); attempts = 0; root = createRoot(document.createElement('div')); });
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
it('retains only committed group identity through an abandoned replacement and later overlap', async () => {
  await act(async () => root.render(<Scene messages={[tool('c'), tool('d')]} />));
  const original = committed[0]!.id; const count = attempts;
  await act(async () => startTransition(() => root.render(<Scene messages={[tool('uncommitted'), tool('d')]} suspend />)));
  expect(attempts).toBeGreaterThan(count);
  await act(async () => root.render(<Scene messages={[tool('b'), tool('c')]} />));
  expect(committed[0]!.id).toBe(original);
});
it('keeps overlap identity session-scoped and restores it on thread return', async () => {
  await act(async () => root.render(<Scene messages={[tool('c'), tool('d')]} />));
  const original = committed[0]!.id;
  await act(async () => root.render(<Scene messages={[tool('b'), tool('c'), tool('d')]} />));
  expect(committed[0]!.id).toBe(original);
  await act(async () => root.render(<Scene session="other" messages={[tool('b'), tool('c')]} />));
  expect(committed[0]!.id).toBe('tool-group:b');
  await act(async () => root.render(<Scene messages={[tool('a'), tool('b'), tool('c')]} />));
  expect(committed[0]!.id).toBe(original);
});
it('keeps proven skill reads on tool activity through the grouped display pipeline', async () => {
  const narration: WorkspaceMessage = {
    id: 'narration', role: 'narration', text: "I'm loading that operating skill before inspection.",
    sessionKey: 's', runId: 'r',
  };
  const evidence: WorkspaceMessage = {
    id: 'evidence', role: 'tool', text: 'read /fixture/skills/sit-authentication/SKILL.md',
    sessionKey: 's', runId: 'r', tool: { name: 'exec', summary: 'read /fixture/skills/sit-authentication/SKILL.md', skillName: 'sit-authentication', resultSucceeded: true },
  };
  await act(async () => root.render(<Scene messages={[narration, evidence]} />));
  expect(committed[1]?.toolGroup).toMatchObject({ count: 1, lastMessageId: 'evidence' });
  const row = buildVisibleTranscriptRenderRows(committed, new Set())[0];
  expect(row?.message.id).toBe('narration');
  expect(row?.readSkills).toBeUndefined();
  expect(buildVisibleTranscriptRenderRows(committed, new Set())[1]?.readSkills).toEqual(['sit-authentication']);
});
