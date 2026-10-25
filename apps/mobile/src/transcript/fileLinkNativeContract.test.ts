// @ts-expect-error Vitest's Node runtime provides this test-only module.
import { readFileSync, readdirSync } from 'node:fs';
// @ts-expect-error Vitest's Node runtime provides this test-only module.
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const directory = resolve(process.cwd(), 'modules/vimicate-file-links/ios');
const nativeSource = () => readdirSync(directory).filter((name: string) => name.endsWith('.swift'))
  .map((name: string) => readFileSync(resolve(directory, name), 'utf8')).join('\n');

describe('iOS Files link native contract', () => {
  it('uses a user-approved security-scoped folder instead of an unsupported Files URL scheme', () => {
    const source = nativeSource();
    const mapping = readFileSync(resolve(process.cwd(), 'modules/vimicate-file-links/ios/VimicateFileProviderMapping.swift'), 'utf8');
    expect(source).toContain('UIDocumentPickerViewController(forOpeningContentTypes: [.folder]');
    expect(source).toContain('options: .minimalBookmark');
    expect(source).toContain('startAccessingSecurityScopedResource()');
    expect(source).toContain('picker.directoryURL = directoryURL');
    expect(source).toContain('Map Remote Home');
    expect(source).toContain('VimicateFileProviderMapping.providerURL');
    expect(mapping).toContain('return "/Users/\\(components[1])"');
    expect(mapping).toContain('return "/home/\\(components[1])"');
    expect(mapping).toContain('return "/var/home/\\(components[2])"');
    expect(mapping).not.toContain('Blink');
    expect(source).not.toContain('shareddocuments://');
  });

  it('visibly previews the item chosen from the Files browser instead of silently dismissing it', () => {
    const source = nativeSource();
    expect(source).toContain('import QuickLook');
    expect(source).toContain('QLPreviewControllerDataSource');
    expect(source).toContain('QLPreviewControllerDelegate');
    expect(source).toContain('QLPreviewController.canPreview');
    expect(source).toContain('private weak var browserPresenter: UIViewController?');
    expect(source).toContain('browserPresenter ?? controller.presentingViewController');
    expect(source).toContain('presentPreview(');
    expect(source).toContain('previewControllerDidDismiss');
    expect(source).toContain('"status": "unavailable"');
    expect(source).toContain('"message": "The selected Files item cannot be previewed on this device."');
  });

  it('reopens the exact mapped descendant directly instead of making the user select it again', () => {
    const source = nativeSource();
    const mapping = readFileSync(resolve(process.cwd(), 'modules/vimicate-file-links/ios/VimicateFileProviderMapping.swift'), 'utf8');
    const directMappedFile = source.indexOf('if let mappedFile = bookmarks.mappedURL(for: hostPath, isDirectory: false)');
    const mappedDirectoryBrowser = source.indexOf('if let mapped = bookmarks.mappedURL(for: hostDirectory, isDirectory: true)');

    expect(directMappedFile).toBeGreaterThan(0);
    expect(directMappedFile).toBeLessThan(mappedDirectoryBrowser);
    expect(source).toContain(
      'presentPreview(from: currentViewController, hostPath: hostPath, previewURL: mappedFile.url, accessURL: mappedFile.accessURL, promise: promise)',
    );
    expect(source).toContain('case link(mappingRoot: String, hostPath: String, promise: Promise)');
    const firstMappingHandler = source.slice(
      source.indexOf('case let .link(mappingRoot, hostPath, promise):'),
      source.indexOf('case let .linkImage(mappingRoot, hostPath, promise):'),
    );
    expect(firstMappingHandler).toContain('hostPath: hostPath, isDirectory: false');
    // Readiness now precedes canPreview, through the same preview owner on
    // first authorization and saved-bookmark reuse.
    expect(firstMappingHandler).not.toContain('QLPreviewController.canPreview');
    expect(firstMappingHandler).toContain('presentPreview(from: presentingViewController, hostPath: hostPath, previewURL: fileURL');
    expect(source).toContain('VimicateFileProviderMapping.eligibleRoots');
    expect(mapping).toContain('guard cloudMappingBoundary(for: hostPath) == nil else { return nil }');
    expect(mapping).toContain('return root == cloudBoundary || root.hasPrefix(cloudBoundary + "/")');
  });

  it('recovers an unavailable projected descendant through Files and remembers the exact selected item', () => {
    const coordinator = readFileSync(resolve(directory, 'VimicateFileLinkCoordinator.swift'), 'utf8');
    const unavailable = coordinator.slice(
      coordinator.indexOf('case let .unavailable(message):'),
      coordinator.indexOf('case .unsupported:'),
    );
    const selection = coordinator.slice(
      coordinator.indexOf('case let .browse(hostPath, promise, accessURL):'),
      coordinator.indexOf('func documentPickerWasCancelled'),
    );

    expect(coordinator).toContain('case browse(hostPath: String, promise: Promise, accessURL: URL)');
    expect(unavailable).toContain('presentBrowser(from: viewController, hostPath: hostPath');
    expect(selection).toContain('accessURL.stopAccessingSecurityScopedResource()');
    expect(selection).toContain('selectedURL.startAccessingSecurityScopedResource()');
    expect(selection).toContain('bookmarks.storeBookmark(for: hostPath, selectedURL: selectedURL)');
    expect(selection).toContain('previewURL: selectedURL');
    expect(selection).toContain('accessURL: selectedURL');
    expect(selection).toContain('browseIfNeeded: false');
  });

  it('states a checkable remote-home requirement instead of naming a provider iOS cannot verify', () => {
    const source = nativeSource();
    const mapping = readFileSync(resolve(directory, 'VimicateFileProviderMapping.swift'), 'utf8');
    expect(mapping).toContain('static func firstRelativeSegment(of hostPath: String, from mappingRoot: String) -> String?');
    expect(source).toContain('VimicateFileProviderMapping.firstRelativeSegment(of: hostDirectory, from: root)');
    expect(source).toContain('the one directly containing \\(segment)');
    expect(source).toContain('use Select Containing Folder instead');
    expect(source).not.toContain('Blink');
    expect(source).not.toContain('tshome');
  });

  it('materializes an authorized transcript image with coordinated Files-provider access and a byte cap', () => {
    const source = nativeSource();
    expect(source).toContain('AsyncFunction("materializeLocalImage")');
    expect(source).toContain('NSFileCoordinator');
    expect(source).toContain('8 * 1024 * 1024');
    expect(source).toContain('data:\\(mimeType);base64,');
  });
});
