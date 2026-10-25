// @vitest-environment jsdom
import React, { act, useLayoutEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { acceptNativeText, createPromptState, handlePromptKey, type PromptState } from './vimPromptCore';

const storage = vi.hoisted(() => new Map<string, string>());
const delayedReads = vi.hoisted(() => new Map<string, Promise<string>[]>());
vi.mock('../storage/workspaceStore', () => ({
  loadDraft: async (sessionKey: string) => {
    const queued = delayedReads.get(sessionKey);
    const delayed = queued?.shift();
    if (queued && queued.length === 0) delayedReads.delete(sessionKey);
    if (delayed) return delayed;
    return storage.get(sessionKey) ?? '';
  },
  saveDraft: async (sessionKey: string, text: string) => { storage.set(sessionKey, text); },
  loadPromptHistory: async () => [], appendPromptHistory: async () => undefined,
}));

import { usePromptHistoryController } from './usePromptHistoryController';

type MountedOwner = {
  prompt: PromptState;
  setPrompt: React.Dispatch<React.SetStateAction<PromptState>>;
  restoreRejected: (text: string) => void;
};

let owner: MountedOwner;
let root: Root;
let container: HTMLDivElement;
let promptPublicationCount = 0;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}

function Probe({ sessionKey }: { sessionKey: string }) {
  const [prompt, setPrompt] = useState(() => createPromptState());
  const promptRef = useRef(prompt); promptRef.current = prompt;
  const publishPrompt = React.useCallback<React.Dispatch<React.SetStateAction<PromptState>>>((action) => {
    promptPublicationCount += 1;
    setPrompt(action);
  }, []);
  const history = usePromptHistoryController(sessionKey, prompt, promptRef, publishPrompt);
  useLayoutEffect(() => { owner = { prompt, setPrompt, restoreRejected: history.restoreRejected }; });
  return null;
}

async function settle() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

