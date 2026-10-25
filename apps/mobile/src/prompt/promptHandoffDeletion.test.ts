import { describe, expect, it } from 'vitest';
import { composeTranscriptHandoff } from '../transcript/transcriptHandoff';
import { acceptNativeSelection, acceptNativeText, createPromptState, handlePromptKey, insertPromptHandoff, type PromptState } from './vimPromptCore';

const body = '```text\nReview the returned results.\nPreserve the original files.\n```';
const apply = (state: PromptState, ...keys: string[]) => keys.reduce((current, key) => handlePromptKey(current, { key }).state, state);
function handoff() {
  const payload = composeTranscriptHandoff({ id: 'answer', role: 'assistant', text: body }, 0, 0, 'i');
  return insertPromptHandoff(createPromptState(''), payload.text, payload.caretOffset);
}

describe('deleting the handoff introduction and blank first line', () => {
  it('deletes both header lines with consecutive dd and keeps navigation live', () => {
    const inserted = handoff();
    const first = apply(inserted, 'escape', 'g', 'g', 'd', 'd');
    expect(first).toMatchObject({ text: '\n' + body, pending: '', selection: { start: 0, end: 0 } });
    const deleted = apply(first, 'd', 'd');
    expect(deleted).toMatchObject({ text: body, pending: '', register: '\n', registerKind: 'line' });
    expect(apply(deleted, 'j').selection.end).toBe(body.indexOf('Review'));
    expect(apply(deleted, 'j', 'k').selection.end).toBe(0);
    expect(apply(deleted, 'l').selection.end).toBe(1);
    expect(apply(deleted, 'u').text).toBe('\n' + body);
    expect(apply(inserted, 'escape', 'g', 'g', '2', 'd', 'd').text).toBe(body);
    // Delayed UIKit echoes of the handoff must not restore the deleted header
    // or move the controlled normal-mode caret.
    const echo = acceptNativeText(deleted, inserted.text, inserted.selection, inserted.authority);
    expect(acceptNativeSelection(echo, inserted.selection, false)).toEqual(deleted);
  });

  it('moves off an empty first line without a negative column trapping j at zero', () => {
    const first = apply(handoff(), 'escape', 'g', 'g', 'd', 'd');
    expect(apply(first, 'j').selection.end).toBe(1);
    expect(apply(first, 'j', 'k').selection.end).toBe(0);
    expect(apply(first, 'h').selection.end).toBe(0);
    expect(apply(first, '0').selection.end).toBe(0);
  });
});
