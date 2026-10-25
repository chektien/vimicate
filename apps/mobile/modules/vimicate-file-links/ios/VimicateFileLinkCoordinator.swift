import ExpoModulesCore
import UIKit
import UniformTypeIdentifiers

final class VimicateFileLinkCoordinator: NSObject, UIDocumentPickerDelegate, UIAdaptivePresentationControllerDelegate {
    private static let maximumImageBytes = 8 * 1024 * 1024

    private enum PendingAction {
        case link(mappingRoot: String, hostPath: String, promise: Promise)
        case linkImage(mappingRoot: String, hostPath: String, promise: Promise)
        case browse(hostPath: String, promise: Promise, accessURL: URL)
    }

    private let bookmarks = VimicateFileBookmarkStore()
    private let preview = VimicateFilePreviewController()
    private var invalidated = false
    private var pending: PendingAction?
    private weak var browserPresenter: UIViewController?

    func open(path: String, from currentViewController: UIViewController, promise: Promise) {
        guard !invalidated, pending == nil, !preview.isBusy else {
            promise.reject("E_FILE_LINK_BUSY", "Another Files browser is already open.")
            return
        }
        guard let hostPath = VimicateFileProviderMapping.hostFilePath(for: path),
              let hostDirectory = VimicateFileProviderMapping.hostDirectory(for: hostPath) else {
            promise.reject("E_FILE_LINK_PATH", "This transcript link is not a local file path.")
            return
        }

        if let mappedFile = bookmarks.mappedURL(for: hostPath, isDirectory: false) {
            presentPreview(from: currentViewController, hostPath: hostPath, previewURL: mappedFile.url, accessURL: mappedFile.accessURL, promise: promise)
            return
        }

        if let mapped = bookmarks.mappedURL(for: hostDirectory, isDirectory: true) {
            presentBrowser(from: currentViewController, hostPath: hostPath, directoryURL: mapped.url, accessURL: mapped.accessURL, promise: promise)
            return
        }

        presentMappingChoice(
            title: "Link Files location",
            hostDirectory: hostDirectory,
            hostPath: hostPath,
            image: false,
            currentViewController: currentViewController,
            promise: promise
        )
    }

