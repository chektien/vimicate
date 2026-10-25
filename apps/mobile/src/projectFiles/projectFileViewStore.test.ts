import { expect, it } from 'vitest';
import { createTopPreviewNavigation } from './projectFilePreview';
import { ProjectFileViewStore, type SavedFileView } from './projectFileViewStore';

function view(text: string): SavedFileView {
  return {
    path: '', selectedPath: 'note.md', showHidden: true, region: 'preview', helpVisible: false,
    previewNavigation: createTopPreviewNavigation(text), lastSearch: '', lastSearchDirection: 1,
    entries: [{ name: 'note.md', path: 'note.md', kind: 'text', mimeType: 'text/plain', size: text.length, mtimeMs: 1 }],
    content: { projectId: 'notes', path: 'note.md', kind: 'text', mimeType: 'text/plain', size: text.length, mtimeMs: 1, text },
  };
}

it('bounds retained previews by both per-view and aggregate bytes while keeping navigation identity', () => {
  const store = new ProjectFileViewStore();
  store.set('oversized', view('x'.repeat(1_100_000)));
  expect(store.get('oversized')).toMatchObject({ selectedPath: 'note.md', content: null, entries: null });
  for (let index = 0; index < 6; index += 1) store.set(String(index), view('x'.repeat(400_000)));
  expect(store.get('0')).toBeUndefined();
  expect(store.get('5')?.content?.kind).toBe('text');
});
