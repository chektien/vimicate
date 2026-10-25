import { describe, expect, it } from 'vitest';
import { createTranscriptBuffer, createTranscriptVimState } from './transcriptVim';
import { transcriptDisclosureCommandForKey, transcriptFoldExpansionForKey, transcriptFoldLineInMessage, type TranscriptFoldTarget } from './transcriptFoldCommand';
import type { HardwareKeyEvent } from '../../modules/vimicate-editor';

const buffer = createTranscriptBuffer([{ id: 'tool', role: 'tool', text: 'bash\none\ntwo' }]);
const state = createTranscriptVimState(buffer);
const folded: TranscriptFoldTarget = { messageId: 'tool', messageIndex: 0, sourceRow: 0, expanded: false };
const hardwareKey = (key: string, control = false): HardwareKeyEvent => ({ key, shift: false, control, option: false, command: false });

describe('transcript fold keyboard commands', () => {
  it('keeps an interior disclosure on its source line when a key expands it', () => {
    const content = createTranscriptBuffer([{ id: 'reply', role: 'assistant', text: 'Answer\n<details>\n- one\n</details>' }]);
    expect(transcriptFoldLineInMessage(content, 0, 1)).toBe(1);
    expect(transcriptFoldExpansionForKey(createTranscriptVimState(content), hardwareKey('enter'), {
      messageId: 'reply:details:1', messageIndex: 0, sourceRow: 1, expanded: false,
    })).toBe(true);
  });
  it.each(['enter', 'l', 'right'])('expands a folded tool with %s', (key) => {
    expect(transcriptFoldExpansionForKey(state, hardwareKey(key), folded)).toBe(true);
  });
  it.each(['h', 'left'])('collapses an expanded tool with %s', (key) => {
    expect(transcriptFoldExpansionForKey(state, hardwareKey(key), { ...folded, expanded: true })).toBe(false);
  });
  it('keeps disclosure arrows owned by the fold when already at that endpoint', () => {
    expect(transcriptFoldExpansionForKey(state, hardwareKey('right'), { ...folded, expanded: true })).toBe(true);
    expect(transcriptFoldExpansionForKey(state, hardwareKey('left'), folded)).toBe(false);
  });
  it('toggles an expanded tool closed with Enter', () => {
    expect(transcriptFoldExpansionForKey(state, hardwareKey('enter'), { ...folded, expanded: true })).toBe(false);
  });
  it('lets the visible fold own Enter before recovery on a doubly classified row', () => {
    expect(transcriptDisclosureCommandForKey(
      state,
      hardwareKey('enter'),
      { ...folded, expanded: true },
      { messageId: 'tool', state: 'available' },
    )).toEqual({ type: 'fold', target: { ...folded, expanded: true }, expanded: false });
  });
  it('retains recovery Enter when no fold owns the row', () => {
    expect(transcriptDisclosureCommandForKey(
      state,
      hardwareKey('enter'),
      null,
      { messageId: 'clipped', state: 'available' },
    )).toEqual({ type: 'recover', messageId: 'clipped' });
  });
  it('does not steal visual, counted, pending, or modified motions', () => {
    expect(transcriptFoldExpansionForKey({ ...state, visualMode: 'character' }, hardwareKey('l'), folded)).toBeNull();
    expect(transcriptFoldExpansionForKey({ ...state, count: '2' }, hardwareKey('l'), folded)).toBeNull();
    expect(transcriptFoldExpansionForKey({ ...state, pending: 'y' }, hardwareKey('l'), folded)).toBeNull();
    expect(transcriptFoldExpansionForKey(state, hardwareKey('l', true), folded)).toBeNull();
  });
});
