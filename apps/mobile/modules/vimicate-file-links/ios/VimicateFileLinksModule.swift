import ExpoModulesCore
import UIKit

public final class VimicateFileLinksModule: Module {
    private let coordinator = VimicateFileLinkCoordinator()
    private let shareCoordinator = VimicateFileShareCoordinator()
    private let streamStore = VimicateFileShareStreamStore()
    private let streamQueue = DispatchQueue(label: "vimicate.share.write", qos: .userInitiated)
    private var backgroundObserver: NSObjectProtocol?

    public func definition() -> ModuleDefinition {
        Name("VimicateFileLinks")
        Constant("supportsInlinePreview") { true }
        Constant("supportsHTMLPreview") { true }
        Constant("supportsFileSharing") { true }
        Constant("maximumFileShareBytes") { VimicateInlinePreviewStaging.maximumShareBytes }
        Constant("supportsStreamedFileSharing") { true }
        View(VimicateFilePreviewView.self) {
            Events("onPreviewStatus")
            Prop("dataBase64") { (view: VimicateFilePreviewView, value: String) in view.dataBase64 = value }
            Prop("filename") { (view: VimicateFilePreviewView, value: String) in view.filename = value }
            Prop("mimeType") { (view: VimicateFilePreviewView, value: String) in view.mimeType = value }
            OnViewDidUpdateProps { (view: VimicateFilePreviewView) in view.updatePreview() }
        }
        View(VimicateHTMLPreviewView.self) {
            ViewName("HTMLPreview")
            Events("onPreviewStatus")
            Prop("dataBase64") { (view: VimicateHTMLPreviewView, value: String) in view.dataBase64 = value }
            Prop("filename") { (view: VimicateHTMLPreviewView, value: String) in view.filename = value }
            Prop("mimeType") { (view: VimicateHTMLPreviewView, value: String) in view.mimeType = value }
            OnViewDidUpdateProps { (view: VimicateHTMLPreviewView) in view.updatePreview() }
        }
        OnCreate {
            self.backgroundObserver = NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification,
                object: nil, queue: .main) { [streamStore = self.streamStore] _ in
                    // A presented activity may be handing the URL to a receiving app.
                    // Revoke only downloads and pending presentation, not that handoff.
                    streamStore.cancel()
                }
        }
        OnDestroy { [coordinator, shareCoordinator, streamStore] in
            if let observer = self.backgroundObserver { NotificationCenter.default.removeObserver(observer) }
            streamStore.cancel()
            DispatchQueue.main.async { coordinator.invalidate(); shareCoordinator.invalidate() }
        }

        AsyncFunction("beginFileShare") { (filename: String, size: Double) -> String in
            guard UIApplication.shared.applicationState == .active else { throw VimicateFileShareStreamStore.Failure.invalid }
            return try self.streamStore.begin(filename: filename, size: size)
        }.runOnQueue(.main)

        AsyncFunction("appendFileShare") { (id: String, offset: Double, dataBase64: String) in
            try self.streamStore.append(id: id, offset: offset, dataBase64: dataBase64)
        }.runOnQueue(streamQueue)

        AsyncFunction("presentFileShare") { (id: String, anchor: VimicateFileShareAnchor?, promise: Promise) in
            do {
                try self.streamStore.prepare(id: id)
                DispatchQueue.main.async {
                    do {
                        let file = try self.streamStore.take(id: id)
                        guard let presenter = self.appContext?.utilities?.currentViewController() else {
                            promise.reject("E_FILE_SHARE_VIEW", "The share sheet cannot be presented right now.")
                            return
                        }
                        self.shareCoordinator.shareStaged(file, id: id, anchor: anchor, from: presenter, promise: promise)
                    } catch { promise.reject("E_FILE_SHARE", error.localizedDescription) }
                }
            } catch { promise.reject("E_FILE_SHARE", error.localizedDescription) }
        }.runOnQueue(streamQueue)

        AsyncFunction("cancelFileShare") { (id: String) in
            self.streamStore.cancel(id: id)
            self.shareCoordinator.cancel(id: id)
        }.runOnQueue(.main)

        AsyncFunction("shareFile") { (dataBase64: String, filename: String, mimeType: String, anchor: VimicateFileShareAnchor?, promise: Promise) in
            guard let presenter = self.appContext?.utilities?.currentViewController() else {
                promise.reject("E_FILE_SHARE_VIEW", "The share sheet cannot be presented right now.")
                return
            }
            self.shareCoordinator.share(.init(dataBase64: dataBase64, filename: filename, mimeType: mimeType),
                anchor: anchor, from: presenter, promise: promise)
        }.runOnQueue(.main)

        AsyncFunction("openLocalPath") { (path: String, promise: Promise) in
            guard let currentViewController = self.appContext?.utilities?.currentViewController() else {
                promise.reject("E_FILE_LINK_VIEW", "The Files browser cannot be presented right now.")
                return
            }
            self.coordinator.open(path: path, from: currentViewController, promise: promise)
        }.runOnQueue(.main)

        AsyncFunction("materializeLocalImage") { (path: String, promptIfNeeded: Bool, promise: Promise) in
            guard let currentViewController = self.appContext?.utilities?.currentViewController() else {
                promise.reject("E_FILE_LINK_VIEW", "The Files browser cannot be presented right now.")
                return
            }
            self.coordinator.materializeImage(path: path, promptIfNeeded: promptIfNeeded, from: currentViewController, promise: promise)
        }.runOnQueue(.main)
    }
}
