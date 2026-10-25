// @ts-expect-error Vitest's Node runtime provides this test-only module.
import { readFileSync, readdirSync } from 'node:fs';
// @ts-expect-error Vitest's Node runtime provides this test-only module.
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const directory = resolve(process.cwd(), 'modules/vimicate-file-links/ios');
const source = readdirSync(directory).filter((name: string) => name.endsWith('.swift'))
  .map((name: string) => readFileSync(resolve(directory, name), 'utf8')).join('\n');

describe('Files preview hydration boundary', () => {
  it('prepares provider bytes before deciding whether Quick Look can preview the target', () => {
    expect(source).toContain('VimicateFilePreviewPreparation');
    expect(source).not.toContain('QLPreviewController.canPreview(mappedFile.url as NSURL)');
    expect(source).not.toContain('QLPreviewController.canPreview(fileURL as NSURL)');
    expect(source).not.toContain('QLPreviewController.canPreview(selectedURL as NSURL)');
  });

  it('owns cancellation and module disposal instead of presenting after backgrounding', () => {
    expect(source).toContain('UIApplication.didEnterBackgroundNotification');
    expect(source).toContain('OnDestroy');
    expect(source).toContain('Preparing file');
    expect(source).toContain('preparation.cancel()');
  });

  it('rejects empty provider placeholders rather than previewing a filename-only sheet', () => {
    expect(source).toContain('E_FILE_PREVIEW_EMPTY');
    expect(source).toContain('coordinatedURL');
    expect(source).toContain('read(upToCount: 1)');
  });

  it('does not loop back into the picker after selecting an unsupported item', () => {
    const coordinator = readFileSync(resolve(directory, 'VimicateFileLinkCoordinator.swift'), 'utf8');
    const selection = coordinator.slice(coordinator.indexOf('case let .browse(hostPath, promise, accessURL):'),
      coordinator.indexOf('func documentPickerWasCancelled'));
    expect(selection).toContain('browseIfNeeded: false');
  });


});
