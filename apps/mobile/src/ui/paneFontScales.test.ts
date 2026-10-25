import { describe, expect, it } from 'vitest';
import { adjustedPaneFontScales, DEFAULT_PANE_FONT_SCALES, parsedPaneFontScales } from './paneFontScales';

describe('independent pane font scales', () => {
  it('starts the prompt one step smaller than transcript and projects', () => {
    expect(DEFAULT_PANE_FONT_SCALES).toEqual({ projects: 1, transcript: 1, prompt: 0.9, filesList: 1, filesPreview: 0.9 });
  });

  it('adjusts only the focused pane', () => {
    const next = adjustedPaneFontScales(DEFAULT_PANE_FONT_SCALES, 'transcript', 1);
    expect(next).toEqual({ projects: 1, transcript: 1.1, prompt: 0.9, filesList: 1, filesPreview: 0.9 });
    expect(adjustedPaneFontScales(next, 'filesPreview', -1)).toEqual({ projects: 1, transcript: 1.1, prompt: 0.9, filesList: 1, filesPreview: 0.8 });
  });

  it('restores bounded values and falls back per malformed pane', () => {
    expect(parsedPaneFontScales('{"projects":9,"transcript":1.2,"prompt":"bad","filesList":0,"filesPreview":1.24}')).toEqual({ projects: 2, transcript: 1.2, prompt: 0.9, filesList: 0.75, filesPreview: 1.24 });
    expect(parsedPaneFontScales('bad')).toEqual(DEFAULT_PANE_FONT_SCALES);
  });

  it('allows larger projects while retaining every other pane cap', () => {
    const current = { ...DEFAULT_PANE_FONT_SCALES, projects: 1.5, transcript: 1.5, prompt: 1.5 };
    expect(adjustedPaneFontScales(current, 'projects', 1).projects).toBe(1.6);
    expect(adjustedPaneFontScales({ ...current, projects: 2 }, 'projects', 1).projects).toBe(2);
    expect(adjustedPaneFontScales(current, 'transcript', 1).transcript).toBe(1.5);
    expect(adjustedPaneFontScales(current, 'prompt', 1).prompt).toBe(1.5);
    expect(parsedPaneFontScales(JSON.stringify({ ...current, projects: 1.8 })).projects).toBe(1.8);
  });

  it('migrates the existing three-pane payload without resetting its values', () => {
    expect(parsedPaneFontScales('{"projects":1.2,"transcript":0.8,"prompt":1.1}')).toEqual({
      projects: 1.2,
      transcript: 0.8,
      prompt: 1.1,
      filesList: 1,
      filesPreview: 0.9,
    });
  });
});
