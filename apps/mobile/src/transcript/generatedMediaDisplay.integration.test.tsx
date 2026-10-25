// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { generatedMediaPair } from './generatedMediaFixture';
import { useTranscriptDisplayOptions } from './useTranscriptDisplayOptions';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
vi.mock('../storage/workspaceStore', () => ({ loadValue: async () => null, saveValue: async () => {} }));
it('wires delivery reconciliation into the real display owner without changing persisted history', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div'); const root = createRoot(container);
  const pair = generatedMediaPair(); const snapshot = JSON.stringify(pair);
  function Scene({ messages }: { messages: WorkspaceMessage[] }) {
    const display = useTranscriptDisplayOptions(messages, messages[0]?.sessionKey ?? 'other');
    return <>{display.messages.map(m => <section key={m.id}>{m.text}{m.attachments?.map(a => <a key={a.id} href={a.uri} aria-label={a.filename}>{a.pixelWidth}</a>)}</section>)}</>;
  }
  try {
    for (const rows of [[pair[0]!], pair, [], JSON.parse(snapshot), [pair[1]!], pair]) {
      await act(async () => root.render(<Scene messages={rows} />));
      expect(container.querySelectorAll('a')).toHaveLength(rows.length ? 2 : 0);
      if (rows.length === 2) {
        expect(container.querySelectorAll('section')).toHaveLength(1);
        expect(container.querySelector('a')!.getAttribute('href')).toContain('/api/chat/media/outgoing/');
        expect(container.querySelector('a')!.getAttribute('aria-label')).toBe('Scene version 1');
      }
    }
    expect(JSON.stringify(pair)).toBe(snapshot);
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});
