import { describe, expect, it } from 'vitest';
import type { HardwareKeyEvent } from '../../modules/vimicate-editor';
import { authorizedTranscriptProjection } from './transcriptProjectionAuthority';
import { createTranscriptBuffer, createTranscriptVimState, handleTranscriptKey, projectTranscriptVimState } from './transcriptVim';

const key = (value: string): HardwareKeyEvent => ({ key: value, shift: value === 'G', control: false, option: false, command: false });

describe('transcript projection authority', () => {
  it('does not let a stale folded-row projection overwrite a later bare G', () => {
    const buffer = createTranscriptBuffer([{ id: 'archive', role: 'assistant', text: Array.from({ length: 609 }, (_, index) => `line ${index + 1}`).join('\n') }]);
    const review = { ...createTranscriptVimState(buffer), cursor: { row: 420, column: 0 }, followTail: false };
    const staleProjection = projectTranscriptVimState(review, buffer, Array.from({ length: 580 }, (_, index) => index));
    const tail = handleTranscriptKey(buffer, review, key('G'), Array.from({ length: 609 }, (_, index) => index)).state;

    expect(staleProjection.cursor.row).toBe(420);
    expect(tail).toMatchObject({ cursor: { row: 608, column: 0 }, followTail: true });
    expect(authorizedTranscriptProjection(tail, review, staleProjection)).toBe(tail);
  });

  it('commits a projection while its originating navigation state still owns', () => {
    const buffer = createTranscriptBuffer([{ id: 'fold', role: 'tool', text: 'one\ntwo\nthree' }]);
    const current = { ...createTranscriptVimState(buffer), cursor: { row: 2, column: 0 } };
    const projected = projectTranscriptVimState(current, buffer, [0]);

    expect(authorizedTranscriptProjection(current, current, projected)).toBe(projected);
    expect(projected.cursor.row).toBe(0);
  });
});
