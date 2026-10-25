import { describe, expect, it } from 'vitest';
import { transcriptAuthoredPromptChrome } from './transcriptAuthoredPromptChrome';

describe('authored prompt transcript chrome', () => {
  it('makes every user turn a continuous scan landmark with capped edges', () => {
    expect(transcriptAuthoredPromptChrome('user', true, false, false)).toEqual({
      band: true, active: false, topEdge: true, bottomEdge: false,
    });
    expect(transcriptAuthoredPromptChrome('user', false, false, true)).toEqual({
      band: true, active: true, topEdge: false, bottomEdge: false,
    });
    expect(transcriptAuthoredPromptChrome('user', false, true, false)).toEqual({
      band: true, active: false, topEdge: false, bottomEdge: true,
    });
  });

  it('does not tint assistant, narration or machine rows as authored prompts', () => {
    expect(transcriptAuthoredPromptChrome('assistant', true, true, true).band).toBe(false);
    expect(transcriptAuthoredPromptChrome('narration', true, true, true).band).toBe(false);
    expect(transcriptAuthoredPromptChrome('tool', true, true, true).band).toBe(false);
  });
});
