import { expect, it } from 'vitest';
import { ProjectFilePreviewPositions } from './projectFilePreviewPositions';

it('isolates positions by project/thread/path and clamps against freshly read source', () => {
  const positions = new ProjectFilePreviewPositions();
  positions.set('p', 'a', 'first.txt', { row: 8, column: 20, query: 'needle', direction: -1 });
  expect(positions.restore('p', 'b', 'first.txt', 'first')).toBeNull();
  expect(positions.restore('q', 'a', 'first.txt', 'first')).toBeNull();
  expect(positions.restore('p', 'a', 'other.txt', 'first')).toBeNull();
  expect(positions.restore('p', 'a', 'first.txt', 'first\nxy')).toMatchObject({ query: 'needle', direction: -1, navigation: { cursor: { row: 1, column: 1 }, visualMode: null, anchor: null, pending: '', count: '' } });
});

it('retains only 64 LRU metadata entries and rejects oversized keys or queries', () => {
  const positions = new ProjectFilePreviewPositions();
  const position = { row: 1, column: 2, query: 'needle', direction: 1 as const };
  for (let index = 0; index < 64; index++) positions.set('p', 'a', `file-${index}`, position);
  expect(positions.restore('p', 'a', 'file-0', 'one\ntwo')).not.toBeNull();
  positions.set('p', 'a', 'file-64', position);
  expect(positions.restore('p', 'a', 'file-1', 'one\ntwo')).toBeNull();
  expect(positions.restore('p', 'a', 'file-0', 'one\ntwo')).not.toBeNull();
  positions.set('p', 'a', 'huge', { ...position, query: 'x'.repeat(16_384) });
  expect(positions.restore('p', 'a', 'huge', 'one')).toBeNull();
});