    private func presentMappingChoice(title: String, hostDirectory: String, hostPath: String, image: Bool, currentViewController: UIViewController, promise: Promise) {
        if image {
            pending = .linkImage(mappingRoot: hostDirectory, hostPath: hostPath, promise: promise)
        } else {
            pending = .link(mappingRoot: hostDirectory, hostPath: hostPath, promise: promise)
        }
        let homeRoot = VimicateFileProviderMapping.remoteHomeRoot(for: hostDirectory)
        // iOS cannot prove which host path a Files provider root actually backs, so name the one
        // segment the user can check in the picker rather than a provider Vimicate cannot verify.
        let homeExplanation = homeRoot.flatMap { root in
            VimicateFileProviderMapping.firstRelativeSegment(of: hostDirectory, from: root).map { segment in
                "\n\nIf a Files provider exposes this host, mapping its home folder \(root) once also covers later links beneath it. Only pick the folder that is \(root) itself—the one directly containing \(segment). If the provider's root is actually deeper, use Select Containing Folder instead."
            }
        } ?? ""
        let alert = UIAlertController(
            title: title,
            message: "Target folder:\n\n\(VimicateFileProviderMapping.displayPath(hostDirectory))\n\nSelect that exact folder, or map the remote home so future links beneath it work too.\(homeExplanation)",
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in self.finishCancelled() })
        alert.addAction(UIAlertAction(title: "Select Containing Folder", style: .default) { _ in
            self.beginFolderSelection(mappingRoot: hostDirectory, hostPath: hostPath, image: image, from: currentViewController, promise: promise)
        })
        if let homeRoot, homeRoot != hostDirectory {
            alert.addAction(UIAlertAction(title: "Map Remote Home", style: .default) { _ in
                self.beginFolderSelection(mappingRoot: homeRoot, hostPath: hostPath, image: image, from: currentViewController, promise: promise)
            })
        }
        currentViewController.present(alert, animated: true)
    }

    private func beginFolderSelection(mappingRoot: String, hostPath: String, image: Bool, from currentViewController: UIViewController, promise: Promise) {
        if image {
            pending = .linkImage(mappingRoot: mappingRoot, hostPath: hostPath, promise: promise)
        } else {
            pending = .link(mappingRoot: mappingRoot, hostPath: hostPath, promise: promise)
        }
        DispatchQueue.main.async {
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder], asCopy: false)
            picker.delegate = self
            picker.presentationController?.delegate = self
            picker.modalPresentationStyle = .pageSheet
            currentViewController.present(picker, animated: true)
        }
    }

    func materializeImage(path: String, promptIfNeeded: Bool, from currentViewController: UIViewController, promise: Promise) {
        guard !invalidated, pending == nil, !preview.isBusy else {
            promise.reject("E_FILE_LINK_BUSY", "Another Files browser is already open.")
            return
        }
        guard let hostPath = VimicateFileProviderMapping.hostFilePath(for: path), let hostDirectory = VimicateFileProviderMapping.hostDirectory(for: hostPath) else {
            promise.resolve(["status": "unsupported"])
            return
        }
        guard Self.imageMimeType(for: hostPath) != nil else {
            promise.resolve(["status": "unsupported"])
            return
        }

        if let mapped = bookmarks.mappedURL(for: hostPath, isDirectory: false) {
            readImage(fileURL: mapped.url, accessURL: mapped.accessURL, promise: promise)
            return
        }
        guard promptIfNeeded else {
            promise.resolve(["status": "unmapped"])
            return
        }

        presentMappingChoice(
            title: "Link image location",
            hostDirectory: hostDirectory,
            hostPath: hostPath,
            image: true,
            currentViewController: currentViewController,
            promise: promise
        )
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let selectedURL = urls.first, let action = pending else {
            finishCancelled()
            return
        }
        pending = nil
        switch action {
        case let .link(mappingRoot, hostPath, promise):
            guard selectedURL.startAccessingSecurityScopedResource() else {
                promise.reject("E_FILE_LINK_SCOPE", "iOS did not grant access to the selected Files folder.")
                return
            }
            do {
                try bookmarks.storeBookmark(for: mappingRoot, selectedURL: selectedURL)
                guard let fileURL = VimicateFileProviderMapping.providerURL(rootURL: selectedURL, mappingRoot: mappingRoot, hostPath: hostPath, isDirectory: false) else {
                    selectedURL.stopAccessingSecurityScopedResource()
                    promise.reject("E_FILE_LINK_MAPPING", "The selected Files folder could not be mapped to this host path.")
                    return
                }
                let presentingViewController = controller.presentingViewController
                controller.dismiss(animated: true) {
                    guard let presentingViewController else {
                        selectedURL.stopAccessingSecurityScopedResource()
                        promise.resolve(["status": "linked"])
                        return
                    }
                    self.presentPreview(from: presentingViewController, hostPath: hostPath, previewURL: fileURL, accessURL: selectedURL, promise: promise)
                }
            } catch {
                selectedURL.stopAccessingSecurityScopedResource()
                promise.reject("E_FILE_LINK_BOOKMARK", "The selected Files folder could not be remembered: \(error.localizedDescription)")
            }
        case let .linkImage(mappingRoot, hostPath, promise):
            guard selectedURL.startAccessingSecurityScopedResource() else {
                promise.reject("E_FILE_LINK_SCOPE", "iOS did not grant access to the selected Files folder.")
                return
            }
            do {
                try bookmarks.storeBookmark(for: mappingRoot, selectedURL: selectedURL)
                guard let fileURL = VimicateFileProviderMapping.providerURL(rootURL: selectedURL, mappingRoot: mappingRoot, hostPath: hostPath, isDirectory: false) else {
                    selectedURL.stopAccessingSecurityScopedResource()
                    promise.reject("E_FILE_LINK_MAPPING", "The selected Files folder could not be mapped to this image path.")
                    return
                }
                controller.dismiss(animated: true) {
                    self.readImage(fileURL: fileURL, accessURL: selectedURL, promise: promise)
                }
            } catch {
                selectedURL.stopAccessingSecurityScopedResource()
                promise.reject("E_FILE_LINK_BOOKMARK", "The selected Files folder could not be remembered: \(error.localizedDescription)")
            }
        case let .browse(hostPath, promise, accessURL):
            let presentingViewController = browserPresenter ?? controller.presentingViewController
            accessURL.stopAccessingSecurityScopedResource()
            guard selectedURL.startAccessingSecurityScopedResource() else {
                browserPresenter = nil
                controller.dismiss(animated: true) {
                    promise.reject("E_FILE_LINK_SCOPE", "iOS did not grant access to the selected Files item.")
                }
                return
            }
            do {
                try bookmarks.storeBookmark(for: hostPath, selectedURL: selectedURL)
            } catch {
                selectedURL.stopAccessingSecurityScopedResource()
                browserPresenter = nil
                controller.dismiss(animated: true) {
                    promise.reject("E_FILE_LINK_BOOKMARK", "The selected Files item could not be remembered: \(error.localizedDescription)")
                }
                return
            }
            controller.dismiss(animated: true) {
                self.browserPresenter = nil
                guard let presentingViewController else {
                    selectedURL.stopAccessingSecurityScopedResource()
                    promise.resolve([
                        "status": "unavailable",
                        "message": "The selected Files item could not be presented."
                    ])
                    return
                }
                self.presentPreview(
                    from: presentingViewController,
                    hostPath: hostPath,
                    previewURL: selectedURL,
                    accessURL: selectedURL,
                    promise: promise,
                    browseIfNeeded: false
                )
            }
        }
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        finishCancelled()
    }

    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        finishCancelled()
    }

    private func presentBrowser(from viewController: UIViewController, hostPath: String, directoryURL: URL, accessURL: URL, promise: Promise) {
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.item], asCopy: false)
        picker.directoryURL = directoryURL
        picker.delegate = self
        picker.presentationController?.delegate = self
        picker.modalPresentationStyle = .pageSheet
        browserPresenter = viewController
        pending = .browse(hostPath: hostPath, promise: promise, accessURL: accessURL)
        viewController.present(picker, animated: true)
    }

    private func presentPreview(from viewController: UIViewController, hostPath: String, previewURL: URL, accessURL: URL, promise: Promise, browseIfNeeded: Bool = true) {
        guard !invalidated else {
            accessURL.stopAccessingSecurityScopedResource()
            promise.resolve(["status": "cancelled"])
            return
        }
        preview.open(from: viewController, url: previewURL, accessURL: accessURL) { [weak self, weak viewController] result in
            switch result {
            case .opened: promise.resolve(["status": "opened"])
            case .cancelled: promise.resolve(["status": "cancelled"])
            case let .unavailable(message):
                guard browseIfNeeded, let self, let viewController,
                      accessURL.startAccessingSecurityScopedResource() else {
                    promise.resolve(["status": "unavailable", "message": message])
                    return
                }
                self.presentBrowser(from: viewController, hostPath: hostPath, directoryURL: previewURL.deletingLastPathComponent(), accessURL: accessURL, promise: promise)
            case .unsupported:
                guard browseIfNeeded, let self, let viewController,
                      accessURL.startAccessingSecurityScopedResource() else {
                    promise.resolve(["status": "unavailable", "message": "The selected Files item cannot be previewed on this device."])
                    return
                }
                self.presentBrowser(from: viewController, hostPath: hostPath, directoryURL: previewURL.deletingLastPathComponent(), accessURL: accessURL, promise: promise)
            }
        }
    }

    func invalidate() {
        invalidated = true
        preview.cancel()
        finishCancelled()
    }

    private func finishCancelled() {
        guard let action = pending else { return }
        pending = nil
        switch action {
        case let .link(_, _, promise):
            promise.resolve(["status": "cancelled"])
        case let .linkImage(_, _, promise):
            promise.resolve(["status": "cancelled"])
        case let .browse(_, promise, accessURL):
            browserPresenter = nil
            accessURL.stopAccessingSecurityScopedResource()
            promise.resolve(["status": "cancelled"])
        }
    }

    private func readImage(fileURL: URL, accessURL: URL, promise: Promise) {
        DispatchQueue.global(qos: .userInitiated).async {
            defer { accessURL.stopAccessingSecurityScopedResource() }
            var coordinationError: NSError?
            var readError: Error?
            var imageData: Data?
            let coordinator = NSFileCoordinator()
            coordinator.coordinate(readingItemAt: fileURL, options: [], error: &coordinationError) { coordinatedURL in
                do {
                    let values = try coordinatedURL.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
                    guard values.isRegularFile == true else { return }
                    guard let byteCount = values.fileSize, byteCount <= Self.maximumImageBytes else {
                        readError = VimicateFileLinkImageError.oversize
                        return
                    }
                    imageData = try Data(contentsOf: coordinatedURL, options: .mappedIfSafe)
                } catch {
                    readError = error
                }
            }
            if coordinationError != nil || readError != nil || imageData == nil {
                promise.resolve(["status": "missing"])
                return
            }
            guard let data = imageData, data.count <= Self.maximumImageBytes,
                  let mimeType = Self.imageMimeType(for: fileURL.path) else {
                promise.resolve(["status": "unsupported"])
                return
            }
            promise.resolve([
                "status": "loaded",
                "dataUrl": "data:\(mimeType);base64,\(data.base64EncodedString())",
                "mimeType": mimeType,
                "byteCount": data.count
            ])
        }
    }

    private static func imageMimeType(for path: String) -> String? {
        let ext = (path as NSString).pathExtension.lowercased()
        switch ext {
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "gif": return "image/gif"
        case "webp": return "image/webp"
        case "heic": return "image/heic"
        case "tif", "tiff": return "image/tiff"
        case "bmp": return "image/bmp"
        default: return nil
        }
    }

}

private enum VimicateFileLinkImageError: Error {
    case oversize
}
