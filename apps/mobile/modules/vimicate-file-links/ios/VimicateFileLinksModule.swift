import ExpoModulesCore
import UIKit

public final class VimicateFileLinksModule: Module {
    private let coordinator = VimicateFileLinkCoordinator()
    private let shareCoordinator = VimicateFileShareCoordinator()

    public func definition() -> ModuleDefinition {
        Name("VimicateFileLinks")
        Constant("supportsInlinePreview") { true }
        Constant("supportsHTMLPreview") { true }
        Constant("supportsFileSharing") { true }
        Constant("maximumFileShareBytes") { VimicateInlinePreviewStaging.maximumShareBytes }
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
        OnDestroy { [coordinator, shareCoordinator] in
            DispatchQueue.main.async { coordinator.invalidate(); shareCoordinator.invalidate() }
        }

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
