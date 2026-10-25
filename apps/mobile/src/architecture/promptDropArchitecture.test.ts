// @ts-expect-error Vitest's Node runtime provides this test-only module.
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('retains the editor as the default Expo view and registers the drop container by name', () => {
  const source = readFileSync(new URL('../../modules/vimicate-editor/ios/VimicateEditorModule.swift', import.meta.url), 'utf8');
  // Expo resolves an unnamed requireNativeView call to the first registered view.
  expect(source.match(/View\((\w+)\.self\)/)?.[1]).toBe('VimicateEditorView');
  expect(source).toContain('ViewName("PromptDrop")');
});
