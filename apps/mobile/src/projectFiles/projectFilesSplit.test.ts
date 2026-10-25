import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROJECT_FILES_LIST_RATIO,
  MIN_PROJECT_FILES_LIST_HEIGHT,
  MIN_PROJECT_FILES_PREVIEW_HEIGHT,
  PROJECT_FILES_DIVIDER_HEIGHT,
  parsedProjectFilesListRatio,
  projectFilesDirectoryRowHeight,
  projectFilesSplitGeometry,
  resizedProjectFilesListRatio,
  serializedProjectFilesListRatio,
} from './projectFilesSplit';

describe('project files split geometry', () => {
  it('starts with a short directory region and preserves both useful minima', () => {
    const geometry = projectFilesSplitGeometry(500, DEFAULT_PROJECT_FILES_LIST_RATIO);
    expect(geometry).toEqual({ dividerHeight: 18, listHeight: 144.6, previewHeight: 337.4 });
    expect(projectFilesSplitGeometry(300, 0.1).listHeight).toBe(MIN_PROJECT_FILES_LIST_HEIGHT);
    expect(projectFilesSplitGeometry(300, 0.8).previewHeight).toBe(MIN_PROJECT_FILES_PREVIEW_HEIGHT);
  });

  it('compresses both minima proportionally without overcommitting a short scene', () => {
    const geometry = projectFilesSplitGeometry(180, DEFAULT_PROJECT_FILES_LIST_RATIO);
    expect(geometry.listHeight).toBe(72);
    expect(geometry.previewHeight).toBe(90);
    expect(geometry.listHeight + geometry.previewHeight + geometry.dividerHeight).toBe(180);
    expect(projectFilesSplitGeometry(10, 0.5)).toEqual({ dividerHeight: 10, listHeight: 0, previewHeight: 0 });
  });

  it('keeps the preferred ratio across viewport changes while clamping only rendered geometry', () => {
    const preferred = 0.62;
    expect(projectFilesSplitGeometry(300, preferred).listHeight).toBe(162);
    expect(projectFilesSplitGeometry(700, preferred).listHeight).toBeCloseTo(422.84);
    expect(resizedProjectFilesListRatio(0.3, 1, 500)).toBeCloseTo(168.6 / 482);
    expect(resizedProjectFilesListRatio(preferred, 1, 300)).toBe(preferred);
    expect(resizedProjectFilesListRatio(0.3, 1, 180)).toBe(0.3);
  });

  it('bounds persisted values and rejects malformed payloads', () => {
    expect(parsedProjectFilesListRatio('{"listRatio":2}')).toBe(0.8);
    expect(parsedProjectFilesListRatio('{"listRatio":"wide"}')).toBeNull();
    expect(parsedProjectFilesListRatio('bad')).toBeNull();
    expect(serializedProjectFilesListRatio(-2)).toBe('{"listRatio":0.1}');
  });

  it('scales directory row geometry with the same bounds as pane typography', () => {
    expect(projectFilesDirectoryRowHeight(1)).toBe(32);
    expect(projectFilesDirectoryRowHeight(1.5)).toBe(48);
    expect(projectFilesDirectoryRowHeight(0.5)).toBe(24);
  });
});