describe('mounted prompt history rejection ownership', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    storage.clear();
    delayedReads.clear();
    promptPublicationCount = 0;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
    vi.unstubAllGlobals();
  });

  it('merges a late rejected A send into A memory without overwriting selected B or newer A edits', async () => {
    storage.set('a', 'draft sent from a');
    storage.set('b', 'draft owned by b');
    await act(async () => { root.render(<Probe sessionKey="a" />); });
    await settle();
    expect(owner.prompt.text).toBe('draft sent from a');

    const restoreRejectedA = owner.restoreRejected;
    await act(async () => { owner.setPrompt(createPromptState('')); });
    await act(async () => { root.render(<Probe sessionKey="b" />); });
    await settle();
    expect(owner.prompt.text).toBe('draft owned by b');

    // A newer edit can be parked after send-clear but before transport refusal.
    // It belongs behind the rejected text and must never leak into B.
    storage.set('a', 'newer a edit');
    await act(async () => { restoreRejectedA('draft sent from a'); });
    await settle();
    expect(owner.prompt.text).toBe('draft owned by b');

    await act(async () => { root.render(<Probe sessionKey="a" />); });
    await settle();
    expect(owner.prompt.text).toBe('draft sent from a\nnewer a edit');
    expect(storage.get('b')).toBe('draft owned by b');
  });

  it('persists the origin draft when its rejected continuation settles after the mounted route is disposed', async () => {
    storage.set('a', 'draft sent from a');
    storage.set('b', 'draft owned by b');
    await act(async () => { root.render(<Probe sessionKey="a" />); });
    await settle();
    const restoreRejectedA = owner.restoreRejected;
    await act(async () => { owner.setPrompt(createPromptState('')); });
    await act(async () => { root.render(<Probe sessionKey="b" />); });
    await settle();
    await act(async () => { root.unmount(); });

    restoreRejectedA('draft sent from a');
    await settle();
    expect(storage.get('a')).toBe('draft sent from a');
    expect(storage.get('b')).toBe('draft owned by b');
  });

  it('persists rejected text plus the latest origin edit without publishing after selected-origin disposal', async () => {
    storage.set('a', 'draft sent from a');
    await act(async () => { root.render(<Probe sessionKey="a" />); });
    await settle();
    const restoreRejectedA = owner.restoreRejected;
    await act(async () => { owner.setPrompt(createPromptState('newer unsent a edit')); });
    await act(async () => { root.unmount(); });
    promptPublicationCount = 0;

    restoreRejectedA('draft sent from a');
    await settle();

    expect(storage.get('a')).toBe('draft sent from a\nnewer unsent a edit');
    expect(promptPublicationCount).toBe(0);
  });

  it('re-enables mounted publication after the StrictMode setup-cleanup probe', async () => {
    storage.set('a', 'draft sent from a');
    await act(async () => { root.render(<React.StrictMode><Probe sessionKey="a" /></React.StrictMode>); });
    await settle();
    const restoreRejectedA = owner.restoreRejected;
    await act(async () => { owner.setPrompt(createPromptState('')); });
    promptPublicationCount = 0;

    await act(async () => { restoreRejectedA('draft sent from a'); });
    await settle();

    expect(owner.prompt.text).toBe('draft sent from a');
    expect(promptPublicationCount).toBeGreaterThan(0);
  });

  it('publishes the rejection into A when A returns and is edited before the off-route read resolves', async () => {
    storage.set('a', 'draft sent from a');
    storage.set('b', 'draft owned by b');
    await act(async () => { root.render(<Probe sessionKey="a" />); });
    await settle();
    const restoreRejectedA = owner.restoreRejected;
    await act(async () => { owner.setPrompt(createPromptState('')); });
    await act(async () => { root.render(<Probe sessionKey="b" />); });
    await settle();

    const read = deferred<string>();
    delayedReads.set('a', [read.promise]);
    restoreRejectedA('draft sent from a');
    await act(async () => { root.render(<Probe sessionKey="a" />); });
    await settle();
    await act(async () => { owner.setPrompt(createPromptState('new active a edit')); });
    expect(owner.prompt.text).toBe('new active a edit');

    await act(async () => { read.resolve('older durable a text'); });
    await settle();
    expect(owner.prompt.text).toBe('draft sent from a\nnew active a edit');
    expect(storage.get('a')).toBe('draft sent from a\nnew active a edit');
    expect(storage.get('b')).toBe('draft owned by b');
  });

  it('restores into selected A when its rejection resolves before A hydration', async () => {
    storage.set('a', 'draft sent from a');
    storage.set('b', 'draft owned by b');
    await act(async () => { root.render(<Probe sessionKey="a" />); });
    await settle();
    const restoreRejectedA = owner.restoreRejected;
    await act(async () => { owner.setPrompt(createPromptState('')); });
    await act(async () => { root.render(<Probe sessionKey="b" />); });
    await settle();

    const rejectionRead = deferred<string>();
    const hydrationRead = deferred<string>();
    delayedReads.set('a', [rejectionRead.promise, hydrationRead.promise]);
    restoreRejectedA('draft sent from a');
    await act(async () => { root.render(<Probe sessionKey="a" />); });
    await act(async () => { owner.setPrompt(createPromptState('new active a edit')); });
    expect(owner.prompt.text).toBe('new active a edit');

    await act(async () => { rejectionRead.resolve('older durable a text'); });
    await settle();
    expect(owner.prompt.text).toBe('draft sent from a\nnew active a edit');

    await act(async () => { hydrationRead.resolve('stale hydration text'); });
    await settle();
    expect(owner.prompt.text).toBe('draft sent from a\nnew active a edit');
    expect(storage.get('a')).toBe('draft sent from a\nnew active a edit');
    expect(storage.get('b')).toBe('draft owned by b');
  });
  it('retires an off-route rejection publication after return-to-origin then unmount', async () => {
    storage.set('a', 'draft sent from a');
    storage.set('b', 'draft owned by b');
    await act(async () => { root.render(<Probe sessionKey="a" />); });
    await settle();
    const restoreRejectedA = owner.restoreRejected;
    await act(async () => { owner.setPrompt(createPromptState('')); });
    await act(async () => { root.render(<Probe sessionKey="b" />); });
    await settle();
    const read = deferred<string>();
    delayedReads.set('a', [read.promise]);
    restoreRejectedA('draft sent from a');
    await act(async () => { root.render(<Probe sessionKey="a" />); });
    await settle();
    await act(async () => { owner.setPrompt(createPromptState('new active a edit')); });
    await act(async () => { root.unmount(); });
    const publicationsBeforeResolution = promptPublicationCount;
    await act(async () => { read.resolve('stale durable text'); });
    await settle();
    expect(storage.get('a')).toBe('draft sent from a\nnew active a edit');
    expect(storage.get('b')).toBe('draft owned by b');
    expect(promptPublicationCount).toBe(publicationsBeforeResolution);
  });

  it.each(['different draft', 'alpha beta gamma'])('preserves cursor and undo/redo across another thread containing %s', async (other) => {
    storage.set('a', 'alpha beta gamma');
    storage.set('b', other);
    await act(async () => { root.render(<Probe sessionKey="a" />); });
    await act(async () => {
      owner.setPrompt((current) => ({ ...current, selection: { start: 6, end: 6 } }));
    });
    await act(async () => {
      owner.setPrompt((current) => handlePromptKey(handlePromptKey(current, { key: 'c' }).state, { key: 'w' }).state);
    });
    const edited = owner.prompt;
    await act(async () => { root.render(<Probe sessionKey="b" />); });
    expect(owner.prompt.undo).toHaveLength(0);
    const bAuthority = owner.prompt.authority;
    await act(async () => { root.render(<Probe sessionKey="a" />); });
    expect(owner.prompt.selection).toEqual(edited.selection);
    expect(owner.prompt.mode).toBe('insert');
    expect(owner.prompt.undo).toEqual(edited.undo);
    expect(owner.prompt.authority).toBeGreaterThan(bAuthority);
    expect(acceptNativeText(owner.prompt, 'stale B callback', { start: 2, end: 2 }, bAuthority)).toBe(owner.prompt);
    await act(async () => { owner.setPrompt((current) => handlePromptKey(handlePromptKey(current, { key: 'escape' }).state, { key: 'u' }).state); });
    expect(owner.prompt.text).toBe('alpha beta gamma');
    expect(owner.prompt.selection).toEqual({ start: 6, end: 6 });
    await act(async () => { root.render(<Probe sessionKey="b" />); });
    await act(async () => { root.render(<Probe sessionKey="a" />); });
    await act(async () => { owner.setPrompt((current) => handlePromptKey(current, { key: 'r', control: true }).state); });
    expect(owner.prompt.text).toBe(edited.text);
  });

  it('isolates equal-text threads and restores cursor motion without requiring a text edit', async () => {
    storage.set('a', 'same text'); storage.set('b', 'same text');
    await act(async () => { root.render(<Probe sessionKey="a" />); });
    await act(async () => { owner.setPrompt((current) => ({ ...current, selection: { start: 2, end: 2 } })); });
    await act(async () => { root.render(<Probe sessionKey="b" />); });
    await act(async () => { owner.setPrompt((current) => ({ ...current, selection: { start: 5, end: 5 } })); });
    await act(async () => { root.render(<Probe sessionKey="a" />); });
    expect(owner.prompt.selection).toEqual({ start: 2, end: 2 });
    await act(async () => { root.render(<Probe sessionKey="b" />); });
    expect(owner.prompt.selection).toEqual({ start: 5, end: 5 });
  });

  it('retains cursor changes made on a remembered thread before its slow disk read finishes', async () => {
    storage.set('a', 'saved draft'); storage.set('b', 'other draft');
    await act(async () => { root.render(<Probe sessionKey="a" />); });
    await act(async () => { root.render(<Probe sessionKey="b" />); });
    const read = deferred<string>(); delayedReads.set('a', [read.promise]);
    await act(async () => { root.render(<Probe sessionKey="a" />); });
    await act(async () => { owner.setPrompt((current) => ({ ...current, selection: { start: 3, end: 3 } })); });
    await act(async () => { root.render(<Probe sessionKey="b" />); });
    await act(async () => { root.render(<Probe sessionKey="a" />); });
    expect(owner.prompt.selection).toEqual({ start: 3, end: 3 });
    await act(async () => { read.resolve('stale draft'); });
    expect(owner.prompt.text).toBe('saved draft');
    expect(owner.prompt.selection).toEqual({ start: 3, end: 3 });
  });

});
