import { describe, expect, it } from 'vitest';
import { createPromptState } from '../prompt/vimPromptCore';
import { createTranscriptBuffer, createTranscriptVimState } from '../transcript/transcriptVim';
import { sessionUsage, workspaceModeLabel } from './statusProjection';

describe('workspace status projection', () => {
  it('does not report prompt insert mode while another pane owns focus', () => {
    const prompt = { ...createPromptState(), mode: 'insert' as const };
    const transcript = createTranscriptVimState(createTranscriptBuffer([{ id: 'one', role: 'assistant', text: 'one' }]));
    expect(workspaceModeLabel('prompt', prompt, transcript)).toBe('insert');
    expect(workspaceModeLabel('projects', prompt, transcript)).toBe('normal');
    expect(workspaceModeLabel('transcript', prompt, transcript)).toBe('normal');
    expect(workspaceModeLabel('transcript', { ...prompt, mode: 'normal' }, { ...transcript, visualMode: 'block' })).toBe('visual-block');
  });

  it('keeps the context window visible when the current size is unknown', () => {
    expect(sessionUsage({ totalTokens: 143454, contextTokens: 258400 } as never)).toBe('143k/258k');
    expect(sessionUsage({ contextTokens: 258400 } as never)).toBe('—/258k');
    expect(sessionUsage({ contextTokens: 258400, estimatedCostUsd: 1.234 } as never)).toBe('—/258k · $1.23');
    expect(sessionUsage({ totalTokens: 5000 } as never)).toBe('');
    expect(sessionUsage(undefined)).toBe('');
  });
});
