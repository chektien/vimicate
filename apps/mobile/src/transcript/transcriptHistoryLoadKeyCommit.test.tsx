// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useSynchronousState } from '../app/useSynchronousState';
import { createTranscriptBuffer, createTranscriptVimState, handleTranscriptKey } from './transcriptVim';
import { requestsOlderTranscriptAtReviewTop } from './transcriptHistoryLoadKey';

it('accepts the very next fresh k even when the top motion has not rendered yet', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const buffer = createTranscriptBuffer([{ id: 'one', role: 'assistant', text: 'first\nsecond' }]);
  const rows = [0, 1]; let press!: (repeat?: boolean) => void;
  const request = vi.fn(); const node = document.createElement('div'); const root = createRoot(node);
  function Probe() {
    const [state, setState, current] = useSynchronousState(() => createTranscriptVimState(buffer));
    press = (repeat = false) => {
      const event = { key: 'k', shift: false, control: false, command: false, option: false, isRepeat: repeat };
      const clean = !current.current.pending && !current.current.count && !current.current.visualMode;
      if (requestsOlderTranscriptAtReviewTop(event, current.current.cursor.row, rows, clean)) request();
      else setState(handleTranscriptKey(buffer, current.current, event, rows).state);
    };
    return <div>{state.cursor.row}</div>;
  }
  try {
    await act(async () => root.render(<Probe />));
    expect(node.textContent).toBe('1');
    await act(async () => {
      press(); expect(request).not.toHaveBeenCalled();
      expect(node.textContent).toBe('1'); // React has not committed the top motion.
      press(true); expect(request).not.toHaveBeenCalled();
      press(); expect(request).toHaveBeenCalledOnce();
    });
    expect(node.textContent).toBe('0');
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});
