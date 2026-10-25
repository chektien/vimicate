// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import fixture from './claudeHistoryFixture.json';
import { type WorkspaceMessage } from '../workspace/workspaceTypes';
import { messagesFromPayload } from '../workspace/historyMessageProjection';
import { parsedTranscriptCache, serializedTranscriptCache } from '../gateway/persistentTranscriptCache';
import { useTranscriptDisplayOptions } from './useTranscriptDisplayOptions';
vi.mock('../storage/workspaceStore', () => ({ loadValue: async () => null, saveValue: async () => {} }));

it('keeps one Claude announcement/read/final after native history switches to its canonical aggregate', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const imported = messagesFromPayload({ ...fixture, messages: fixture.imported });
  const canonical = messagesFromPayload({ ...fixture, messages: fixture.canonical });
  const source = [...imported, ...canonical];
  const before = JSON.stringify(source);
  const container = document.createElement('div'); const root = createRoot(container);
  function Scene({ messages }: { messages: WorkspaceMessage[] }) {
    const display = useTranscriptDisplayOptions(messages, fixture.sessionKey);
    return <>{display.messages.map(m => <section key={m.id} data-role={m.role}>{m.text}</section>)}</>;
  }
  try {
    for (const rows of [source, [...source], [], parsedTranscriptCache(serializedTranscriptCache(source)), source]) {
      await act(async () => root.render(<Scene messages={rows} />));
      if (!rows.length) { expect(container.textContent).toBe(''); continue; }
      const text = container.textContent!;
      expect(text.match(/QC_fixture_SKILL/g)).toHaveLength(1);
      expect(text.match(/QC_fixture_FINAL/g)).toHaveLength(1);
      expect(text.indexOf('Isolated named-skill')).toBeLessThan(text.indexOf('QC_fixture_SKILL'));
      expect(text.indexOf('QC_fixture_SKILL')).toBeLessThan(text.indexOf('Read'));
      expect(text.indexOf('Read')).toBeLessThan(text.indexOf('QC_fixture_FINAL'));
    }
    expect(JSON.stringify(source)).toBe(before);
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});
