import { describe, expect, it } from 'vitest';
import { projectFilesPresentationForDevice } from './projectFilesPresentation';

describe('project files adaptive presentation', () => {
  it('uses a right sidebar for iPad independent of split width and overlays every iPhone orientation', () => {
    expect(projectFilesPresentationForDevice('ios', true)).toBe('sidebar');
    expect(projectFilesPresentationForDevice('ios', false)).toBe('overlay');
    expect(projectFilesPresentationForDevice('android', false)).toBe('overlay');
  });
});
