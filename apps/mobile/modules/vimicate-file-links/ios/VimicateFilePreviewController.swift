import UIKit
import QuickLook

/// Owns only system loading/preview presentation and its access lifetime.
final class VimicateFilePreviewController: NSObject, QLPreviewControllerDataSource, QLPreviewControllerDelegate {
    enum Outcome { case opened, cancelled, unsupported, unavailable(String) }
    private let preparation: VimicateFilePreviewPreparation
    private var requestID: UUID?
    private var completion: ((Outcome) -> Void)?
    private var accessLease: VimicateFileAccessLease?
    private var previewURL: URL?
    private var loading: UIAlertController?
    private var preview: QLPreviewController?
    private var backgroundObserver: NSObjectProtocol?
    var isBusy: Bool { requestID != nil || preparation.isBusy }

    init(preparation: VimicateFilePreviewPreparation = VimicateFilePreviewPreparation()) {
        self.preparation = preparation
    }

    func open(from presenter: UIViewController, url: URL, accessURL: URL, completion: @escaping (Outcome) -> Void) {
        guard !isBusy, UIApplication.shared.applicationState == .active, presenter.viewIfLoaded?.window != nil else {
            accessURL.stopAccessingSecurityScopedResource()
            completion(.unavailable("Another Files operation is finishing, or the app is not active. Try again."))
            return
        }
        let id = UUID()
        requestID = id
        self.completion = completion
        let lease = VimicateFileAccessLease { accessURL.stopAccessingSecurityScopedResource() }
        accessLease = lease
        backgroundObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main
        ) { [weak self] _ in self?.cancel() }
        let loading = UIAlertController(title: "Preparing file",
            message: "Waiting for Files to download and open this item…", preferredStyle: .alert)
        loading.addAction(UIAlertAction(title: "Cancel", style: .cancel) { [weak self] _ in self?.cancel() })
        self.loading = loading
        presenter.present(loading, animated: true) { [weak self, weak presenter] in
            guard let self, self.requestID == id else { return }
            guard let presenter else { self.finish(.cancelled); return }
            self.preparation.prepare(url: url, lease: lease) { [weak self, weak presenter] result in
                guard let self, self.requestID == id else { return }
                switch result {
                case let .ready(readyURL, readyLease):
                    self.accessLease = readyLease
                    self.loading?.dismiss(animated: true) { [weak self, weak presenter] in
                        guard let self, self.requestID == id else { return }
                        self.loading = nil
                        guard let presenter, presenter.viewIfLoaded?.window != nil,
                              UIApplication.shared.applicationState == .active else {
                            self.finish(.cancelled)
                            return
                        }
                        guard QLPreviewController.canPreview(readyURL as NSURL) else {
                            self.finish(.unsupported)
                            return
                        }
                        self.previewURL = readyURL
                        let preview = QLPreviewController()
                        preview.dataSource = self
                        preview.delegate = self
                        preview.modalPresentationStyle = .fullScreen
                        self.preview = preview
                        presenter.present(preview, animated: true)
                    }
                case let .unavailable(message): self.finish(.unavailable(message))
                case .cancelled: self.finish(.cancelled)
                }
            }
        }
    }

    func cancel() { finish(.cancelled) }

    private func finish(_ outcome: Outcome) {
        guard requestID != nil else { return }
        requestID = nil
        let callback = completion
        completion = nil
        preparation.cancel()
        if let backgroundObserver { NotificationCenter.default.removeObserver(backgroundObserver) }
        backgroundObserver = nil
        previewURL = nil
        let presented = preview as UIViewController? ?? loading
        preview = nil
        loading = nil
        // An in-flight read retains its own lease until it actually drains.
        let lease = accessLease
        accessLease = nil
        if let presented, presented.presentingViewController != nil {
            presented.dismiss(animated: true) { withExtendedLifetime(lease) { callback?(outcome) } }
        } else {
            withExtendedLifetime(lease) { callback?(outcome) }
        }
    }

    func numberOfPreviewItems(in controller: QLPreviewController) -> Int { previewURL == nil ? 0 : 1 }

    func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem {
        (previewURL ?? URL(fileURLWithPath: "/")) as NSURL
    }

    func previewControllerDidDismiss(_ controller: QLPreviewController) { finish(.opened) }

    deinit {
        if let backgroundObserver { NotificationCenter.default.removeObserver(backgroundObserver) }
    }
}
