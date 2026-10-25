import ExpoModulesCore
import QuickLook
import PDFKit
import UIKit

private final class VimicateInlinePreviewItem: NSObject, QLPreviewItem {
    let previewItemURL: URL?
    init(url: URL?) { previewItemURL = url }
}

/// Inline, read-only system preview. JS owns selection; this view owns only the
/// child controller, a temporary file, and stale/disposal authority.
final class VimicateFilePreviewView: ExpoView, QLPreviewControllerDataSource, QLPreviewControllerDelegate {
    let onPreviewStatus = EventDispatcher()
    var dataBase64 = ""
    var filename = ""
    var mimeType = ""
    private let preparation = VimicateInlinePreviewPreparation()
    private var submitted: VimicateInlinePreviewStaging.Input?
    private var generation = UUID()
    private var file: VimicateInlinePreviewFile?
    private var preview: QLPreviewController?
    private var focusProtection: VimicateInlinePreviewFocus?
    private var expiry: Timer?
    private var preparationDeadline: Timer?
    private var richText: VimicateRTFPreviewTextView?
    private var pdf: VimicatePDFPreviewView?
    private var backgroundObserver: NSObjectProtocol?
    private var foregroundObserver: NSObjectProtocol?

    required init(appContext: AppContext? = nil) {
        super.init(appContext: appContext)
        clipsToBounds = true
        accessibilityIdentifier = "vimicate.inline-document-preview"
        backgroundObserver = NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification,
            object: nil, queue: .main) { [weak self] _ in
                self?.clearPreview()
                self?.submitted = nil
            }
        foregroundObserver = NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification,
            object: nil, queue: .main) { [weak self] _ in self?.updatePreview() }
    }

    func updatePreview() {
        let input = VimicateInlinePreviewStaging.Input(dataBase64: dataBase64, filename: filename, mimeType: mimeType)
        guard input != submitted else { return }
        clearPreview()
        guard window != nil, UIApplication.shared.applicationState != .background else { return }
        submitted = input
        let id = generation
        preparationDeadline = Timer.scheduledTimer(withTimeInterval: 5, repeats: false) { [weak self] _ in
            guard let self, self.generation == id else { return }
            self.clearPreview()
            self.emit("error", "The document preview timed out. You can retry or share the complete file.")
        }
        preparation.prepare(input) { [weak self] result in
            guard let self, self.generation == id, self.window != nil else { return }
            self.preparationDeadline?.invalidate()
            self.preparationDeadline = nil
            switch result {
            case let .success(file):
                if let text = file.attributedText {
                    let view = VimicateRTFPreviewTextView(text: text)
                    view.frame = self.bounds
                    view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
                    self.addSubview(view)
                    self.richText = view
                    self.file = file
                    self.emit("ready")
                    self.scheduleExpiry(id)
                    return
                }
                if let document = file.pdfDocument {
                    if let parent = self.containingViewController {
                        self.focusProtection = VimicateInlinePreviewFocus(host: self, presenter: parent)
                    }
                    let view = VimicatePDFPreviewView(document: document)
                    view.frame = self.bounds
                    view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
                    self.addSubview(view)
                    self.pdf = view
                    self.file = file
                    self.emit("ready")
                    self.scheduleExpiry(id)
                    return
                }
                guard QLPreviewController.canPreview(file.url as NSURL) else {
                    self.emit("unsupported", "Quick Look cannot preview this file on this device.")
                    return
                }
                guard let parent = self.containingViewController else {
                    self.emit("error", "The preview container is unavailable.")
                    return
                }
                self.file = file
                // Capture the current keyboard owner before Quick Look mounts
                // its asynchronously loading remote preview scene.
                self.focusProtection = VimicateInlinePreviewFocus(host: self, presenter: parent)
                let controller = QLPreviewController()
                controller.dataSource = self
                controller.delegate = self
                parent.addChild(controller)
                self.addSubview(controller.view)
                controller.view.frame = self.bounds
                controller.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
                controller.didMove(toParent: parent)
                self.preview = controller
                controller.reloadData()
                self.emit("ready")
                self.scheduleExpiry(id)
            case let .failure(error):
                let failure = error as? VimicateInlinePreviewStaging.Failure
                let status = failure == .activeContent || failure == .unsupportedType ? "unsupported" : "error"
                self.emit(status, error.localizedDescription)
            }
        }
    }

    private func scheduleExpiry(_ id: UUID) {
        expiry = Timer.scheduledTimer(withTimeInterval: VimicateInlinePreviewStaging.maximumLifetime,
            repeats: false) { [weak self] _ in
            guard let self, self.generation == id else { return }
            self.clearPreview()
            self.emit("error", "The temporary preview expired. Select the file again to reload it.")
        }
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        if window == nil {
            clearPreview()
            submitted = nil
        } else { updatePreview() }
    }

    private var containingViewController: UIViewController? {
        var responder: UIResponder? = self.next
        while let current = responder {
            if let controller = current as? UIViewController { return controller }
            responder = current.next
        }
        return nil
    }

    private func clearPreview() {
        generation = UUID()
        focusProtection?.stop()
        focusProtection = nil
        preparation.cancel()
        preparationDeadline?.invalidate()
        preparationDeadline = nil
        richText?.removeFromSuperview()
        richText = nil
        pdf?.document = nil
        pdf?.removeFromSuperview()
        pdf = nil
        expiry?.invalidate()
        expiry = nil
        if let preview {
            preview.willMove(toParent: nil)
            preview.view.removeFromSuperview()
            preview.removeFromParent()
            preview.dataSource = nil
            preview.delegate = nil
        }
        preview = nil
        // Keep the URL alive until Quick Look is no longer in the hierarchy.
        file = nil
    }

    private func emit(_ status: String, _ message: String? = nil) {
        var event: [String: Any] = ["status": status]
        if let message { event["message"] = message }
        onPreviewStatus(event)
    }

    func numberOfPreviewItems(in controller: QLPreviewController) -> Int { file == nil ? 0 : 1 }
    func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem {
        // A late system query after removal receives no URL, never a force
        // unwrap or an unrelated fallback path.
        VimicateInlinePreviewItem(url: file?.url)
    }
    // A preview never edits or hands arbitrary links to another app.
    func previewController(_ controller: QLPreviewController, editingModeFor previewItem: QLPreviewItem) -> QLPreviewItemEditingMode { .disabled }
    func previewController(_ controller: QLPreviewController, shouldOpen url: URL, for item: QLPreviewItem) -> Bool { false }

    deinit {
        focusProtection?.stop()
        preparationDeadline?.invalidate()
        expiry?.invalidate()
        if let backgroundObserver { NotificationCenter.default.removeObserver(backgroundObserver) }
        if let foregroundObserver { NotificationCenter.default.removeObserver(foregroundObserver) }
        // UIKit normally removes the view from its window before destruction.
        // Balance containment even if a caller destroys a detached container.
        if let preview {
            preview.willMove(toParent: nil)
            preview.view.removeFromSuperview()
            preview.removeFromParent()
            preview.dataSource = nil
            preview.delegate = nil
        }
    }
}

/// Keep PDFs in-process. Quick Look's remote PDF scene can take hardware input
/// outside the app responder chain on iPadOS, even after its view is dismissed.
private final class VimicatePDFPreviewView: PDFView, PDFViewDelegate {
    override var canBecomeFirstResponder: Bool { false }

    init(document: PDFDocument) {
        super.init(frame: .zero)
        delegate = self
        displayMode = .singlePageContinuous
        displayDirection = .vertical
        autoScales = true
        backgroundColor = .white
        self.document = document
        accessibilityLabel = "PDF file preview"
    }

    // Inline previews never open arbitrary links, other files, or print panels.
    override func perform(_ action: PDFAction) {
        if action is PDFActionGoTo { super.perform(action) }
    }
    func pdfViewWillClick(onLink sender: PDFView, with url: URL) {}
    func pdfViewOpenPDF(_ sender: PDFView, forRemoteGoToAction action: PDFActionRemoteGoTo) {}
    func pdfViewPerformPrint(_ sender: PDFView) {}

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError() }
}
