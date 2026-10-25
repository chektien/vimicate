import { expect, it } from 'vitest';
import { projectFilesStatusPosition } from './projectFilesStatusPosition';

it('shows the selected Files row or preview cursor when Files owns focus', () => {
  const files = { region: 'list' as const, selectedIndex: 4, previewNavigation: { cursor: { row: 8, column: 2 } } };
  expect(projectFilesStatusPosition(files)).toBe('5');
  expect(projectFilesStatusPosition({ ...files, region: 'preview' })).toBe('9:3');
});
