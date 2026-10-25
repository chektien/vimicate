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
    expect(parsedPaneFontScales('{"projects":9,"transcript":1.2,"prompt":"bad","filesList":0,"filesPreview":1.24}')).toEqual({ projects: 1.5, transcript: 1.2, prompt: 0.9, filesList: 0.75, filesPreview: 1.24 });
    expect(parsedPaneFontScales('bad')).toEqual(DEFAULT_PANE_FONT_SCALES);
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
