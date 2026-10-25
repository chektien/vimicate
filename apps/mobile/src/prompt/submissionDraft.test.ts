import { describe, expect, it } from 'vitest';
import { createPromptState } from './vimPromptCore';
import { clearedForSubmission, mergedRejectedDraft, restoredAfterRejectedSubmission, submissionResultOwnsSelectedPrompt } from './submissionDraft';

describe('prompt submission ownership', () => {
  it('clears the accepted revision without losing the register', () => {
    const before = { ...createPromptState('  exact accepted text\n'), authority: 7, mode: 'insert' as const, register: 'kept' };
    expect(clearedForSubmission(before)).toMatchObject({ text: '', authority: 8, mode: 'insert', register: 'kept' });
  });

  it('restores a rejected revision before text typed immediately afterward', () => {
    const current = { ...createPromptState('new typing'), register: 'kept' };
    expect(restoredAfterRejectedSubmission(current, 'rejected text')).toMatchObject({ text: 'rejected text\nnew typing', authority: 1, mode: 'insert', register: 'kept' });
    expect(mergedRejectedDraft('rejected text\n', 'new typing')).toBe('rejected text\nnew typing');
  });

  it('does not let an old session result mutate the newly selected prompt', () => {
    expect(submissionResultOwnsSelectedPrompt('a', 'b', 'a')).toBe(false);
    expect(submissionResultOwnsSelectedPrompt('a', 'b', 'b')).toBe(false);
    expect(submissionResultOwnsSelectedPrompt('a', 'a', 'a')).toBe(true);
  });
});
